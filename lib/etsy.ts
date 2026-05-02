import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const OAUTH_STATE_COOKIE = "pawprints_etsy_state";
const OAUTH_VERIFIER_COOKIE = "pawprints_etsy_verifier";
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

type EtsyWebhookEnvelope = {
  event_name?: string;
  event_type?: string;
  resource?: string;
  resource_url?: string;
  shop_id?: number | string;
  receipt_id?: number | string;
  data?: {
    shop_id?: number | string;
    receipt_id?: number | string;
  };
};

type EtsyReceiptResponse = {
  receipt_id: number | string;
  create_timestamp: number;
  name?: string;
  first_line?: string;
  buyer_email?: string;
  message_from_buyer?: string;
  transactions?: Array<{
    transaction_id: number | string;
    title: string;
    quantity?: number;
    price?: {
      amount: number;
      divisor?: number;
      currency_code?: string;
    };
    listing_id?: number | string;
  }>;
};

export function verifyEtsyWebhookSignature({
  body,
  signatureHeader,
  webhookId,
  webhookTimestamp
}: {
  body: string;
  signatureHeader: string | null;
  webhookId: string | null;
  webhookTimestamp: string | null;
}) {
  if (!signatureHeader || !webhookId || !webhookTimestamp) {
    return false;
  }

  const timestampSeconds = Number(webhookTimestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const { ETSY_WEBHOOK_SIGNING_SECRET } = requireEnv();
  const signedPayload = `${webhookId}.${webhookTimestamp}.${body}`;

  let secretBytes: Buffer;

  try {
    secretBytes = decodeEtsyWebhookSigningSecret(ETSY_WEBHOOK_SIGNING_SECRET);
  } catch {
    return false;
  }

  const digest = createHmac("sha256", secretBytes)
    .update(signedPayload)
    .digest("base64");

  return signatureHeader
    .split(",")
    .map((signature) => signature.trim())
    .some((signature) => safeCompare(digest, signature));
}

export function buildDigitalSaleMessage(uploadUrl: string) {
  const { ETSY_DIGITAL_SALE_MESSAGE_TEMPLATE } = requireEnv();
  return ETSY_DIGITAL_SALE_MESSAGE_TEMPLATE.replace("{{UPLOAD_URL}}", uploadUrl);
}

export function buildDeliveryMessage(deliveryUrl: string) {
  const { ETSY_DELIVERY_MESSAGE_TEMPLATE } = requireEnv();
  return ETSY_DELIVERY_MESSAGE_TEMPLATE.replace("{{DELIVERY_URL}}", deliveryUrl);
}

export function getEtsyScopes() {
  return ["shops_r", "shops_w", "transactions_r", "transactions_w"];
}

export function getEtsyApiKeyHeader() {
  const { ETSY_CLIENT_ID, ETSY_CLIENT_SECRET } = requireEnv();

  if (!ETSY_CLIENT_ID || !ETSY_CLIENT_SECRET) {
    throw new Error("ETSY_CLIENT_ID and ETSY_CLIENT_SECRET are required for Etsy API requests");
  }

  return `${ETSY_CLIENT_ID}:${ETSY_CLIENT_SECRET}`;
}

export async function createEtsyAuthorizeUrl() {
  const { ETSY_CLIENT_ID, ETSY_REDIRECT_URI } = requireEnv();
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
  cookieStore.set(OAUTH_VERIFIER_COOKIE, verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });

  const url = new URL("https://www.etsy.com/oauth/connect");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", ETSY_REDIRECT_URI);
  url.searchParams.set("scope", getEtsyScopes().join(" "));
  url.searchParams.set("client_id", ETSY_CLIENT_ID);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

export async function exchangeEtsyAuthorizationCode({
  code,
  state
}: {
  code: string;
  state: string;
}) {
  const { ETSY_CLIENT_ID, ETSY_REDIRECT_URI, ETSY_SHOP_ID, ETSY_API_BASE_URL } = requireEnv();
  const cookieStore = await cookies();
  const storedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  const verifier = cookieStore.get(OAUTH_VERIFIER_COOKIE)?.value;

  if (!storedState || !verifier || storedState !== state) {
    throw new Error("Invalid Etsy OAuth state");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: ETSY_CLIENT_ID,
    redirect_uri: ETSY_REDIRECT_URI,
    code,
    code_verifier: verifier
  });

  const response = await fetch(`${ETSY_API_BASE_URL}/public/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Failed to exchange Etsy OAuth code: ${response.status}`);
  }

  const token = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    scope?: string;
  };

  await prisma.etsyConnection.upsert({
    where: {
      shopId: ETSY_SHOP_ID
    },
    update: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenType: token.token_type,
      scope: token.scope ?? getEtsyScopes().join(" "),
      accessExpiresAt: new Date(Date.now() + token.expires_in * 1000)
    },
    create: {
      shopId: ETSY_SHOP_ID,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenType: token.token_type,
      scope: token.scope ?? getEtsyScopes().join(" "),
      accessExpiresAt: new Date(Date.now() + token.expires_in * 1000)
    }
  });

  cookieStore.delete(OAUTH_STATE_COOKIE);
  cookieStore.delete(OAUTH_VERIFIER_COOKIE);
}

export async function refreshEtsyAccessTokenIfNeeded() {
  const { ETSY_API_BASE_URL, ETSY_CLIENT_ID, ETSY_SHOP_ID } = requireEnv();
  const connection = await prisma.etsyConnection.findUnique({
    where: {
      shopId: ETSY_SHOP_ID
    }
  });

  if (!connection) {
    throw new Error("Etsy is not connected yet");
  }

  if (connection.accessExpiresAt.getTime() > Date.now() + 60_000) {
    return connection.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: ETSY_CLIENT_ID,
    refresh_token: connection.refreshToken
  });

  const response = await fetch(`${ETSY_API_BASE_URL}/public/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh Etsy access token: ${response.status}`);
  }

  const token = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    scope?: string;
  };

  const updated = await prisma.etsyConnection.update({
    where: {
      shopId: ETSY_SHOP_ID
    },
    data: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenType: token.token_type,
      scope: token.scope ?? connection.scope,
      accessExpiresAt: new Date(Date.now() + token.expires_in * 1000)
    }
  });

  return updated.accessToken;
}

export async function fetchEtsyReceiptByResourceUrl(resourceUrl: string) {
  const { ETSY_API_BASE_URL } = requireEnv();
  const accessToken = await refreshEtsyAccessTokenIfNeeded();
  const apiBaseUrl = new URL(ETSY_API_BASE_URL);
  const requestUrl = new URL(resourceUrl, apiBaseUrl);

  if (requestUrl.origin !== apiBaseUrl.origin) {
    throw new Error("Etsy resource URL must use the configured Etsy API origin");
  }

  if (!requestUrl.pathname.startsWith(apiBaseUrl.pathname)) {
    throw new Error("Etsy resource URL must stay within the configured Etsy API base path");
  }

  const response = await fetch(requestUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-api-key": getEtsyApiKeyHeader()
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Etsy receipt: ${response.status}`);
  }

  return (await response.json()) as EtsyReceiptResponse;
}

export async function syncPilotDigitalSaleMessage(uploadUrlExample: string) {
  const {
    ETSY_API_BASE_URL,
    ETSY_SHOP_ID
  } = requireEnv();
  const accessToken = await refreshEtsyAccessTokenIfNeeded();
  const body = new URLSearchParams({
    digital_sale_message: buildDigitalSaleMessage(uploadUrlExample)
  });

  const response = await fetch(`${ETSY_API_BASE_URL}/application/shops/${ETSY_SHOP_ID}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-api-key": getEtsyApiKeyHeader(),
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Failed to update Etsy digital sale message: ${response.status}`);
  }
}

export async function markEtsyReceiptComplete(receiptId: string) {
  const {
    ETSY_API_BASE_URL,
    ETSY_SHOP_ID
  } = requireEnv();
  const accessToken = await refreshEtsyAccessTokenIfNeeded();
  const body = new URLSearchParams({
    was_shipped: "true",
    was_paid: "true"
  });

  const response = await fetch(
    `${ETSY_API_BASE_URL}/application/shops/${ETSY_SHOP_ID}/receipts/${encodeURIComponent(receiptId)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-api-key": getEtsyApiKeyHeader(),
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to update Etsy receipt completion: ${response.status}`);
  }
}

export function normalizeWebhookEnvelope(
  payload: EtsyWebhookEnvelope
) {
  const eventType = payload.event_name ?? payload.event_type ?? "unknown";
  const resourceUrl = payload.resource_url ?? payload.resource ?? null;
  const shopIdValue = payload.shop_id ?? payload.data?.shop_id;
  const receiptIdValue = payload.receipt_id ?? payload.data?.receipt_id;
  const shopId =
    shopIdValue !== undefined ? String(shopIdValue) : null;
  const receiptId =
    receiptIdValue !== undefined ? String(receiptIdValue) : null;

  return {
    eventType,
    resourceUrl,
    shopId,
    receiptId
  };
}

export function isEtsyOrderPaidEvent(eventType: string) {
  return eventType.toLowerCase().replace("_", ".") === "order.paid";
}

export function normalizeReceiptPayload(receipt: EtsyReceiptResponse) {
  const transactions = receipt.transactions ?? [];
  const firstTransaction = transactions[0];

  return {
    receiptId: String(receipt.receipt_id),
    createdTimestamp: receipt.create_timestamp,
    buyerName: receipt.name ?? "Etsy Buyer",
    buyerEmail: receipt.buyer_email,
    personalization: receipt.message_from_buyer ?? undefined,
    listingId: firstTransaction?.listing_id ? String(firstTransaction.listing_id) : undefined,
    transactions: transactions.map((transaction) => ({
      transactionId: String(transaction.transaction_id),
      title: transaction.title,
      quantity: transaction.quantity ?? 1,
      priceAmount: transaction.price?.amount,
      currencyCode: transaction.price?.currency_code
    }))
  };
}

function decodeEtsyWebhookSigningSecret(secret: string) {
  const encoded = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;

  if (!encoded) {
    throw new Error("Missing Etsy webhook signing secret");
  }

  return Buffer.from(encoded, "base64");
}

function safeCompare(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}
