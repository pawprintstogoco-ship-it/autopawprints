import { describe, expect, it, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.APP_URL = "http://localhost:3010";
  process.env.ETSY_DIGITAL_SALE_MESSAGE_TEMPLATE =
    "Upload your pet photo here: {{UPLOAD_URL}}";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/pawprints";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.ADMIN_EMAIL = "owner@pawprintsca.com";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.STORAGE_ROOT = "./storage";
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_SECURE = "false";
  process.env.SMTP_USER = "example";
  process.env.SMTP_PASSWORD = "example";
  process.env.MAIL_FROM = "PawPrints <hello@pawprintsca.com>";
  process.env.RESEND_API_KEY = "";
  process.env.EMAIL_FROM = "PawPrints <hello@pawprintsca.com>";
  process.env.OPS_EMAIL = "pawprintstogoco@gmail.com";
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

  it("requests Etsy write scope for receipt completion", async () => {
    const { getEtsyScopes } = await import("../lib/etsy");
    expect(getEtsyScopes()).toContain("transactions_w");
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
  it("normalizes redirect targets to internal paths", async () => {
    const { getSafeRedirectPath } = await import("../lib/http");
    expect(getSafeRedirectPath("/orders/files?tab=recent", "/fallback")).toBe(
      "/orders/files?tab=recent"
    );
    expect(getSafeRedirectPath("https://evil.example/phish", "/fallback")).toBe("/fallback");
    expect(getSafeRedirectPath("//evil.example/phish", "/fallback")).toBe("/fallback");
  });

  it("allows only safe customer upload image types", async () => {
    const { isAllowedUploadMimeType, MAX_UPLOAD_BYTES } = await import("../lib/uploads");
    expect(isAllowedUploadMimeType("image/png")).toBe(true);
    expect(isAllowedUploadMimeType("image/svg+xml")).toBe(false);
    expect(MAX_UPLOAD_BYTES).toBe(15 * 1024 * 1024);
  });

  it("renders rasterized fallback previews for untrusted labels", async () => {
    const { buildSafeFallbackPreview } = await import("../lib/previews");
    const fallback = await buildSafeFallbackPreview('</text><script>alert("xss")</script>');

    expect(fallback.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(fallback.includes(Buffer.from("<script>"))).toBe(false);
  });
});

describe("email helpers", () => {
  it("normalizes and deduplicates customer recipients", async () => {
    const { getCustomerEmailRecipients } = await import("../lib/email");

    expect(
      getCustomerEmailRecipients(
        "Buyer@Example.com",
        " buyer@example.com ",
        "delivery@example.com",
        "not-an-email"
      )
    ).toEqual(["buyer@example.com", "delivery@example.com"]);
  });

  it("builds approval email copy with order context", async () => {
    const { buildOpsApprovalEmail } = await import("../lib/email");
    const email = buildOpsApprovalEmail({
      buyerName: "Maple Buyer",
      receiptId: "12345",
      buyerEmail: "etsy@example.com",
      deliveryEmail: "delivery@example.com",
      adminUrl: "http://localhost:3010/orders/order_123"
    });

    expect(email.subject).toContain("12345");
    expect(email.text).toContain("Maple Buyer");
    expect(email.text).toContain("etsy@example.com");
    expect(email.text).toContain("delivery@example.com");
    expect(email.text).toContain("http://localhost:3010/orders/order_123");
  });
});
