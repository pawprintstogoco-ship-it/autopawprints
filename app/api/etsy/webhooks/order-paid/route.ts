import { NextResponse } from "next/server";
import {
  fetchEtsyReceiptByResourceUrl,
  normalizeReceiptPayload,
  normalizeWebhookEnvelope,
  verifyEtsyWebhookSignature
} from "@/lib/etsy";
import {
  hasWebhookDelivery,
  ingestOrderPaidWebhook,
  registerWebhookDelivery
} from "@/lib/orders";
import { requireEnv } from "@/lib/env";

export async function POST(request: Request) {
  const body = await request.text();
  const webhookId = request.headers.get("webhook-id");
  const webhookTimestamp = request.headers.get("webhook-timestamp");
  const signature = request.headers.get("webhook-signature");

  if (
    !verifyEtsyWebhookSignature({
      body,
      signatureHeader: signature,
      webhookId,
      webhookTimestamp
    })
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (webhookId && (await hasWebhookDelivery(webhookId))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const envelope = normalizeWebhookEnvelope(payload as never);
    const env = requireEnv();

    if (envelope.eventType !== "ORDER_PAID") {
      if (webhookId) {
        await registerWebhookDelivery({
          externalWebhookId: webhookId,
          eventType: envelope.eventType,
          resourceUrl: envelope.resourceUrl,
          payload
        });
      }
      return NextResponse.json({ ok: true, ignored: envelope.eventType });
    }

    if (!envelope.resourceUrl) {
      return NextResponse.json({ error: "Missing Etsy resource URL" }, { status: 400 });
    }

    const receipt = await fetchEtsyReceiptByResourceUrl(envelope.resourceUrl);
    const normalized = normalizeReceiptPayload(receipt);
    const order = await ingestOrderPaidWebhook({
      event_id: webhookId ?? undefined,
      event_type: envelope.eventType,
      shop_id: envelope.shopId ?? env.ETSY_SHOP_ID,
      receipt_id: normalized.receiptId,
      created_timestamp: normalized.createdTimestamp,
      buyer_name: normalized.buyerName,
      buyer_email: normalized.buyerEmail,
      listing_id: normalized.listingId,
      personalization: normalized.personalization,
      transactions: normalized.transactions.map((transaction) => ({
        transaction_id: transaction.transactionId,
        title: transaction.title,
        quantity: transaction.quantity,
        price_amount: transaction.priceAmount,
        currency_code: transaction.currencyCode
      })),
      resource_url: envelope.resourceUrl
    });

    if (webhookId) {
      await registerWebhookDelivery({
        externalWebhookId: webhookId,
        eventType: envelope.eventType,
        resourceUrl: envelope.resourceUrl,
        payload,
        orderId: order.id
      });
    }

    return NextResponse.json({ ok: true, orderId: order.id });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to ingest order"
      },
      { status: 500 }
    );
  }
}
