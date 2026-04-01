import { describe, expect, it, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.APP_URL = "http://localhost:3010";
  process.env.WEBHOOK_SHARED_SECRET = "secret";
  process.env.ETSY_DIGITAL_SALE_MESSAGE_TEMPLATE =
    "Upload your pet photo here: {{UPLOAD_URL}}";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/pawprints";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.ADMIN_EMAIL = "owner@pawprintsca.com";
  process.env.ADMIN_PASSWORD = "password123";
  process.env.SESSION_SECRET = "12345678901234567890";
  process.env.STORAGE_ROOT = "./storage";
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_SECURE = "false";
  process.env.SMTP_USER = "example";
  process.env.SMTP_PASSWORD = "example";
  process.env.MAIL_FROM = "PawPrints <hello@pawprintsca.com>";
  process.env.DELIVERY_LINK_TTL_HOURS = "168";
  process.env.ETSY_CLIENT_ID = "etsy-client";
  process.env.ETSY_CLIENT_SECRET = "";
  process.env.ETSY_REDIRECT_URI = "http://localhost:3010/api/etsy/oauth/callback";
  process.env.ETSY_SHOP_ID = "12345678";
  process.env.ETSY_PILOT_LISTING_ID = "987654321";
  process.env.ETSY_WEBHOOK_CALLBACK_URL =
    "http://localhost:3010/api/etsy/webhooks/order-paid";
  process.env.ETSY_WEBHOOK_SIGNING_SECRET = "whsec_secret";
  process.env.ETSY_API_BASE_URL = "https://api.etsy.com/v3";
});

describe("etsy helpers", () => {
  it("replaces upload URL in sale message", async () => {
    const { buildDigitalSaleMessage } = await import("../lib/etsy");
    expect(buildDigitalSaleMessage("http://localhost:3010/upload/token")).toContain(
      "http://localhost:3010/upload/token"
    );
  });

  it("verifies Etsy webhook signature", async () => {
    const { createHmac } = await import("node:crypto");
    const { verifyEtsyWebhookSignature } = await import("../lib/etsy");
    const payload = JSON.stringify({ ok: true });
    const webhookId = "evt_123";
    const webhookTimestamp = "1712000000";
    const signedPayload = `${webhookId}.${webhookTimestamp}.${payload}`;
    const signature = createHmac("sha256", "whsec_secret")
      .update(signedPayload)
      .digest("base64");
    expect(
      verifyEtsyWebhookSignature({
        body: payload,
        signatureHeader: signature,
        webhookId,
        webhookTimestamp
      })
    ).toBe(true);
    expect(
      verifyEtsyWebhookSignature({
        body: payload,
        signatureHeader: "wrong",
        webhookId,
        webhookTimestamp
      })
    ).toBe(false);
  });

  it("normalizes webhook envelopes and receipt payloads", async () => {
    const { normalizeReceiptPayload, normalizeWebhookEnvelope } = await import("../lib/etsy");
    expect(
      normalizeWebhookEnvelope({
        event_name: "ORDER_PAID",
        resource_url: "/application/shops/123/receipts/456",
        data: { shop_id: 123, receipt_id: 456 }
      })
    ).toEqual({
      eventType: "ORDER_PAID",
      resourceUrl: "/application/shops/123/receipts/456",
      shopId: "123",
      receiptId: "456"
    });

    expect(
      normalizeReceiptPayload({
        receipt_id: 456,
        create_timestamp: 1712000000,
        name: "Buyer",
        buyer_email: "buyer@example.com",
        message_from_buyer: "Please use Maple",
        transactions: [
          {
            transaction_id: 789,
            title: "Portrait",
            quantity: 1,
            listing_id: 987,
            price: { amount: 2000, currency_code: "USD" }
          }
        ]
      })
    ).toEqual({
      receiptId: "456",
      createdTimestamp: 1712000000,
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
      personalization: "Please use Maple",
      listingId: "987",
      transactions: [
        {
          transactionId: "789",
          title: "Portrait",
          quantity: 1,
          priceAmount: 2000,
          currencyCode: "USD"
        }
      ]
    });
  });
});

describe("storage helpers", () => {
  it("builds file URLs without collapsing path segments", async () => {
    const { getPublicFileUrl } = await import("../lib/storage");
    expect(getPublicFileUrl("orders/demo/final.pdf")).toBe(
      "http://localhost:3010/api/files/orders/demo/final.pdf"
    );
  });
});
