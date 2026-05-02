import {
  ArtifactKind,
  DeliveryStatus,
  MessageChannel,
  OrderStatus,
  RenderJobStatus
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildOpsApprovalEmail,
  buildPortraitReadyEmail,
  buildUploadRequestEmail,
  getCustomerEmailRecipients,
  normalizeEmailAddress,
  sendEmail
} from "@/lib/email";
import {
  posterBackgroundStyleFromDb,
  posterBackgroundStyleToDb,
  posterFontStyleFromDb,
  posterFontStyleToDb,
  type PosterBackgroundStyle,
  type PosterFontStyle
} from "@/lib/poster-styles";
import { enqueueRenderJob } from "@/lib/queue";
import { buildDigitalSaleMessage, markEtsyReceiptComplete } from "@/lib/etsy";
import { analyzeImage, renderPortrait } from "@/lib/render";
import { scheduleMissingPhotoReminders } from "@/lib/reminders";
import { deleteObject, getBuffer, putBuffer } from "@/lib/storage";
import { createToken } from "@/lib/tokens";
import { MAX_UPLOAD_BYTES, isAllowedUploadMimeType } from "@/lib/uploads";
import { requireEnv } from "@/lib/env";

type EtsyWebhookPayload = {
  event_id?: string;
  event_type?: string;
  shop_id: string;
  receipt_id: string;
  created_timestamp: number;
  buyer_name: string;
  buyer_email?: string;
  listing_id?: string;
  personalization?: string;
  transactions?: Array<{
    transaction_id: string;
    title: string;
    quantity?: number;
    price_amount?: number;
    currency_code?: string;
  }>;
  resource_url?: string | null;
};

export async function ingestOrderPaidWebhook(payload: EtsyWebhookPayload) {
  const env = requireEnv();
  const pilotListingMatched = payload.listing_id === env.ETSY_PILOT_LISTING_ID;
  const pilotListingEligible = payload.shop_id === env.ETSY_SHOP_ID && pilotListingMatched;
  const uploadToken = createToken();
  const now = new Date();
  const uploadUrl = `${env.APP_URL}/upload/${uploadToken}`;
  const saleMessage = buildDigitalSaleMessage(uploadUrl);
  const order = await prisma.order.upsert({
    where: {
      receiptId: payload.receipt_id
    },
    update: {
      eventId: payload.event_id,
      buyerName: payload.buyer_name,
      buyerEmail: payload.buyer_email,
      personalization: payload.personalization,
      listingId: payload.listing_id,
      pilotListingEligible,
      status: pilotListingEligible
        ? OrderStatus.AWAITING_PHOTO
        : OrderStatus.NEEDS_MANUAL_ATTENTION
    },
    create: {
      shopId: payload.shop_id,
      receiptId: payload.receipt_id,
      eventId: payload.event_id,
      etsyOrderCreatedAt: new Date(payload.created_timestamp * 1000),
      buyerName: payload.buyer_name,
      buyerEmail: payload.buyer_email,
      listingId: payload.listing_id,
      personalization: payload.personalization,
      pilotListingEligible,
      status: pilotListingEligible
        ? OrderStatus.AWAITING_PHOTO
        : OrderStatus.NEEDS_MANUAL_ATTENTION,
      uploadToken,
      uploadTokenExpiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30)
    },
    select: {
      id: true,
      receiptId: true,
      buyerName: true,
      buyerEmail: true,
      uploadToken: true,
      createdAt: true
    }
  });

  await Promise.allSettled([
    ...(
      payload.transactions?.map((transaction) =>
        prisma.orderItem.create({
          data: {
            orderId: order.id,
            transactionId: transaction.transaction_id,
            title: transaction.title,
            quantity: transaction.quantity ?? 1,
            priceAmount: transaction.price_amount,
            currencyCode: transaction.currency_code
          }
        })
      ) ?? []
    ),
    prisma.auditLog.create({
      data: {
        orderId: order.id,
        action: "order.created",
        metadata: {
          payload,
          pilotListingEligible
        }
      }
    }),
    prisma.messageEvent.create({
      data: {
        orderId: order.id,
        channel: MessageChannel.ETSY,
        eventType: "sale_message.prepared",
        body: saleMessage
      }
    })
  ]);

  if (pilotListingEligible) {
    await scheduleMissingPhotoReminders(order.id, order.createdAt);
    await sendUploadRequestEmailIfNeeded({
      orderId: order.id,
      receiptId: order.receiptId,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      uploadToken: order.uploadToken
    });
  } else {
    await withQueryFallback(
      "ingestOrderPaidWebhook pilot listing mismatch event",
      () =>
        prisma.messageEvent.create({
          data: {
            orderId: order.id,
            channel: MessageChannel.INTERNAL,
            eventType: "pilot_listing.mismatch",
            body: `Receipt ${order.receiptId} is outside the pilot listing and needs manual handling.`
          }
        }),
      null
    );
  }

  return order;
}

export async function createReminderAlert(orderId: string, label: string) {
  const order = await prisma.order.findUnique({
    where: {
      id: orderId
    }
  });

  if (!order || order.photoReceivedAt) {
    return null;
  }

  return prisma.order.update({
    where: {
      id: orderId
    },
    data: {
      messageEvents: {
        create: {
          channel: MessageChannel.INTERNAL,
          eventType: "reminder.due",
          subject: label,
          body: `Buyer still has not uploaded a photo. Send an Etsy follow-up for receipt ${order.receiptId}.`
        }
      },
      auditLog: {
        create: {
          action: "reminder.due",
          metadata: {
            label
          }
        }
      }
    }
  });
}

export async function registerWebhookDelivery({
  externalWebhookId,
  eventType,
  resourceUrl,
  payload,
  orderId
}: {
  externalWebhookId: string;
  eventType: string;
  resourceUrl?: string | null;
  payload: unknown;
  orderId?: string;
}) {
  return prisma.webhookDelivery.upsert({
    where: {
      externalWebhookId
    },
    update: {
      eventType,
      resourceUrl: resourceUrl ?? undefined,
      payload: payload as never,
      orderId
    },
    create: {
      externalWebhookId,
      eventType,
      resourceUrl: resourceUrl ?? undefined,
      payload: payload as never,
      orderId
    }
  });
}

export async function hasWebhookDelivery(externalWebhookId: string) {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: {
      externalWebhookId
    }
  });

  return Boolean(delivery);
}

export async function getEtsyConnectionStatus() {
  const env = requireEnv();
  const connection = await prisma.etsyConnection.findUnique({
    where: {
      shopId: env.ETSY_SHOP_ID
    }
  });

  return {
    shopId: env.ETSY_SHOP_ID,
    pilotListingId: env.ETSY_PILOT_LISTING_ID,
    webhookCallbackUrl: env.ETSY_WEBHOOK_CALLBACK_URL,
    connected: Boolean(connection),
    accessExpiresAt: connection?.accessExpiresAt ?? null,
    scope: connection?.scope ?? null
  };
}

export async function getDashboardOrders(status?: OrderStatus) {
  const orderRows = await prisma.$queryRaw<
    Array<{ order: Record<string, unknown> }>
  >`
    SELECT row_to_json(o) AS "order"
    FROM "Order" o
    ORDER BY o."createdAt" DESC
    LIMIT 200
  `;

  const orders = orderRows
    .map(({ order }) => ({
      id: String(order.id),
      receiptId: String(order.receiptId ?? ""),
      buyerName: String(order.buyerName ?? ""),
      status: String(order.status ?? OrderStatus.PAID) as OrderStatus,
      pilotListingEligible: Boolean(order.pilotListingEligible),
      pilotListingMatched: Boolean(order.pilotListingMatched),
      createdAt: toDate(order.createdAt) ?? new Date(0),
      photoReceivedAt: toDate(order.photoReceivedAt),
      approvedAt: toDate(order.approvedAt),
      deliveredAt: toDate(order.deliveredAt)
    }))
    .filter((order) => !status || order.status === status);

  const uploadRows = await withQueryFallback(
    "getDashboardOrders uploads",
    () =>
      prisma.$queryRaw<Array<{ upload: Record<string, unknown> }>>`
        SELECT row_to_json(cu) AS "upload"
        FROM "CustomerUpload" cu
        ORDER BY cu."createdAt" DESC
        LIMIT 500
      `,
    [] as Array<{ upload: Record<string, unknown> }>
  );

  const latestUploadByOrder = new Map<string, string>();
  for (const { upload } of uploadRows) {
    const orderId = String(upload.orderId ?? "");
    if (orderId && !latestUploadByOrder.has(orderId)) {
      latestUploadByOrder.set(orderId, String(upload.originalName ?? ""));
    }
  }

  return orders.map((order) => ({
    ...order,
    uploadCount: latestUploadByOrder.has(order.id) ? 1 : 0,
    latestUploadName: latestUploadByOrder.get(order.id) ?? null
  }));
}

export async function getAdminUploadGallery() {
  try {
    const [uploadRows, orderRows] = await Promise.all([
      withQueryFallback(
        "getAdminUploadGallery uploads",
        () =>
          prisma.$queryRaw<Array<{ upload: Record<string, unknown> }>>`
            SELECT row_to_json(cu) AS "upload"
            FROM "CustomerUpload" cu
            ORDER BY cu."createdAt" DESC
            LIMIT 24
          `,
        [] as Array<{ upload: Record<string, unknown> }>
      ),
      withQueryFallback(
        "getAdminUploadGallery orders",
        () =>
          prisma.$queryRaw<Array<{ order: Record<string, unknown> }>>`
            SELECT row_to_json(o) AS "order"
            FROM "Order" o
            ORDER BY o."createdAt" DESC
            LIMIT 200
          `,
        [] as Array<{ order: Record<string, unknown> }>
      )
    ]);

    const orderMap = new Map(
      orderRows.map(({ order }) => [
        String(order.id),
        {
          buyerName: String(order.buyerName ?? ""),
          status: String(order.status ?? OrderStatus.PAID) as OrderStatus,
          receiptId: String(order.receiptId ?? "")
        }
      ])
    );

    return uploadRows
      .map(({ upload }) => {
        const orderId = String(upload.orderId ?? "");
        const order = orderMap.get(orderId);
        if (!order) {
          return null;
        }

        return {
          id: String(upload.id),
          orderId,
          petName: String(upload.petName ?? ""),
          originalName: String(upload.originalName ?? ""),
          storageKey: String(upload.storageKey ?? ""),
          createdAt: toDate(upload.createdAt) ?? new Date(0),
          order
        };
      })
      .filter((upload) => upload !== null);
  } catch (error) {
    console.error("getAdminUploadGallery failed", error);
    return [];
  }
}

export async function getAdminGeneratedGallery() {
  try {
    const [artifactRows, orderRows] = await Promise.all([
      withQueryFallback(
        "getAdminGeneratedGallery artifacts",
        () =>
          prisma.$queryRaw<Array<{ artifact: Record<string, unknown> }>>`
            SELECT row_to_json(a) AS "artifact"
            FROM "Artifact" a
            ORDER BY a."createdAt" DESC
            LIMIT 24
          `,
        [] as Array<{ artifact: Record<string, unknown> }>
      ),
      withQueryFallback(
        "getAdminGeneratedGallery orders",
        () =>
          prisma.$queryRaw<Array<{ order: Record<string, unknown> }>>`
            SELECT row_to_json(o) AS "order"
            FROM "Order" o
            ORDER BY o."createdAt" DESC
            LIMIT 200
          `,
        [] as Array<{ order: Record<string, unknown> }>
      )
    ]);

    const orderMap = new Map(
      orderRows.map(({ order }) => [
        String(order.id),
        {
          buyerName: String(order.buyerName ?? ""),
          status: String(order.status ?? OrderStatus.PAID) as OrderStatus,
          receiptId: String(order.receiptId ?? "")
        }
      ])
    );

    return artifactRows
      .map(({ artifact }) => {
        const kind = String(artifact.kind ?? "");
        if (kind !== "PREVIEW" && kind !== "FINAL_PNG") {
          return null;
        }

        const orderId = String(artifact.orderId ?? "");
        const order = orderMap.get(orderId);
        if (!order) {
          return null;
        }

        return {
          id: String(artifact.id),
          orderId,
          kind: kind as ArtifactKind,
          version: Number(artifact.version ?? 1),
          storageKey: String(artifact.storageKey ?? ""),
          createdAt: toDate(artifact.createdAt) ?? new Date(0),
          order
        };
      })
      .filter((artifact) => artifact !== null);
  } catch (error) {
    console.error("getAdminGeneratedGallery failed", error);
    return [];
  }
}

export async function deleteCustomerUploadById(uploadId: string) {
  const upload = await prisma.customerUpload.findUnique({
    where: {
      id: uploadId
    }
  });

  if (!upload) {
    throw new Error("Upload not found");
  }

  await Promise.all([
    prisma.customerUpload.delete({
      where: {
        id: uploadId
      }
    }),
    deleteObject(upload.storageKey)
  ]);

  return upload;
}

export async function deleteArtifactById(artifactId: string) {
  const artifact = await prisma.artifact.findUnique({
    where: {
      id: artifactId
    }
  });

  if (!artifact) {
    throw new Error("Generated image not found");
  }

  await Promise.all([
    prisma.artifact.delete({
      where: {
        id: artifactId
      }
    }),
    deleteObject(artifact.storageKey)
  ]);

  return artifact;
}

export async function getOrderById(orderId: string) {
  const orderRows = await prisma.$queryRaw<
    Array<{ order: Record<string, unknown> }>
  >`
    SELECT row_to_json(o) AS "order"
    FROM "Order" o
    WHERE o."id" = ${orderId}
    LIMIT 1
  `;

  const rawOrder = orderRows[0]?.order;

  if (!rawOrder) {
    return null;
  }

  const [uploads, artifacts, messageEvents, auditLog] = await Promise.all([
    withQueryFallback(
      "getOrderById uploads",
      () =>
        prisma.$queryRaw<Array<{ upload: Record<string, unknown> }>>`
          SELECT row_to_json(cu) AS "upload"
          FROM "CustomerUpload" cu
          WHERE cu."orderId" = ${orderId}
          ORDER BY cu."createdAt" DESC
        `,
      [] as Array<{ upload: Record<string, unknown> }>
    ),
    withQueryFallback(
      "getOrderById artifacts",
      () =>
        prisma.$queryRaw<Array<{ artifact: Record<string, unknown> }>>`
          SELECT row_to_json(a) AS "artifact"
          FROM "Artifact" a
          WHERE a."orderId" = ${orderId}
          ORDER BY a."createdAt" DESC
          LIMIT 10
        `,
      [] as Array<{ artifact: Record<string, unknown> }>
    ),
    withQueryFallback(
      "getOrderById message events",
      () =>
        prisma.$queryRaw<Array<{ event: Record<string, unknown> }>>`
          SELECT row_to_json(me) AS "event"
          FROM "MessageEvent" me
          WHERE me."orderId" = ${orderId}
          ORDER BY me."createdAt" DESC
          LIMIT 25
        `,
      [] as Array<{ event: Record<string, unknown> }>
    ),
    withQueryFallback(
      "getOrderById audit log",
      () =>
        prisma.$queryRaw<Array<{ audit: Record<string, unknown> }>>`
          SELECT row_to_json(al) AS "audit"
          FROM "AuditLog" al
          WHERE al."orderId" = ${orderId}
          ORDER BY al."createdAt" DESC
          LIMIT 25
        `,
      [] as Array<{ audit: Record<string, unknown> }>
    )
  ]);

  return {
    id: String(rawOrder.id),
    receiptId: String(rawOrder.receiptId ?? ""),
    buyerName: String(rawOrder.buyerName ?? ""),
    buyerEmail: rawOrder.buyerEmail ? String(rawOrder.buyerEmail) : null,
    deliveryEmail: nullableString(rawOrder.deliveryEmail),
    status: String(rawOrder.status ?? OrderStatus.PAID) as OrderStatus,
    uploadToken: String(rawOrder.uploadToken ?? ""),
    uploads: uploads.map(({ upload }) => ({
      id: String(upload.id),
      petName: String(upload.petName ?? ""),
      fontStyle: posterFontStyleFromDb(upload.fontStyle),
      backgroundStyle: posterBackgroundStyleFromDb(upload.backgroundStyle),
      originalName: String(upload.originalName ?? ""),
      storageKey: String(upload.storageKey ?? ""),
      blurScore:
        upload.blurScore === null || upload.blurScore === undefined
          ? null
          : Number(upload.blurScore),
      createdAt: toDate(upload.createdAt) ?? new Date(0)
    })),
    artifacts: artifacts.map(({ artifact }) => ({
      id: String(artifact.id),
      kind: String(artifact.kind ?? ArtifactKind.PREVIEW) as ArtifactKind,
      version: Number(artifact.version ?? 1),
      storageKey: String(artifact.storageKey ?? ""),
      createdAt: toDate(artifact.createdAt) ?? new Date(0)
    })),
    messageEvents: messageEvents.map(({ event }) => ({
      id: String(event.id),
      eventType: String(event.eventType ?? ""),
      channel: String(event.channel ?? MessageChannel.INTERNAL) as MessageChannel,
      subject: nullableString(event.subject),
      body: String(event.body ?? ""),
      createdAt: toDate(event.createdAt) ?? new Date(0)
    })),
    auditLog: auditLog.map(({ audit }) => ({
      id: String(audit.id),
      action: String(audit.action ?? ""),
      createdAt: toDate(audit.createdAt) ?? new Date(0)
    }))
  };
}

export async function getOrderByUploadToken(token: string) {
  const orderRows = await prisma.$queryRaw<
    Array<{ order: Record<string, unknown> }>
  >`
    SELECT row_to_json(o) AS "order"
    FROM "Order" o
    WHERE o."uploadToken" = ${token}
      AND o."uploadTokenExpiresAt" > NOW()
    LIMIT 1
  `;

  const rawOrder = orderRows[0]?.order;

  if (!rawOrder) {
    return null;
  }

  const orderId = String(rawOrder.id);

  const [uploads, finalArtifacts] = await Promise.all([
    withQueryFallback(
      "getOrderByUploadToken uploads",
      () =>
        prisma.$queryRaw<Array<{ upload: Record<string, unknown> }>>`
          SELECT row_to_json(cu) AS "upload"
          FROM "CustomerUpload" cu
          WHERE cu."orderId" = ${orderId}
          ORDER BY cu."createdAt" DESC
          LIMIT 1
        `,
      [] as Array<{ upload: Record<string, unknown> }>
    ),
    withQueryFallback(
      "getOrderByUploadToken artifacts",
      () =>
        prisma.$queryRaw<Array<{ artifact: Record<string, unknown> }>>`
          SELECT row_to_json(a) AS "artifact"
          FROM "Artifact" a
          WHERE a."orderId" = ${orderId}
          ORDER BY a."version" DESC, a."createdAt" DESC
          LIMIT 10
        `,
      [] as Array<{ artifact: Record<string, unknown> }>
    )
  ]);

  return {
    id: orderId,
    buyerName: String(rawOrder.buyerName ?? ""),
    buyerEmail: nullableString(rawOrder.buyerEmail),
    deliveryEmail: nullableString(rawOrder.deliveryEmail),
    receiptId: String(rawOrder.receiptId ?? ""),
    status: String(rawOrder.status ?? OrderStatus.PAID) as OrderStatus,
    uploads: uploads.map(({ upload }) => ({
      id: String(upload.id),
      petName: String(upload.petName ?? ""),
      createdAt: toDate(upload.createdAt) ?? new Date(0)
    })),
    previews: finalArtifacts
      .map(({ artifact }) => artifact)
      .filter((artifact) => String(artifact.kind ?? "") === "PREVIEW")
      .map((artifact) => ({
        id: String(artifact.id),
        storageKey: String(artifact.storageKey ?? ""),
        createdAt: toDate(artifact.createdAt) ?? new Date(0)
      })),
    finalArtifacts: finalArtifacts
      .map(({ artifact }) => artifact)
      .filter((artifact) => String(artifact.kind ?? "") === "FINAL_PNG")
      .slice(0, 1)
      .map((artifact) => ({
        id: String(artifact.id),
        storageKey: String(artifact.storageKey ?? ""),
        createdAt: toDate(artifact.createdAt) ?? new Date(0)
      }))
  };
}

export async function getOrderByDownloadToken(token: string) {
  return prisma.order.findFirst({
    where: {
      downloadToken: token,
      downloadTokenExpiresAt: {
        gt: new Date()
      }
    },
    include: {
      artifacts: true,
      deliveryEvents: {
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });
}

export async function storeCustomerUpload({
  orderId,
  customerEmail,
  petName,
  notes,
  fontStyle,
  backgroundStyle,
  originalName,
  mimeType,
  fileBuffer,
  deferInlineProcessing = false
}: {
  orderId: string;
  customerEmail: string;
  petName: string;
  notes?: string;
  fontStyle: PosterFontStyle;
  backgroundStyle: PosterBackgroundStyle;
  originalName: string;
  mimeType: string;
  fileBuffer: Buffer;
  deferInlineProcessing?: boolean;
}) {
  const orderRecord = await prisma.order.findUnique({
    where: {
      id: orderId
    }
  });

  if (!orderRecord?.pilotListingEligible) {
    throw new Error("This order is not enabled for the pilot upload flow");
  }

  const imageInfo = await analyzeImage(fileBuffer);

  if (!petName.trim()) {
    throw new Error("Pet name is required");
  }

  const deliveryEmail = normalizeEmailAddress(customerEmail);

  if (!deliveryEmail) {
    throw new Error("A valid delivery email is required");
  }

  if (!isAllowedUploadMimeType(mimeType)) {
    throw new Error("Only JPG, PNG, WEBP, or HEIC images are supported");
  }

  if (fileBuffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("Photo is too large. Please upload an image under 15 MB.");
  }

  if (imageInfo.width < 400 || imageInfo.height < 400) {
    throw new Error("Photo is too small. Please upload a photo that is at least 400px on each side.");
  }

  const storageKey = `orders/${orderId}/uploads/${Date.now()}-${sanitizeFileName(originalName)}`;
  await putBuffer(storageKey, fileBuffer, mimeType);

  const orderStatus =
    imageInfo.blurScore < 12 ? OrderStatus.NEEDS_MANUAL_ATTENTION : OrderStatus.PHOTO_RECEIVED;

  const uploadReceivedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const upload = await tx.customerUpload.create({
      data: {
        orderId,
        petName,
        notes,
        fontStyle: posterFontStyleToDb(fontStyle),
        backgroundStyle: posterBackgroundStyleToDb(backgroundStyle),
        originalName,
        mimeType,
        storageKey,
        width: imageInfo.width,
        height: imageInfo.height,
        blurScore: imageInfo.blurScore
      }
    });

    const order = await tx.order.update({
      where: {
        id: orderId
      },
      data: {
        status: orderStatus,
        deliveryEmail,
        photoReceivedAt: uploadReceivedAt,
        auditLog: {
          create: {
            action: "upload.received",
            metadata: {
              uploadId: upload.id,
              blurScore: imageInfo.blurScore
            }
          }
        }
      }
    });

    const renderJob =
      orderStatus === OrderStatus.PHOTO_RECEIVED
        ? await tx.renderJob.create({
            data: {
              orderId,
              customerUploadId: upload.id,
              status: RenderJobStatus.QUEUED
            }
          })
        : null;

    return { upload, order, renderJob };
  });

  if (result.renderJob) {
    // Always use the queue. This allows the Vercel request to finish in ~2 seconds
    // while the dedicated worker handles the 60-90s AI rendering in the background.
    await enqueueRenderJob(result.renderJob.id);

    // Trigger GitHub Action to handle the rendering worker for free (bypassing Vercel timeouts)
    try {
      await triggerGitHubRender(result.renderJob.id);
    } catch (error) {
      console.error("[render] failed to trigger github worker", error);
    }
  }

  return {
    upload: result.upload,
    order: result.order,
    renderJob: result.renderJob,
    processingDeferred: false
  };
}

/**
 * Triggers a GitHub Action workflow to process a specific render job.
 * Requires GITHUB_PAT, GITHUB_REPO_OWNER, and GITHUB_REPO_NAME in env.
 */
async function triggerGitHubRender(renderJobId: string) {
  const { GITHUB_PAT, GITHUB_REPO_OWNER, GITHUB_REPO_NAME } = process.env;

  if (!GITHUB_PAT || !GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) {
    console.warn("[render] skipping github worker trigger (missing config)");
    return;
  }

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        event_type: "render-job",
        client_payload: {
          renderJobId
        }
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub trigger failed (${response.status}): ${text}`);
  }

  console.log(`[render] successfully triggered github worker for job ${renderJobId}`);
}

export async function processRenderJob(renderJobId: string) {
  const renderJob = await prisma.renderJob.update({
    where: {
      id: renderJobId
    },
    data: {
      status: RenderJobStatus.RUNNING,
      startedAt: new Date()
    }
  });

  try {
    const upload = await prisma.customerUpload.findUnique({
      where: {
        id: renderJob.customerUploadId
      }
    });

    if (!upload) {
      throw new Error("Render job is missing its source upload");
    }

    const [order, artifactCount] = await Promise.all([
      prisma.order.update({
        where: {
          id: renderJob.orderId
        },
        data: {
          status: OrderStatus.RENDERING
        }
      }),
      prisma.artifact.count({
        where: {
          orderId: renderJob.orderId
        }
      })
    ]);

    const source = await getBuffer(upload.storageKey);
    const version = Math.floor(artifactCount / 2) + 1;
    const output = await renderPortrait({
      source,
      petName: upload.petName,
      fontStyle: posterFontStyleFromDb(upload.fontStyle),
      backgroundStyle: posterBackgroundStyleFromDb(upload.backgroundStyle),
      orderId: order.id,
      version
    });

    await prisma.$transaction([
      prisma.artifact.createMany({
        data: [
          {
            orderId: order.id,
            renderJobId: renderJob.id,
            kind: ArtifactKind.PREVIEW,
            version,
            storageKey: output.previewKey,
            mimeType: "image/png"
          },
          {
            orderId: order.id,
            renderJobId: renderJob.id,
            kind: ArtifactKind.FINAL_PNG,
            version,
            storageKey: output.finalPngKey,
            mimeType: "image/png"
          }
        ]
      }),
      prisma.renderJob.update({
        where: {
          id: renderJob.id
        },
        data: {
          status: RenderJobStatus.SUCCEEDED,
          completedAt: new Date(),
          failureReason: null
        }
      }),
      prisma.order.update({
        where: {
          id: order.id
        },
        data: {
          status: OrderStatus.AWAITING_APPROVAL,
          auditLog: {
            create: {
              action: "render.completed",
              metadata: output
            }
          }
        }
      })
    ]);

    await sendOpsApprovalEmailIfNeeded({
      orderId: order.id,
      receiptId: order.receiptId,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      deliveryEmail: order.deliveryEmail,
      finalPngKey: output.finalPngKey
    });
  } catch (error) {
    const failureReason = formatJobFailureReason(error);
    console.error(`[render] job ${renderJob.id} failed`, error);

    await prisma.$transaction([
      prisma.renderJob.update({
        where: {
          id: renderJob.id
        },
        data: {
          status: RenderJobStatus.FAILED,
          failureReason,
          completedAt: new Date()
        }
      }),
      prisma.order.update({
        where: {
          id: renderJob.orderId
        },
        data: {
          status: OrderStatus.NEEDS_MANUAL_ATTENTION,
          auditLog: {
            create: {
              action: "render.failed",
              metadata: {
                renderJobId: renderJob.id,
                failureReason
              }
            }
          }
        }
      })
    ]);

    throw error;
  }
}

export async function approveOrder(orderId: string) {
  const { APP_URL, DELIVERY_LINK_TTL_HOURS } = requireEnv();
  const deliveryTtlHours = Number(DELIVERY_LINK_TTL_HOURS || 168);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + deliveryTtlHours * 60 * 60 * 1000);
  const order = await prisma.order.findUnique({
    where: {
      id: orderId
    },
    select: {
      id: true,
      receiptId: true,
      buyerName: true,
      buyerEmail: true,
      deliveryEmail: true
    }
  });

  if (!order) {
    throw new Error("Order not found");
  }

  const finalArtifact = await prisma.artifact.findFirst({
    where: {
      orderId: order.id,
      kind: ArtifactKind.FINAL_PNG
    },
    orderBy: {
      createdAt: "desc"
    },
    select: {
      id: true,
      storageKey: true
    }
  });

  if (!finalArtifact) {
    throw new Error("Cannot approve before a final portrait is generated");
  }

  const recipients = getCustomerEmailRecipients(order.buyerEmail, order.deliveryEmail);

  if (recipients.length === 0) {
    throw new Error("Cannot approve before a customer delivery email is captured");
  }

  const downloadToken = createToken();
  const deliveryUrl = `${APP_URL}/download/${downloadToken}`;

  const deliveryEmail = buildPortraitReadyEmail({
    buyerName: order.buyerName,
    receiptId: order.receiptId,
    downloadUrl: deliveryUrl,
    expiresAt
  });

  const customerEmailResult = await sendEmail({
    to: recipients,
    subject: deliveryEmail.subject,
    html: deliveryEmail.html,
    text: deliveryEmail.text,
    idempotencyKey: `customer-delivery-${order.id}-${downloadToken}`
  }).catch((error) => ({
    status: "skipped" as const,
    reason: formatJobFailureReason(error)
  }));

  const updated = await prisma.order.update({
    where: {
      id: order.id
    },
    data: {
      status: OrderStatus.DELIVERED,
      approvedAt: now,
      deliveredAt: now,
      downloadToken,
      downloadTokenExpiresAt: expiresAt,
      deliveryEvents: {
        create: {
          status: DeliveryStatus.SENT,
          deliveryUrl,
          email: order.buyerEmail
        }
      },
      messageEvents: {
        create: {
          channel: MessageChannel.EMAIL,
          eventType:
            customerEmailResult.status === "sent"
              ? "delivery.email_sent"
              : "delivery.email_skipped",
          subject: deliveryEmail.subject,
          body:
            customerEmailResult.status === "sent"
              ? `Sent delivery link to ${recipients.join(", ")}. Resend id: ${customerEmailResult.id ?? "n/a"}`
              : `Delivery email was not sent: ${customerEmailResult.reason}`
        }
      },
      auditLog: {
        create: [
          {
            action: "approval.granted"
          },
          {
            action: "delivery.sent",
            metadata: {
              deliveryUrl,
              recipients,
              emailStatus: customerEmailResult.status
            }
          }
        ]
      }
    }
  });

  try {
    await markEtsyReceiptComplete(order.receiptId);
    await prisma.order.update({
      where: {
        id: order.id
      },
      data: {
        auditLog: {
          create: {
            action: "etsy.receipt_completed",
            metadata: {
              receiptId: order.receiptId
            }
          }
        }
      }
    });
  } catch (error) {
    const failureReason = formatJobFailureReason(error);
    await prisma.order.update({
      where: {
        id: order.id
      },
      data: {
        status: OrderStatus.NEEDS_MANUAL_ATTENTION,
        messageEvents: {
          create: {
            channel: MessageChannel.INTERNAL,
            eventType: "etsy.receipt_completion_failed",
            body: `Local delivery is complete, but Etsy receipt ${order.receiptId} needs manual completion: ${failureReason}`
          }
        },
        auditLog: {
          create: {
            action: "etsy.receipt_completion_failed",
            metadata: {
              receiptId: order.receiptId,
              failureReason
            }
          }
        }
      }
    });
  }

  return updated;
}

export async function markNeedsManualAttention(orderId: string, reason: string) {
  return prisma.order.update({
    where: {
      id: orderId
    },
    data: {
      status: OrderStatus.NEEDS_MANUAL_ATTENTION,
      auditLog: {
        create: {
          action: "manual_attention.requested",
          metadata: {
            reason
          }
        }
      }
    }
  });
}

export async function rerenderOrder(
  orderId: string,
  options?: {
    deferInlineProcessing?: boolean;
    skipProcessing?: boolean;
  }
) {
  const latestUpload = await prisma.customerUpload.findFirst({
    where: {
      orderId
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (!latestUpload) {
    throw new Error("Order has no uploaded photo");
  }

  const attempt = (await prisma.renderJob.count({ where: { orderId } })) + 1;
  const renderJob = await prisma.renderJob.create({
    data: {
      orderId,
      customerUploadId: latestUpload.id,
      status: RenderJobStatus.QUEUED,
      attempt
    }
  });

  await prisma.order.update({
    where: {
      id: orderId
    },
    data: {
      status: OrderStatus.PHOTO_RECEIVED
    }
  });

  const shouldProcessInline = shouldRunInlineJobs();

  if (options?.skipProcessing) {
    return {
      renderJob,
      processingDeferred: shouldProcessInline
    };
  }

  if (options?.deferInlineProcessing && shouldProcessInline) {
    return {
      renderJob,
      processingDeferred: true
    };
  }

  if (shouldProcessInline) {
    await processRenderJob(renderJob.id);
  } else {
    await enqueueRenderJob(renderJob.id);
    try {
      await triggerGitHubRender(renderJob.id);
    } catch (error) {
      console.error("[render] failed to trigger github worker", error);
    }
  }
  return {
    renderJob,
    processingDeferred: false
  };
}

export async function deliverApprovedOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: {
      id: orderId
    },
    include: {
      artifacts: true,
      deliveryEvents: {
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      }
    }
  });

  if (!order?.downloadToken || !order.deliveryEvents[0]) {
    return;
  }

  const deliveryUrl = order.deliveryEvents[0]?.deliveryUrl;

  await prisma.$transaction([
    prisma.deliveryEvent.update({
      where: {
        id: order.deliveryEvents[0].id
      },
      data: {
        status: DeliveryStatus.SENT
      }
    }),
    prisma.order.update({
      where: {
        id: orderId
      },
      data: {
        status: OrderStatus.DELIVERED,
        deliveredAt: new Date(),
        messageEvents: {
          create: {
            channel: MessageChannel.INTERNAL,
            eventType: "delivery.portal_ready",
            body: `Portal download is ready at ${deliveryUrl}`
          }
        },
        auditLog: {
          create: {
            action: "delivery.sent",
            metadata: {
              deliveryUrl
            }
          }
        }
      }
    })
  ]);
}

export async function recordDeliveryOpen(orderId: string) {
  const event = await prisma.deliveryEvent.findFirst({
    where: {
      orderId
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (!event) {
    return;
  }

  await prisma.deliveryEvent.update({
    where: {
      id: event.id
    },
    data: {
      status: DeliveryStatus.OPENED,
      openedAt: new Date()
    }
  });
}

async function sendUploadRequestEmailIfNeeded({
  orderId,
  receiptId,
  buyerName,
  buyerEmail,
  uploadToken
}: {
  orderId: string;
  receiptId: string;
  buyerName: string;
  buyerEmail: string | null;
  uploadToken: string;
}) {
  const recipient = normalizeEmailAddress(buyerEmail);

  if (!recipient) {
    return;
  }

  const existing = await prisma.messageEvent.findFirst({
    where: {
      orderId,
      eventType: "upload_request.email_sent"
    }
  });

  if (existing) {
    return;
  }

  const { APP_URL } = requireEnv();
  const uploadUrl = `${APP_URL}/upload/${uploadToken}`;
  const email = buildUploadRequestEmail({
    buyerName,
    receiptId,
    uploadUrl
  });

  try {
    const result = await sendEmail({
      to: recipient,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `upload-request-${orderId}`
    });

    await prisma.messageEvent.create({
      data: {
        orderId,
        channel: MessageChannel.EMAIL,
        eventType:
          result.status === "sent" ? "upload_request.email_sent" : "upload_request.email_skipped",
        subject: email.subject,
        body:
          result.status === "sent"
            ? `Sent upload request to ${recipient}. Resend id: ${result.id ?? "n/a"}`
            : `Upload request email was not sent: ${result.reason}`
      }
    });
  } catch (error) {
    await prisma.messageEvent.create({
      data: {
        orderId,
        channel: MessageChannel.EMAIL,
        eventType: "upload_request.email_failed",
        subject: email.subject,
        body: formatJobFailureReason(error)
      }
    });
  }
}

async function sendOpsApprovalEmailIfNeeded({
  orderId,
  receiptId,
  buyerName,
  buyerEmail,
  deliveryEmail,
  finalPngKey
}: {
  orderId: string;
  receiptId: string;
  buyerName: string;
  buyerEmail: string | null;
  deliveryEmail: string | null;
  finalPngKey: string;
}) {
  const existing = await prisma.messageEvent.findFirst({
    where: {
      orderId,
      eventType: "approval.email_sent"
    }
  });

  if (existing) {
    return;
  }

  const { APP_URL, OPS_EMAIL } = requireEnv();
  const adminUrl = `${APP_URL}/orders/${orderId}`;
  const email = buildOpsApprovalEmail({
    buyerName,
    receiptId,
    buyerEmail,
    deliveryEmail,
    adminUrl
  });

  try {
    const portrait = await getBuffer(finalPngKey);
    const result = await sendEmail({
      to: OPS_EMAIL,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `ops-approval-${orderId}`,
      attachments: [
        {
          filename: `pawprints-${receiptId}.png`,
          content: portrait,
          contentType: "image/png"
        }
      ]
    });

    await prisma.order.update({
      where: {
        id: orderId
      },
      data: {
        messageEvents: {
          create: {
            channel: MessageChannel.EMAIL,
            eventType:
              result.status === "sent" ? "approval.email_sent" : "approval.email_skipped",
            subject: email.subject,
            body:
              result.status === "sent"
                ? `Sent approval email to ${OPS_EMAIL}. Resend id: ${result.id ?? "n/a"}`
                : `Approval email was not sent: ${result.reason}`
          }
        },
        auditLog: {
          create: {
            action:
              result.status === "sent" ? "approval.email_sent" : "approval.email_skipped",
            metadata: {
              opsEmail: OPS_EMAIL,
              finalPngKey,
              emailStatus: result.status
            }
          }
        }
      }
    });
  } catch (error) {
    const failureReason = formatJobFailureReason(error);
    await prisma.order.update({
      where: {
        id: orderId
      },
      data: {
        messageEvents: {
          create: {
            channel: MessageChannel.EMAIL,
            eventType: "approval.email_failed",
            subject: email.subject,
            body: failureReason
          }
        },
        auditLog: {
          create: {
            action: "approval.email_failed",
            metadata: {
              opsEmail: OPS_EMAIL,
              finalPngKey,
              failureReason
            }
          }
        }
      }
    });
  }
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
}

function toDate(value: unknown) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function nullableString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

async function withQueryFallback<T>(label: string, query: () => Promise<T>, fallback: T) {
  try {
    return await query();
  } catch (error) {
    console.error(`${label} failed`, error);
    return fallback;
  }
}

function shouldRunInlineJobs() {
  const explicitInlineSetting = process.env.INLINE_RENDER_JOBS;

  if (explicitInlineSetting === "true") {
    return true;
  }

  if (explicitInlineSetting === "false") {
    return false;
  }

  // Hosted demo deployments rely on inline processing unless a dedicated worker
  // has been explicitly configured to take over queued jobs.
  return process.env.VERCEL === "1";
}

function formatJobFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown render failure";
  return message.slice(0, 500);
}
