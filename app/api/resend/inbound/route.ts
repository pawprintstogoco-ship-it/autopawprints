import { NextResponse } from "next/server";
import { Resend } from "resend";
import { requireEnv } from "@/lib/env";

type ResendEmailReceivedEvent = {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
  };
};

export async function POST(request: Request) {
  const {
    EMAIL_FORWARD_TO,
    EMAIL_FROM,
    RESEND_API_KEY,
    RESEND_WEBHOOK_SECRET
  } = requireEnv();

  if (!RESEND_API_KEY || !RESEND_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Resend inbound forwarding is not configured" },
      { status: 503 }
    );
  }

  const payload = await request.text();
  const resend = new Resend(RESEND_API_KEY);

  let event: ResendEmailReceivedEvent;

  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: requireHeader(request, "svix-id"),
        timestamp: requireHeader(request, "svix-timestamp"),
        signature: requireHeader(request, "svix-signature")
      },
      webhookSecret: RESEND_WEBHOOK_SECRET
    }) as ResendEmailReceivedEvent;
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  if (event.type !== "email.received") {
    return NextResponse.json({ ok: true, ignored: event.type ?? "unknown" });
  }

  const emailId = event.data?.email_id;

  if (!emailId) {
    return NextResponse.json({ error: "Missing email id" }, { status: 400 });
  }

  const { data, error } = await resend.emails.receiving.forward({
    emailId,
    from: EMAIL_FROM,
    to: EMAIL_FORWARD_TO,
    passthrough: true
  });

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    forwardedId: data?.id ?? null
  });
}

function requireHeader(request: Request, name: string) {
  const value = request.headers.get(name);

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}
