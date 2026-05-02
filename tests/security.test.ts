import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createCookieStore() {
  const values = new Map<string, string>();

  return {
    values,
    set(name: string, value: string) {
      values.set(name, value);
    },
    get(name: string) {
      const value = values.get(name);
      return value ? { value } : undefined;
    },
    delete(name: string) {
      values.delete(name);
    }
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  process.env.APP_URL = "http://localhost:3010";
  process.env.ETSY_DIGITAL_SALE_MESSAGE_TEMPLATE =
    "Upload your pet photo here: {{UPLOAD_URL}}";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/pawprints";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.ADMIN_EMAIL = "owner@pawprintsca.com";
  process.env.GOOGLE_CLIENT_ID = "google-client";
  process.env.GOOGLE_CLIENT_SECRET = "google-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI =
    "http://localhost:3010/api/admin/oauth/google/callback";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.STORAGE_ROOT = "./storage";
  process.env.RESEND_API_KEY = "";
  process.env.EMAIL_FROM = "PawPrints <hello@pawprintsca.com>";
  process.env.OPS_EMAIL = "pawprintstogoco@gmail.com";
  process.env.DELIVERY_LINK_TTL_HOURS = "168";
  process.env.ETSY_CLIENT_ID = "etsy-client";
  process.env.ETSY_CLIENT_SECRET = "etsy-secret";
  process.env.ETSY_REDIRECT_URI = "http://localhost:3010/api/etsy/oauth/callback";
  process.env.ETSY_SHOP_ID = "12345678";
  process.env.ETSY_PILOT_LISTING_ID = "987654321";
  process.env.ETSY_WEBHOOK_CALLBACK_URL =
    "http://localhost:3010/api/etsy/webhooks/order-paid";
  process.env.ETSY_WEBHOOK_SIGNING_SECRET = `whsec_${Buffer.from("webhook_secret").toString("base64")}`;
  process.env.ETSY_API_BASE_URL = "https://api.etsy.com/v3";
});

afterEach(() => {
  vi.doUnmock("@/lib/prisma");
  vi.doUnmock("next/headers");
  vi.doUnmock("next/navigation");
  vi.unstubAllGlobals();
});

describe("admin session security", () => {
  it("stores opaque session tokens server-side and extends idle expiry on access", async () => {
    const cookieStore = createCookieStore();
    const adminSession = {
      create: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue(undefined),
      findUnique: vi.fn().mockResolvedValue({
        email: "owner@pawprintsca.com",
        idleExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }),
      update: vi.fn().mockResolvedValue(undefined)
    };

    vi.doMock("next/headers", () => ({
      cookies: vi.fn(async () => cookieStore)
    }));
    vi.doMock("next/navigation", () => ({
      redirect: vi.fn((location: string) => {
        throw new Error(`redirect:${location}`);
      })
    }));
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        adminSession
      }
    }));

    const { createAdminSession, requireAdminSession } = await import("../lib/auth");

    await createAdminSession("owner@pawprintsca.com");

    const rawToken = cookieStore.values.get("pawprints_admin_session");
    expect(rawToken).toBeTruthy();
    expect(rawToken).not.toContain("owner@pawprintsca.com");
    expect(adminSession.create).toHaveBeenCalledTimes(1);
    expect(adminSession.create.mock.calls[0]?.[0]?.data?.sessionHash).not.toBe(rawToken);

    const session = await requireAdminSession();
    expect(session).toEqual({ email: "owner@pawprintsca.com" });
    expect(adminSession.update).toHaveBeenCalledTimes(1);
  });

  it("rejects expired server-side sessions", async () => {
    const cookieStore = createCookieStore();
    cookieStore.set("pawprints_admin_session", "opaque-token");
    const adminSession = {
      findUnique: vi.fn().mockResolvedValue({
        email: "owner@pawprintsca.com",
        idleExpiresAt: new Date(Date.now() - 60_000),
        absoluteExpiresAt: new Date(Date.now() + 60_000)
      }),
      delete: vi.fn().mockResolvedValue(undefined)
    };

    vi.doMock("next/headers", () => ({
      cookies: vi.fn(async () => cookieStore)
    }));
    vi.doMock("next/navigation", () => ({
      redirect: vi.fn((location: string) => {
        throw new Error(`redirect:${location}`);
      })
    }));
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        adminSession
      }
    }));

    const { requireAdminSession } = await import("../lib/auth");

    await expect(requireAdminSession()).rejects.toThrow("redirect:/login");
    expect(adminSession.delete).toHaveBeenCalledTimes(1);
    expect(cookieStore.get("pawprints_admin_session")).toEqual({ value: "opaque-token" });
  });

  it("rejects Google OAuth callbacks for the wrong email address", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "google-access-token",
          token_type: "Bearer"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: "someoneelse@example.com",
          email_verified: true
        })
      });

    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("@/lib/auth", () => ({
      isGoogleOAuthConfigured: () => true,
      consumeAdminOAuthState: vi.fn().mockResolvedValue("expected-state"),
      createAdminSession: vi.fn()
    }));

    const { GET } = await import("../app/api/admin/oauth/google/callback/route");
    const response = await GET(
      new Request(
        "http://localhost:3010/api/admin/oauth/google/callback?code=auth-code&state=expected-state"
      )
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3010/login?error=oauth_email"
    );
  });
});

describe("etsy fetch hardening", () => {
  it("rejects off-origin receipt URLs before making an outbound request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        etsyConnection: {
          findUnique: vi.fn().mockResolvedValue({
            accessToken: "access-token",
            refreshToken: "refresh-token",
            scope: "shops_r shops_w transactions_r",
            accessExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
          }),
          update: vi.fn()
        }
      }
    }));

    const { fetchEtsyReceiptByResourceUrl } = await import("../lib/etsy");

    await expect(
      fetchEtsyReceiptByResourceUrl("https://evil.example/application/shops/1/receipts/2")
    ).rejects.toThrow("configured Etsy API origin");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
