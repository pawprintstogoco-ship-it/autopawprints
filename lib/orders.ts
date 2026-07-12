import {
  ArtifactKind,
  DeliveryStatus,
  MessageChannel,
  OrderStatus,
  RenderJobStatus,
  RenderQaKind,
  RenderQaRecommendation,
  RenderQaStatus
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
import {
  analyzeImage,
  renderPortrait,
  type PetLikenessQaReport,
  type PosterCompositionQaReport
} from "@/lib/render";
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

type QuantityLike = {
  quantity?: number | null;
};

export function calculateRequiredPortraitSlots(items: QuantityLike[]) {
  const total = items.reduce((sum, item) => {
    const quantity = Number(item.quantity ?? 1);
    return sum + (Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1);
  }, 0);

  return Math.max(1, total);
}

function getLatestBySlot<T extends { portraitSlotId: string | null; createdAt: Date }>(items: T[]) {
  const latestBySlot = new Map<string, T>();

  for (const item of items) {
    if (!item.portraitSlotId) {
      continue;
    }

    const existing = latestBySlot.get(item.portraitSlotId);
    if (!existing || item.createdAt > existing.createdAt) {
      latestBySlot.set(item.portraitSlotId, item);
    }
  }

  return Array.from(latestBySlot.values());
}

function mapCompositionQaStatus(report: PosterCompositionQaReport) {
  return report.warnings.some((warning) => warning === "pet_too_small_or_sparse")
    ? RenderQaStatus.FAIL
    : report.warnings.length > 0
    ? RenderQaStatus.WARNING
    : RenderQaStatus.PASS;
}

function mapCompositionQaRecommendation(report: PosterCompositionQaReport) {
  return mapCompositionQaStatus(report) === RenderQaStatus.PASS
    ? RenderQaRecommendation.APPROVE
    : RenderQaRecommendation.MANUAL_REVIEW;
}

function mapLikenessQaStatus(report: PetLikenessQaReport) {
  return report.severity === "fail"
    ? RenderQaStatus.FAIL
    : report.severity === "warning"
    ? RenderQaStatus.WARNING
    : RenderQaStatus.PASS;
}

function mapLikenessQaRecommendation(report: PetLikenessQaReport) {
  return report.recommendation === "rerender"
    ? RenderQaRecommendation.RERENDER
    : report.recommendation === "manual_review"
    ? RenderQaRecommendation.MANUAL_REVIEW
    : RenderQaRecommendation.APPROVE;
}

function qaStatusIsBlocking(status: RenderQaStatus) {
  return status === RenderQaStatus.FAIL;
}

async function ensureOrderPortraitSlots(orderId: string, client = prisma) {
  const [items, existingSlots] = await Promise.all([
    client.orderItem.findMany({
      where: {
        orderId
      },
      orderBy: {
        createdAt: "asc"
      },
      select: {
        id: true,
        quantity: true
      }
    }),
    client.orderPortraitSlot.findMany({
      where: {
        orderId
      },
      orderBy: {
        slotNumber: "asc"
      },
      select: {
        id: true,
        slotNumber: true
      }
    })
  ]);

  const requiredSlots = calculateRequiredPortraitSlots(items);
  const existingSlotNumbers = new Set(existingSlots.map((slot) => slot.slotNumber));
  const slotAssignments = items.flatMap((item) =>
    Array.from({ length: Math.max(1, Math.floor(item.quantity)) }, () => item.id)
  );
  const slotsToCreate = Array.from({ length: requiredSlots }, (_, index) => index + 1)
    .filter((slotNumber) => !existingSlotNumbers.has(slotNumber))
    .map((slotNumber) => ({
      orderId,
      orderItemId: slotAssignments[slotNumber - 1] ?? null,
      slotNumber
    }));

  if (slotsToCreate.length > 0) {
    await client.orderPortraitSlot.createMany({
      data: slotsToCreate,
      skipDuplicates: true
    });
  }

  const slots = await client.orderPortraitSlot.findMany({
    where: {
      orderId
    },
    orderBy: {
      slotNumber: "asc"
    },
    select: {
      id: true,
      slotNumber: true
    }
  });

  const firstSlot = slots[0];
  if (firstSlot) {
    await client.$executeRaw`
      WITH first_upload AS (
        SELECT "id"
        FROM "CustomerUpload"
        WHERE "orderId" = ${orderId}
          AND "portraitSlotId" IS NULL
        ORDER BY "createdAt" ASC
        LIMIT 1
      )
      UPDATE "CustomerUpload" cu
      SET "portraitSlotId" = ${firstSlot.id}
      FROM first_upload
      WHERE cu."id" = first_upload."id"
    `;
    await client.$executeRaw`
      UPDATE "RenderJob" rj
      SET "portraitSlotId" = cu."portraitSlotId"
      FROM "CustomerUpload" cu
      WHERE rj."customerUploadId" = cu."id"
        AND rj."orderId" = ${orderId}
        AND rj."portraitSlotId" IS NULL
        AND cu."portraitSlotId" IS NOT NULL
    `;
    await client.$executeRaw`
      UPDATE "Artifact" a
      SET "portraitSlotId" = rj."portraitSlotId"
      FROM "RenderJob" rj
      WHERE a."renderJobId" = rj."id"
        AND a."orderId" = ${orderId}
        AND a."portraitSlotId" IS NULL
        AND rj."portraitSlotId" IS NOT NULL
    `;
  }

  return slots;
}

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

  await ensureOrderPortraitSlots(order.id);

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
  const uploadCountByOrder = new Map<string, number>();
  for (const { upload } of uploadRows) {
    const orderId = String(upload.orderId ?? "");
    if (orderId) {
      uploadCountByOrder.set(orderId, (uploadCountByOrder.get(orderId) ?? 0) + 1);
    }
    if (orderId && !latestUploadByOrder.has(orderId)) {
      latestUploadByOrder.set(orderId, String(upload.originalName ?? ""));
    }
  }

  return orders.map((order) => ({
    ...order,
    uploadCount: uploadCountByOrder.get(order.id) ?? 0,
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

  await ensureOrderPortraitSlots(orderId);

  const [uploads, artifacts, portraitSlots, qaReports, messageEvents, auditLog] = await Promise.all([
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
          LIMIT 200
        `,
      [] as Array<{ artifact: Record<string, unknown> }>
    ),
    withQueryFallback(
      "getOrderById portrait slots",
      () =>
        prisma.$queryRaw<Array<{ slot: Record<string, unknown> }>>`
          SELECT row_to_json(s) AS "slot"
          FROM "OrderPortraitSlot" s
          WHERE s."orderId" = ${orderId}
          ORDER BY s."slotNumber" ASC
        `,
      [] as Array<{ slot: Record<string, unknown> }>
    ),
    withQueryFallback(
      "getOrderById QA reports",
      () =>
        prisma.$queryRaw<Array<{ report: Record<string, unknown> }>>`
          SELECT row_to_json(rqr) AS "report"
          FROM "RenderQaReport" rqr
          WHERE rqr."orderId" = ${orderId}
          ORDER BY rqr."createdAt" DESC
          LIMIT 100
        `,
      [] as Array<{ report: Record<string, unknown> }>
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
    portraitSlots: portraitSlots.map(({ slot }) => ({
      id: String(slot.id),
      slotNumber: Number(slot.slotNumber ?? 1)
    })),
    uploads: uploads.map(({ upload }) => ({
      id: String(upload.id),
      portraitSlotId: nullableString(upload.portraitSlotId),
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
      portraitSlotId: nullableString(artifact.portraitSlotId),
      kind: String(artifact.kind ?? ArtifactKind.PREVIEW) as ArtifactKind,
      version: Number(artifact.version ?? 1),
      storageKey: String(artifact.storageKey ?? ""),
      createdAt: toDate(artifact.createdAt) ?? new Date(0)
    })),
    qaReports: qaReports.map(({ report }) => ({
      id: String(report.id),
      portraitSlotId: nullableString(report.portraitSlotId),
      artifactId: nullableString(report.artifactId),
      kind: String(report.kind ?? RenderQaKind.LIKENESS) as RenderQaKind,
      status: String(report.status ?? RenderQaStatus.WARNING) as RenderQaStatus,
      recommendation: String(
        report.recommendation ?? RenderQaRecommendation.MANUAL_REVIEW
      ) as RenderQaRecommendation,
      summary: String(report.summary ?? ""),
      issues: Array.isArray(report.issues) ? report.issues : [],
      metadata:
        report.metadata && typeof report.metadata === "object"
          ? (report.metadata as Record<string, unknown>)
          : {},
      createdAt: toDate(report.createdAt) ?? new Date(0)
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

  await ensureOrderPortraitSlots(orderId);

  const [uploads, portraitSlots, finalArtifacts] = await Promise.all([
    withQueryFallback(
      "getOrderByUploadToken uploads",
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
      "getOrderByUploadToken portrait slots",
      () =>
        prisma.$queryRaw<Array<{ slot: Record<string, unknown> }>>`
          SELECT row_to_json(s) AS "slot"
          FROM "OrderPortraitSlot" s
          WHERE s."orderId" = ${orderId}
          ORDER BY s."slotNumber" ASC
        `,
      [] as Array<{ slot: Record<string, unknown> }>
    ),
    withQueryFallback(
      "getOrderByUploadToken artifacts",
      () =>
        prisma.$queryRaw<Array<{ artifact: Record<string, unknown> }>>`
          SELECT row_to_json(a) AS "artifact"
          FROM "Artifact" a
          WHERE a."orderId" = ${orderId}
          ORDER BY a."version" DESC, a."createdAt" DESC
          LIMIT 200
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
    portraitSlots: portraitSlots.map(({ slot }) => ({
      id: String(slot.id),
      slotNumber: Number(slot.slotNumber ?? 1)
    })),
    uploads: uploads.map(({ upload }) => ({
      id: String(upload.id),
      portraitSlotId: nullableString(upload.portraitSlotId),
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
    finalArtifacts: getLatestBySlot(
      finalArtifacts
        .map(({ artifact }) => artifact)
        .filter((artifact) => String(artifact.kind ?? "") === "FINAL_PNG")
        .map((artifact) => ({
          id: String(artifact.id),
          portraitSlotId: nullableString(artifact.portraitSlotId),
          storageKey: String(artifact.storageKey ?? ""),
          createdAt: toDate(artifact.createdAt) ?? new Date(0)
        }))
    ).map((artifact) => ({
        id: String(artifact.id),
        portraitSlotId: nullableString(artifact.portraitSlotId),
        storageKey: String(artifact.storageKey ?? ""),
        createdAt: artifact.createdAt
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
  portraitSlotId,
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
  portraitSlotId: string;
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

  const portraitSlot = await prisma.orderPortraitSlot.findUnique({
    where: {
      id: portraitSlotId
    },
    include: {
      uploads: {
        select: {
          id: true
        }
      }
    }
  });

  if (!portraitSlot || portraitSlot.orderId !== orderId) {
    throw new Error("Selected portrait slot does not belong to this order");
  }

  if (portraitSlot.uploads.length > 0) {
    throw new Error("That portrait slot has already received a photo");
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

  const uploadReceivedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const upload = await tx.customerUpload.create({
      data: {
        orderId,
        portraitSlotId,
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

    const [totalSlots, receivedSlots, blurryUploads] = await Promise.all([
      tx.orderPortraitSlot.count({
        where: {
          orderId
        }
      }),
      tx.customerUpload.count({
        where: {
          orderId,
          portraitSlotId: {
            not: null
          }
        }
      }),
      tx.customerUpload.count({
        where: {
          orderId,
          blurScore: {
            lt: 12
          }
        }
      })
    ]);

    const orderStatus =
      blurryUploads > 0
        ? OrderStatus.NEEDS_MANUAL_ATTENTION
        : receivedSlots >= Math.max(1, totalSlots)
        ? OrderStatus.PHOTO_RECEIVED
        : OrderStatus.AWAITING_PHOTO;

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
      imageInfo.blurScore >= 12
        ? await tx.renderJob.create({
            data: {
              orderId,
              portraitSlotId,
              customerUploadId: upload.id,
              status: RenderJobStatus.QUEUED
            }
          })
        : null;

    return { upload, order, renderJob };
  });

  if (result.renderJob) {
    await dispatchRenderJob(result.renderJob.id);
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

async function dispatchRenderJob(renderJobId: string) {
  const enqueueResult = await settleWithTimeout(
    enqueueRenderJob(renderJobId),
    getRenderQueueEnqueueTimeoutMs(),
    new Error("Render queue enqueue timed out")
  );

  if (!enqueueResult.ok) {
    console.error("[render] failed to enqueue render job", enqueueResult.error);
  }

  try {
    await triggerGitHubRender(renderJobId);
  } catch (error) {
    console.error("[render] failed to trigger github worker", error);
  }
}

async function settleWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: Error
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    const value = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(timeoutError), timeoutMs);
      })
    ]);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

function getRenderQueueEnqueueTimeoutMs() {
  const timeoutMs = Number(process.env.RENDER_QUEUE_ENQUEUE_TIMEOUT_MS ?? 5000);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000;
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

    const blurryUploadCount = await prisma.customerUpload.count({
      where: {
        orderId: renderJob.orderId,
        blurScore: {
          lt: 12
        }
      }
    });

    const [order, artifactCount] = await Promise.all([
      prisma.order.update({
        where: {
          id: renderJob.orderId
        },
        data: {
          status: blurryUploadCount > 0 ? OrderStatus.NEEDS_MANUAL_ATTENTION : OrderStatus.RENDERING
        }
      }),
      prisma.artifact.count({
        where: {
          orderId: renderJob.orderId,
          portraitSlotId: renderJob.portraitSlotId
        }
      })
    ]);

    const source = await getBuffer(upload.storageKey);
    const version = Math.floor(artifactCount / 2) + 1;
    const output = await renderPortrait({
      source,
      petName: upload.petName,
      notes: upload.notes,
      fontStyle: posterFontStyleFromDb(upload.fontStyle),
      backgroundStyle: posterBackgroundStyleFromDb(upload.backgroundStyle),
      orderId: order.id,
      version
    });
    const compositionQaStatus = mapCompositionQaStatus(output.compositionQa);
    const likenessQaStatus = mapLikenessQaStatus(output.likenessQa);
    const hasBlockingQa =
      qaStatusIsBlocking(compositionQaStatus) || qaStatusIsBlocking(likenessQaStatus);

    await prisma.$transaction(async (tx) => {
      const previewArtifact = await tx.artifact.create({
        data: {
          orderId: order.id,
          portraitSlotId: renderJob.portraitSlotId,
          renderJobId: renderJob.id,
          kind: ArtifactKind.PREVIEW,
          version,
          storageKey: output.previewKey,
          mimeType: "image/png"
        }
      });
      const finalArtifact = await tx.artifact.create({
        data: {
          orderId: order.id,
          portraitSlotId: renderJob.portraitSlotId,
          renderJobId: renderJob.id,
          kind: ArtifactKind.FINAL_PNG,
          version,
          storageKey: output.finalPngKey,
          mimeType: "image/png"
        }
      });

      await tx.renderQaReport.createMany({
        data: [
          {
            orderId: order.id,
            portraitSlotId: renderJob.portraitSlotId,
            renderJobId: renderJob.id,
            artifactId: finalArtifact.id,
            kind: RenderQaKind.COMPOSITION,
            status: compositionQaStatus,
            recommendation: mapCompositionQaRecommendation(output.compositionQa),
            summary: output.compositionQa.warnings.length
              ? `Composition QA warnings: ${output.compositionQa.warnings.join(", ")}`
              : "Composition QA passed.",
            issues: output.compositionQa.warnings as never,
            metadata: output.compositionQa as never
          },
          {
            orderId: order.id,
            portraitSlotId: renderJob.portraitSlotId,
            renderJobId: renderJob.id,
            artifactId: finalArtifact.id,
            kind: RenderQaKind.LIKENESS,
            status: likenessQaStatus,
            recommendation: mapLikenessQaRecommendation(output.likenessQa),
            summary: output.likenessQa.summary,
            issues: output.likenessQa.issues as never,
            metadata: {
              ...output.likenessQa,
              traitAnalysis: output.traitAnalysis,
              portraitBaseKey: output.portraitBaseKey,
              previewArtifactId: previewArtifact.id
            } as never
          }
        ]
      });

      await tx.renderJob.update({
        where: {
          id: renderJob.id
        },
        data: {
          status: RenderJobStatus.SUCCEEDED,
          completedAt: new Date(),
          failureReason: null
        }
      });
      await tx.order.update({
        where: {
          id: order.id
        },
        data: {
          auditLog: {
            create: {
              action: hasBlockingQa ? "render.qa_failed" : "render.completed",
              metadata: {
                ...output,
                portraitSlotId: renderJob.portraitSlotId,
                qaStatus: {
                  composition: compositionQaStatus,
                  likeness: likenessQaStatus
                }
              }
            }
          }
        }
      });
    });

    const [totalSlots, uploadedSlots, blurryUploads, finalSlotGroups] = await Promise.all([
      prisma.orderPortraitSlot.count({
        where: {
          orderId: order.id
        }
      }),
      prisma.customerUpload.count({
        where: {
          orderId: order.id,
          portraitSlotId: {
            not: null
          }
        }
      }),
      prisma.customerUpload.count({
        where: {
          orderId: order.id,
          blurScore: {
            lt: 12
          }
        }
      }),
      prisma.artifact.groupBy({
        by: ["portraitSlotId"],
        where: {
          orderId: order.id,
          kind: ArtifactKind.FINAL_PNG,
          portraitSlotId: {
            not: null
          }
        }
      })
    ]);

    await prisma.order.update({
      where: {
        id: order.id
      },
      data: {
        status:
          blurryUploads > 0 || hasBlockingQa
            ? OrderStatus.NEEDS_MANUAL_ATTENTION
            : finalSlotGroups.length >= Math.max(1, totalSlots)
            ? OrderStatus.AWAITING_APPROVAL
            : uploadedSlots < Math.max(1, totalSlots)
            ? OrderStatus.AWAITING_PHOTO
            : OrderStatus.RENDERING
      }
    });

    if (!hasBlockingQa && finalSlotGroups.length >= Math.max(1, totalSlots)) {
      const finalArtifacts = await prisma.artifact.findMany({
        where: {
          orderId: order.id,
          kind: ArtifactKind.FINAL_PNG
        },
        orderBy: [
          {
            version: "desc"
          },
          {
            createdAt: "desc"
          }
        ],
        select: {
          id: true,
          portraitSlotId: true,
          storageKey: true,
          createdAt: true
        }
      });

      await sendOpsApprovalEmailIfNeeded({
        orderId: order.id,
        receiptId: order.receiptId,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        deliveryEmail: order.deliveryEmail,
        finalPngKeys: getLatestBySlot(finalArtifacts).map((artifact) => artifact.storageKey)
      });
    }
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

  const [finalArtifacts, totalSlots, finalSlotGroups] = await Promise.all([
    prisma.artifact.findMany({
      where: {
        orderId: order.id,
        kind: ArtifactKind.FINAL_PNG
      },
      orderBy: [
        {
          version: "desc"
        },
        {
          createdAt: "desc"
        }
      ],
      select: {
        id: true,
        portraitSlotId: true,
        storageKey: true,
        createdAt: true
      }
    }),
    prisma.orderPortraitSlot.count({
      where: {
        orderId: order.id
      }
    }),
    prisma.artifact.groupBy({
      by: ["portraitSlotId"],
      where: {
        orderId: order.id,
        kind: ArtifactKind.FINAL_PNG,
        portraitSlotId: {
          not: null
        }
      }
    })
  ]);

  const latestFinalArtifacts = getLatestBySlot(finalArtifacts);

  if (latestFinalArtifacts.length === 0) {
    throw new Error("Cannot approve before a final portrait is generated");
  }

  if (finalSlotGroups.length < Math.max(1, totalSlots)) {
    throw new Error("Cannot approve before every purchased portrait has a final image");
  }

  const blockingQaReports = await prisma.renderQaReport.findMany({
    where: {
      artifactId: {
        in: latestFinalArtifacts.map((artifact) => artifact.id)
      },
      status: RenderQaStatus.FAIL
    },
    select: {
      kind: true,
      summary: true
    }
  });

  if (blockingQaReports.length > 0) {
    throw new Error(
      `Cannot approve while render QA has blocking failures: ${blockingQaReports
        .map((report) => `${report.kind}: ${report.summary}`)
        .join("; ")}`
    );
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
    portraitSlotId?: string;
    deferInlineProcessing?: boolean;
    skipProcessing?: boolean;
  }
) {
  const latestUpload = await prisma.customerUpload.findFirst({
    where: {
      orderId,
      ...(options?.portraitSlotId ? { portraitSlotId: options.portraitSlotId } : {})
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (!latestUpload) {
    throw new Error(
      options?.portraitSlotId
        ? "Selected portrait has no uploaded photo"
        : "Order has no uploaded photo"
    );
  }

  const attempt = (await prisma.renderJob.count({ where: { orderId } })) + 1;
  const renderJob = await prisma.renderJob.create({
    data: {
      orderId,
      portraitSlotId: latestUpload.portraitSlotId,
      customerUploadId: latestUpload.id,
      status: RenderJobStatus.QUEUED,
      attempt
    }
  });

  const blurryUploads = await prisma.customerUpload.count({
    where: {
      orderId,
      blurScore: {
        lt: 12
      }
    }
  });

  await prisma.order.update({
    where: {
      id: orderId
    },
    data: {
      status: blurryUploads > 0 ? OrderStatus.NEEDS_MANUAL_ATTENTION : OrderStatus.PHOTO_RECEIVED
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
    await dispatchRenderJob(renderJob.id);
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
  finalPngKeys
}: {
  orderId: string;
  receiptId: string;
  buyerName: string;
  buyerEmail: string | null;
  deliveryEmail: string | null;
  finalPngKeys: string[];
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
    const portraits = await Promise.all(finalPngKeys.map((finalPngKey) => getBuffer(finalPngKey)));
    const result = await sendEmail({
      to: OPS_EMAIL,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `ops-approval-${orderId}`,
      attachments: portraits.map((portrait, index) => ({
        filename:
          portraits.length > 1
            ? `pawprints-${receiptId}-portrait-${index + 1}.png`
            : `pawprints-${receiptId}.png`,
        content: portrait,
        contentType: "image/png"
      }))
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
              finalPngKeys,
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
              finalPngKeys,
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
