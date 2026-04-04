import { NextResponse } from "next/server";
import { OrderStatus } from "@prisma/client";
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
    await prisma.order.create({
      data: {
        shopId: env.ETSY_SHOP_ID,
        receiptId: `demo-${stamp}`,
        eventId: `demo-event-${stamp}`,
        etsyOrderCreatedAt: new Date(),
        buyerName: "Demo Buyer",
        buyerEmail: "demo@example.com",
        listingId: env.ETSY_PILOT_LISTING_ID,
        personalization: `Demo seeded order ${index + 1}`,
        pilotListingEligible: true,
        pilotListingMatched: true,
        intakeSource: "seed_demo",
        status: OrderStatus.AWAITING_PHOTO,
        uploadToken,
        uploadTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        items: {
          create: [
            {
              transactionId: `demo-txn-${stamp}`,
              title: "Pilot Pet Portrait",
              quantity: 1
            }
          ]
        },
        messageEvents: {
          create: [
            {
              channel: "INTERNAL",
              eventType: "seed.ready",
              body: `Demo upload link: ${env.APP_URL}/upload/${uploadToken}`
            }
          ]
        }
      }
    });
  }

  return NextResponse.redirect(new URL(`/orders?seeded=${seedCount}`, request.url), {
    status: 303
  });
}
