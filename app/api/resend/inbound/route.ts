import { NextResponse } from "next/server";
import { Resend, type Attachment } from "resend";
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

  const { data: inbound, error: inboundError } =
    await resend.emails.receiving.get(emailId);

  if (inboundError) {
    return NextResponse.json(
      { error: inboundError.message },
      { status: 502 }
    );
  }

  if (!inbound) {
    return NextResponse.json({ error: "Inbound email not found" }, { status: 404 });
  }

  const originalFrom = inbound.from || event.data?.from || "Unknown sender";
  const originalTo = inbound.to?.length ? inbound.to.join(", ") : "hello@pawprints.ca";
  const subject = inbound.subject || event.data?.subject || "(no subject)";
  const senderName = getSenderDisplayName(originalFrom);
  const senderAddress = extractEmailAddress(EMAIL_FROM);
  const replyTo = inbound.reply_to?.length ? inbound.reply_to : originalFrom;
  const attachments = await loadInboundAttachments(resend, emailId, inbound.attachments);

  const { data, error } = await resend.emails.send({
    from: `${quoteDisplayName(`${senderName} via PawPrints`)} <${senderAddress}>`,
    to: EMAIL_FORWARD_TO,
    replyTo,
    subject,
    html: wrapHtml({
      from: originalFrom,
      to: originalTo,
      subject,
      body: inbound.html ?? textToHtml(inbound.text ?? "")
    }),
    text: wrapText({
      from: originalFrom,
      to: originalTo,
      subject,
      body: inbound.text ?? stripHtml(inbound.html ?? "")
    }),
    attachments,
    headers: {
      "X-Autopawprints-Forwarded-From": originalFrom,
      "X-Autopawprints-Inbound-Email-Id": emailId
    }
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

function extractEmailAddress(value: string) {
  return value.match(/<([^>]+)>/)?.[1]?.trim() || value.trim();
}

function getSenderDisplayName(from: string) {
  const displayName = from.match(/^"?([^"<]+?)"?\s*</)?.[1]?.trim();
  const emailAddress = from.match(/<([^>]+)>/)?.[1]?.trim() || from.trim();

  return displayName || emailAddress;
}

function quoteDisplayName(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function wrapHtml({
  from,
  to,
  subject,
  body
}: {
  from: string;
  to: string;
  subject: string;
  body: string;
}) {
  return `
    <div style="font-family:Arial,sans-serif;color:#2f1f19;line-height:1.5">
      <div style="border:1px solid #eadfce;border-radius:8px;padding:16px;margin-bottom:20px;background:#fffaf2">
        <p style="margin:0 0 10px;font-weight:700">Forwarded inbound email to PawPrints</p>
        <p style="margin:0"><strong>From:</strong> ${escapeHtml(from)}</p>
        <p style="margin:0"><strong>To:</strong> ${escapeHtml(to)}</p>
        <p style="margin:0"><strong>Subject:</strong> ${escapeHtml(subject)}</p>
      </div>
      ${body}
    </div>
  `;
}

function wrapText({
  from,
  to,
  subject,
  body
}: {
  from: string;
  to: string;
  subject: string;
  body: string;
}) {
  return [
    "Forwarded inbound email to PawPrints",
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "",
    body
  ].join("\n");
}

function textToHtml(value: string) {
  return `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(value)}</pre>`;
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

async function loadInboundAttachments(
  resend: Resend,
  emailId: string,
  inboundAttachments: { id: string; filename: string | null; size: number; content_type: string | null }[]
) {
  const maxBytes = 15 * 1024 * 1024;
  let totalBytes = 0;
  const attachments: Attachment[] = [];

  for (const inboundAttachment of inboundAttachments) {
    totalBytes += inboundAttachment.size;

    if (totalBytes > maxBytes) {
      break;
    }

    const { data, error } = await resend.emails.receiving.attachments.get({
      emailId,
      id: inboundAttachment.id
    });

    if (error || !data?.download_url) {
      continue;
    }

    const response = await fetch(data.download_url);

    if (!response.ok) {
      continue;
    }

    const content = Buffer.from(await response.arrayBuffer());

    attachments.push({
      content,
      filename: inboundAttachment.filename ?? data.filename ?? "attachment",
      contentType: inboundAttachment.content_type ?? data.content_type
    });
  }

  return attachments;
}
