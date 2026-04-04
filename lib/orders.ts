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
      resourceUrl: payload.resource_url,
      pilotListingEligible,
      pilotListingMatched,
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
      pilotListingMatched,
      intakeSource: "etsy_webhook",
      resourceUrl: payload.resource_url,
      status: pilotListingEligible
        ? OrderStatus.AWAITING_PHOTO
        : OrderStatus.NEEDS_MANUAL_ATTENTION,
      uploadToken,
      uploadTokenExpiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30),
      items: {
        create:
          payload.transactions?.map((transaction) => ({
            transactionId: transaction.transaction_id,
            title: transaction.title,
            quantity: transaction.quantity ?? 1,
            priceAmount: transaction.price_amount,
            currencyCode: transaction.currency_code
          })) ?? []
      },
      auditLog: {
        create: [
          {
            action: "order.created",
            metadata: {
              payload,
              pilotListingEligible
            }
          }
        ]
      },
      messageEvents: {
        create: [
          {
            channel: MessageChannel.ETSY,
            eventType: "sale_message.prepared",
            body: saleMessage
          }
        ]
      }
    },
    include: {
      items: true
    }
  });

  if (pilotListingEligible) {
    await scheduleMissingPhotoReminders(order.id, order.createdAt);
  } else {
    await prisma.order.update({
      where: {
        id: order.id
      },
      data: {
        messageEvents: {
          create: {
            channel: MessageChannel.INTERNAL,
            eventType: "pilot_listing.mismatch",
            body: `Receipt ${order.receiptId} is outside the pilot listing and needs manual handling.`
          }
        }
      }
    });
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
  const orders = await prisma.order.findMany({
    where: status ? { status } : undefined,
    include: {
      uploads: {
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      },
      artifacts: {
        where: {
          kind: ArtifactKind.PREVIEW
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return orders.map((order) => ({
    id: order.id,
    receiptId: order.receiptId,
    buyerName: order.buyerName,
    status: order.status,
    pilotListingEligible: order.pilotListingEligible,
    pilotListingMatched: order.pilotListingMatched,
    createdAt: order.createdAt,
    photoReceivedAt: order.photoReceivedAt,
    approvedAt: order.approvedAt,
    deliveredAt: order.deliveredAt,
    uploadCount: order.uploads.length,
    latestUploadName: order.uploads[0]?.originalName ?? null,
    latestPreviewKey: order.artifacts[0]?.storageKey ?? null
  }));
}

export async function getAdminUploadGallery() {
  return prisma.customerUpload.findMany({
    include: {
      order: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

export async function getAdminGeneratedGallery() {
  return prisma.artifact.findMany({
    where: {
      kind: {
        in: [ArtifactKind.PREVIEW, ArtifactKind.FINAL_PNG]
      }
    },
    include: {
      order: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
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
  return prisma.order.findUnique({
    where: {
      id: orderId
    },
    include: {
      items: true,
      uploads: {
        orderBy: {
          createdAt: "desc"
        }
      },
      artifacts: {
        orderBy: {
          createdAt: "desc"
        }
      },
      renderJobs: {
        orderBy: {
          createdAt: "desc"
        }
      },
      messageEvents: {
        orderBy: {
          createdAt: "desc"
        }
      },
      deliveryEvents: {
        orderBy: {
          createdAt: "desc"
        }
      },
      auditLog: {
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });
}

export async function getOrderByUploadToken(token: string) {
  const orders = await prisma.$queryRaw<
    Array<{
      id: string;
      buyerName: string;
      receiptId: string;
      status: OrderStatus;
    }>
  >`
    SELECT "id", "buyerName", "receiptId", "status"
    FROM "Order"
    WHERE "uploadToken" = ${token}
      AND "uploadTokenExpiresAt" > NOW()
    LIMIT 1
  `;

  const order = orders[0];

  if (!order) {
    return null;
  }

  const uploads = await prisma.$queryRaw<
    Array<{
      id: string;
      petName: string;
      createdAt: Date;
    }>
  >`
    SELECT "id", "petName", "createdAt"
    FROM "CustomerUpload"
    WHERE "orderId" = ${order.id}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;

  const finalArtifacts = await prisma.$queryRaw<
    Array<{
      id: string;
      storageKey: string;
      createdAt: Date;
    }>
  >`
    SELECT "id", "storageKey", "createdAt"
    FROM "Artifact"
    WHERE "orderId" = ${order.id}
      AND "kind" = 'FINAL_PNG'
    ORDER BY "version" DESC, "createdAt" DESC
    LIMIT 1
  `;

  return {
    ...order,
    uploads,
    finalArtifacts
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

  const upload = await prisma.customerUpload.create({
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

  const orderStatus =
    imageInfo.blurScore < 12 ? OrderStatus.NEEDS_MANUAL_ATTENTION : OrderStatus.PHOTO_RECEIVED;

  const order = await prisma.order.update({
    where: {
      id: orderId
    },
    data: {
      status: orderStatus,
      photoReceivedAt: new Date(),
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

  if (orderStatus === OrderStatus.PHOTO_RECEIVED) {
    const renderJob = await prisma.renderJob.create({
      data: {
        orderId,
        customerUploadId: upload.id,
        status: RenderJobStatus.QUEUED
      }
    });

    if (shouldRunInlineJobs()) {
      await processRenderJob(renderJob.id);
    } else {
      await enqueueRenderJob(renderJob.id);
    }
  }

  return { upload, order };
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

function shouldRunInlineJobs() {
  return process.env.VERCEL === "1";
}
