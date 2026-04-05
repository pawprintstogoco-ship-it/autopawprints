import {
  ArtifactKind,
  DeliveryStatus,
  MessageChannel,
  OrderStatus,
  RenderJobStatus
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueueRenderJob } from "@/lib/queue";
import { buildDigitalSaleMessage } from "@/lib/etsy";
import { analyzeImage, renderPortrait } from "@/lib/render";
import { scheduleMissingPhotoReminders } from "@/lib/reminders";
import { deleteObject, getBuffer, putBuffer } from "@/lib/storage";
import { createToken } from "@/lib/tokens";
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
    status: String(rawOrder.status ?? OrderStatus.PAID) as OrderStatus,
    uploadToken: String(rawOrder.uploadToken ?? ""),
    uploads: uploads.map(({ upload }) => ({
      id: String(upload.id),
      petName: String(upload.petName ?? ""),
      originalName: String(upload.originalName ?? ""),
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
    receiptId: String(rawOrder.receiptId ?? ""),
    status: String(rawOrder.status ?? OrderStatus.PAID) as OrderStatus,
    uploads: uploads.map(({ upload }) => ({
      id: String(upload.id),
      petName: String(upload.petName ?? ""),
      createdAt: toDate(upload.createdAt) ?? new Date(0)
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
  petName,
  notes,
  originalName,
  mimeType,
  fileBuffer
}: {
  orderId: string;
  petName: string;
  notes?: string;
  originalName: string;
  mimeType: string;
  fileBuffer: Buffer;
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

  if (!mimeType.startsWith("image/")) {
    throw new Error("Only image uploads are supported");
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
    if (shouldRunInlineJobs()) {
      await processRenderJob(result.renderJob.id);
    } else {
      await enqueueRenderJob(result.renderJob.id);
    }
  }

  return { upload: result.upload, order: result.order };
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
        completedAt: new Date()
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
}

export async function approveOrder(orderId: string) {
  const { APP_URL } = requireEnv();
  const deliveryTtlHours = 24 * 7;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + deliveryTtlHours * 60 * 60 * 1000);
  const order = await prisma.order.findUnique({
    where: {
      id: orderId
    },
    select: {
      id: true,
      receiptId: true,
      buyerEmail: true,
      uploadToken: true
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

  const deliveryUrl = `${APP_URL}/api/files/final/${order.uploadToken}`;

  return prisma.order.update({
    where: {
      id: order.id
    },
    data: {
      status: OrderStatus.DELIVERED,
      approvedAt: now,
      deliveredAt: now,
      uploadTokenExpiresAt: expiresAt,
      downloadToken: null,
      downloadTokenExpiresAt: null,
      deliveryEvents: {
        create: {
          status: DeliveryStatus.SENT,
          deliveryUrl,
          email: order.buyerEmail
        }
      },
      messageEvents: {
        create: {
          channel: MessageChannel.INTERNAL,
          eventType: "delivery.manual_message_required",
          body: `Send Etsy message manually with this final PNG link: ${deliveryUrl}`
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
              deliveryUrl
            }
          }
        ]
      }
    }
  });
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

export async function rerenderOrder(orderId: string) {
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

  if (shouldRunInlineJobs()) {
    await processRenderJob(renderJob.id);
  } else {
    await enqueueRenderJob(renderJob.id);
  }
  return renderJob;
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
