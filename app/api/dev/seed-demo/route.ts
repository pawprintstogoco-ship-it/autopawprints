import { NextResponse } from "next/server";
import { MessageChannel, OrderStatus } from "@prisma/client";
import { requireAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireEnv } from "@/lib/env";
import { createToken } from "@/lib/tokens";

export async function POST(request: Request) {
  await requireAdminSession();
  const env = requireEnv();
  const seedCount = 6;

  for (let index = 0; index < seedCount; index += 1) {
    const uploadToken = createToken();
    const stamp = `${Date.now()}-${index}`;
    const order = await prisma.order.create({
      data: {
        shopId: env.ETSY_SHOP_ID,
        receiptId: `demo-${stamp}`,
        eventId: `demo-event-${stamp}`,
        etsyOrderCreatedAt: new Date(),
        buyerName: "Demo Buyer",
        buyerEmail: "demo@example.com",
        listingId: env.ETSY_PILOT_LISTING_ID,
        pilotListingEligible: true,
        status: OrderStatus.AWAITING_PHOTO,
        uploadToken,
        uploadTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
      }
    });

    await Promise.allSettled([
      prisma.orderItem.create({
        data: {
          orderId: order.id,
          transactionId: `demo-txn-${stamp}`,
          title: "Pilot Pet Portrait",
          quantity: 1
        }
      }),
      prisma.messageEvent.create({
        data: {
          orderId: order.id,
          channel: MessageChannel.INTERNAL,
          eventType: "seed.ready",
          body: `Demo upload link: ${env.APP_URL}/upload/${uploadToken}`
        }
      }),
      prisma.auditLog.create({
        data: {
          orderId: order.id,
          action: "seed.created"
        }
      })
    ]);
  }

  return NextResponse.redirect(new URL(`/orders?seeded=${seedCount}`, request.url), {
    status: 303
  });
}
