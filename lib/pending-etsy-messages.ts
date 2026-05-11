import { MessageChannel, OrderStatus } from "@prisma/client";
import { buildDigitalSaleMessage } from "@/lib/etsy";
import { requireEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export async function getPendingInitialEtsyUploadMessages() {
  const env = requireEnv();
  const terminalEvents = [
    "openclaw.initial_upload_message.sent",
    "openclaw.initial_upload_message.skipped"
  ];
  const orders = await prisma.order.findMany({
    where: {
      status: OrderStatus.AWAITING_PHOTO,
      pilotListingEligible: true,
      receiptId: {
        not: {
          startsWith: "demo-"
        }
      },
      messageEvents: {
        none: {
          eventType: {
            in: terminalEvents
          }
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      receiptId: true,
      buyerName: true,
      listingId: true,
      uploadToken: true,
      createdAt: true,
      messageEvents: {
        orderBy: {
          createdAt: "desc"
        },
        take: 10,
        select: {
          eventType: true,
          channel: true,
          body: true,
          createdAt: true
        }
      }
    }
  });

  return orders.map((order) => {
    const uploadUrl = `${env.APP_URL}/upload/${order.uploadToken}`;
    return {
      orderId: order.id,
      receiptId: order.receiptId,
      buyerName: order.buyerName,
      listingId: order.listingId,
      orderUrl: `${env.APP_URL}/orders/${order.id}`,
      uploadUrl,
      initialMessage: buildDigitalSaleMessage(uploadUrl),
      createdAt: order.createdAt,
      recentEvents: order.messageEvents.map((event) => ({
        eventType: event.eventType,
        channel: event.channel as MessageChannel,
        body: event.body,
        createdAt: event.createdAt
      }))
    };
  });
}
