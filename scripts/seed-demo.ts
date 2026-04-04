import { OrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireEnv } from "../lib/env";
import { createToken } from "../lib/tokens";

async function main() {
  const env = requireEnv();
  const seedCount = 6;

  for (let index = 0; index < seedCount; index += 1) {
    const uploadToken = createToken();
    const stamp = `${Date.now()}-${index}`;
    const receiptId = `demo-${stamp}`;
    const order = await prisma.order.create({
      data: {
        shopId: env.ETSY_SHOP_ID,
        receiptId,
        eventId: `demo-event-${stamp}`,
        etsyOrderCreatedAt: new Date(),
        buyerName: "Demo Buyer",
        buyerEmail: "demo@example.com",
        listingId: env.ETSY_PILOT_LISTING_ID,
        personalization: `Please use the name Maple (${index + 1}).`,
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
              channel: "ETSY",
              eventType: "sale_message.prepared",
              body: `Upload your pet photo here: ${env.APP_URL}/upload/${uploadToken}`
            }
          ]
        },
        auditLog: {
          create: [
            {
              action: "seed.created"
            }
          ]
        }
      }
    });

    console.log(`Seeded order ${order.receiptId}`);
    console.log(`Upload URL: ${env.APP_URL}/upload/${order.uploadToken}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
