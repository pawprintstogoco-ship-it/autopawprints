import crypto from "node:crypto";
import { MessageChannel } from "@prisma/client";
import { requireEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const DEFAULT_OPENCLAW_JOB_TIMEOUT_SECONDS = 900;

type InitialEtsyMessageJobOrder = {
  id: string;
  receiptId: string;
  buyerName: string;
  pilotListingEligible?: boolean;
};

type OpenClawHookResponse = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

export async function enqueueInitialEtsyUploadMessageJob(
  order: InitialEtsyMessageJobOrder
) {
  if (!order.pilotListingEligible) {
    return { enqueued: false, reason: "order_not_pilot_eligible" };
  }

  if (await hasInitialUploadMessageTerminalEvent(order.id)) {
    return { enqueued: false, reason: "initial_message_already_terminal" };
  }

  const env = requireEnv();
  const hookUrl = normalizeOptionalString(env.OPENCLAW_HOOK_URL);
  const hookToken = normalizeOptionalString(env.OPENCLAW_HOOK_TOKEN);
  const callbackSecret = normalizeOptionalString(env.OPENCLAW_CALLBACK_SECRET);

  if (!hookUrl || !hookToken || !callbackSecret) {
    await recordOpenClawJobEvent({
      orderId: order.id,
      eventType: "openclaw.initial_upload_message.not_configured",
      body:
        "OpenClaw hook URL/token/callback secret is not configured; initial Etsy upload-message job was not enqueued."
    });
    return { enqueued: false, reason: "openclaw_hook_not_configured" };
  }

  const callbackToken = createOpenClawCallbackToken(order.id, order.receiptId);
  const callbackUrl = `${env.APP_URL}/api/openclaw/etsy-message-result`;
  const timeoutSeconds = Number(env.OPENCLAW_JOB_TIMEOUT_SECONDS) || DEFAULT_OPENCLAW_JOB_TIMEOUT_SECONDS;

  const payload = {
    name: `SEND_INITIAL_ETSY_MESSAGE ${order.receiptId}`,
    agentId: normalizeOptionalString(env.OPENCLAW_AGENT_ID) ?? "main",
    sessionKey: `hook:etsy-initial-message:${order.receiptId}`,
    wakeMode: "now",
    deliver: false,
    timeoutSeconds,
    message: buildInitialEtsyUploadMessagePrompt({
      order,
      appUrl: env.APP_URL,
      callbackUrl,
      callbackToken
    })
  };

  try {
    const response = await fetch(hookUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hookToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    });

    let result: OpenClawHookResponse = {};
    try {
      result = (await response.json()) as OpenClawHookResponse;
    } catch {
      result = {};
    }

    if (!response.ok || result.ok === false) {
      const reason = result.error ?? `OpenClaw hook returned HTTP ${response.status}`;
      await recordOpenClawJobEvent({
        orderId: order.id,
        eventType: "openclaw.initial_upload_message.enqueue_failed",
        body: reason
      });
      return { enqueued: false, reason };
    }

    await recordOpenClawJobEvent({
      orderId: order.id,
      eventType: "openclaw.initial_upload_message.enqueued",
      body: `OpenClaw initial Etsy upload-message job enqueued for receipt ${order.receiptId}.`
    });
    return { enqueued: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown OpenClaw hook error";
    await recordOpenClawJobEvent({
      orderId: order.id,
      eventType: "openclaw.initial_upload_message.enqueue_failed",
      body: reason
    });
    return { enqueued: false, reason };
  }
}

export async function recordInitialEtsyUploadMessageResult({
  orderId,
  receiptId,
  status,
  reason
}: {
  orderId: string;
  receiptId: string;
  status: "sent" | "failed" | "skipped";
  reason?: string;
}) {
  const eventType = `openclaw.initial_upload_message.${status}`;
  const body = reason
    ? `OpenClaw ${status} initial Etsy upload message for receipt ${receiptId}: ${reason}`
    : `OpenClaw ${status} initial Etsy upload message for receipt ${receiptId}.`;

  await prisma.$transaction([
    prisma.messageEvent.create({
      data: {
        orderId,
        channel: status === "sent" ? MessageChannel.ETSY : MessageChannel.INTERNAL,
        eventType,
        body
      }
    }),
    prisma.auditLog.create({
      data: {
        orderId,
        action: eventType,
        metadata: {
          receiptId,
          status,
          reason: reason ?? null
        }
      }
    })
  ]);
}

export function verifyOpenClawCallbackToken({
  orderId,
  receiptId,
  token
}: {
  orderId: string;
  receiptId: string;
  token: string;
}) {
  const expected = createOpenClawCallbackToken(orderId, receiptId);
  const provided = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);

  return (
    provided.length === expectedBuffer.length &&
    crypto.timingSafeEqual(provided, expectedBuffer)
  );
}

function buildInitialEtsyUploadMessagePrompt({
  order,
  appUrl,
  callbackUrl,
  callbackToken
}: {
  order: InitialEtsyMessageJobOrder;
  appUrl: string;
  callbackUrl: string;
  callbackToken: string;
}) {
  return [
    "Run SOP: Etsy New Order Upload Message for PawprintsCA.",
    `Receipt ID: ${order.receiptId}`,
    `Pawprints order ID: ${order.id}`,
    `Pawprints order URL: ${appUrl}/orders/${order.id}`,
    "Standing authority: send only the exact standard PawprintsCA upload message for this matching receipt when every SOP safety check passes.",
    "Use PawprintsCA Google OAuth account pawprintstogoco@gmail.com if prompted. Do not use z.alex230@gmail.com.",
    "Required checks: match Etsy receipt/order ID to the PawprintsCA receipt ID, confirm upload URL belongs to this order, confirm no duplicate initial upload message was already sent, and stop on refunds/cancellations/cases/non-standard order uncertainty.",
    "After completing or safely skipping/failing, POST JSON to the callback URL with orderId, receiptId, status ('sent', 'failed', or 'skipped'), reason, and token.",
    `Callback URL: ${callbackUrl}`,
    `Callback token: ${callbackToken}`,
    "Do not include customer addresses, credentials, cookies, or unnecessary customer details in logs."
  ].join("\n");
}

function createOpenClawCallbackToken(orderId: string, receiptId: string) {
  const secret = normalizeOptionalString(requireEnv().OPENCLAW_CALLBACK_SECRET);

  if (!secret) {
    throw new Error("OPENCLAW_CALLBACK_SECRET is not configured");
  }

  return crypto
    .createHmac("sha256", secret)
    .update(`${orderId}:${receiptId}`)
    .digest("hex");
}

async function hasInitialUploadMessageTerminalEvent(orderId: string) {
  const existing = await prisma.messageEvent.findFirst({
    where: {
      orderId,
      eventType: {
        in: [
          "openclaw.initial_upload_message.enqueued",
          "openclaw.initial_upload_message.sent"
        ]
      }
    },
    select: {
      id: true
    }
  });

  return Boolean(existing);
}

async function recordOpenClawJobEvent({
  orderId,
  eventType,
  body
}: {
  orderId: string;
  eventType: string;
  body: string;
}) {
  await prisma.$transaction([
    prisma.messageEvent.create({
      data: {
        orderId,
        channel: MessageChannel.INTERNAL,
        eventType,
        body
      }
    }),
    prisma.auditLog.create({
      data: {
        orderId,
        action: eventType,
        metadata: {
          body
        }
      }
    })
  ]);
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
