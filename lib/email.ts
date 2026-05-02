import { Resend } from "resend";
import { requireEnv } from "@/lib/env";

type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  attachments?: EmailAttachment[];
};

type SendEmailResult =
  | {
      status: "sent";
      id: string | null;
    }
  | {
      status: "skipped";
      reason: string;
    };

let resendClient: Resend | null = null;

export function normalizeEmailAddress(value?: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized) {
    return null;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

export function getCustomerEmailRecipients(...emails: Array<string | null | undefined>) {
  const recipients = new Map<string, string>();

  for (const email of emails) {
    const normalized = normalizeEmailAddress(email);

    if (normalized && !recipients.has(normalized)) {
      recipients.set(normalized, normalized);
    }
  }

  return Array.from(recipients.values());
}

export function buildUploadRequestEmail({
  buyerName,
  receiptId,
  uploadUrl
}: {
  buyerName: string;
  receiptId: string;
  uploadUrl: string;
}) {
  const subject = `Upload your pet photo for order ${receiptId}`;
  const text = [
    `Hi ${buyerName || "there"},`,
    "",
    "Thanks for your PawPrints order. Please upload your pet photo so we can begin your portrait.",
    "",
    uploadUrl,
    "",
    "We will deliver the finished portrait to the email address you confirm on the upload page."
  ].join("\n");

  return {
    subject,
    text,
    html: toHtmlEmail(subject, [
      `Hi ${escapeHtml(buyerName || "there")},`,
      "Thanks for your PawPrints order. Please upload your pet photo so we can begin your portrait.",
      `<a href="${escapeAttribute(uploadUrl)}">Upload your pet photo</a>`,
      "We will deliver the finished portrait to the email address you confirm on the upload page."
    ])
  };
}

export function buildOpsApprovalEmail({
  buyerName,
  receiptId,
  buyerEmail,
  deliveryEmail,
  adminUrl
}: {
  buyerName: string;
  receiptId: string;
  buyerEmail?: string | null;
  deliveryEmail?: string | null;
  adminUrl: string;
}) {
  const subject = `Approval ready: Etsy receipt ${receiptId}`;
  const emailSummary = [
    buyerEmail ? `Etsy email: ${buyerEmail}` : "Etsy email: not captured",
    deliveryEmail ? `Upload email: ${deliveryEmail}` : "Upload email: not captured"
  ].join("\n");
  const text = [
    `Receipt ${receiptId} is ready for approval.`,
    "",
    `Buyer: ${buyerName || "Etsy Buyer"}`,
    emailSummary,
    "",
    `Review and approve: ${adminUrl}`,
    "",
    "The generated portrait is attached for quick review."
  ].join("\n");

  return {
    subject,
    text,
    html: toHtmlEmail(subject, [
      `Receipt <strong>${escapeHtml(receiptId)}</strong> is ready for approval.`,
      `Buyer: ${escapeHtml(buyerName || "Etsy Buyer")}`,
      escapeHtml(emailSummary).replaceAll("\n", "<br />"),
      `<a href="${escapeAttribute(adminUrl)}">Open admin order</a>`,
      "The generated portrait is attached for quick review."
    ])
  };
}

export function buildPortraitReadyEmail({
  buyerName,
  receiptId,
  downloadUrl,
  expiresAt
}: {
  buyerName: string;
  receiptId: string;
  downloadUrl: string;
  expiresAt: Date;
}) {
  const subject = `Your PawPrints portrait is ready`;
  const expiry = expiresAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  });
  const text = [
    `Hi ${buyerName || "there"},`,
    "",
    `Your portrait for Etsy order ${receiptId} is ready.`,
    "",
    `Download it here: ${downloadUrl}`,
    "",
    `This secure link expires on ${expiry}.`
  ].join("\n");

  return {
    subject,
    text,
    html: toHtmlEmail(subject, [
      `Hi ${escapeHtml(buyerName || "there")},`,
      `Your portrait for Etsy order <strong>${escapeHtml(receiptId)}</strong> is ready.`,
      `<a href="${escapeAttribute(downloadUrl)}">Download your portrait</a>`,
      `This secure link expires on ${escapeHtml(expiry)}.`
    ])
  };
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  idempotencyKey,
  attachments
}: SendEmailInput): Promise<SendEmailResult> {
  const { EMAIL_FROM, EMAIL_REPLY_TO, RESEND_API_KEY } = requireEnv();
  const recipients = Array.isArray(to) ? to : [to];
  const normalizedRecipients = getCustomerEmailRecipients(...recipients);

  if (normalizedRecipients.length === 0) {
    return { status: "skipped", reason: "No valid recipients" };
  }

  if (!RESEND_API_KEY) {
    return { status: "skipped", reason: "RESEND_API_KEY is not configured" };
  }

  if (!resendClient) {
    resendClient = new Resend(RESEND_API_KEY);
  }

  const { data, error } = await resendClient.emails.send(
    {
      from: EMAIL_FROM,
      to: normalizedRecipients,
      subject,
      html,
      text,
      replyTo: EMAIL_REPLY_TO,
      attachments: attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType
      }))
    },
    {
      idempotencyKey
    }
  );

  if (error) {
    throw new Error(`Resend email failed: ${error.message}`);
  }

  return {
    status: "sent",
    id: data?.id ?? null
  };
}

function toHtmlEmail(title: string, paragraphs: string[]) {
  return [
    '<div style="font-family: Arial, sans-serif; color: #2b1f17; line-height: 1.55; max-width: 620px;">',
    `<h1 style="font-size: 24px; margin: 0 0 16px;">${escapeHtml(title)}</h1>`,
    ...paragraphs.map(
      (paragraph) => `<p style="font-size: 16px; margin: 0 0 14px;">${paragraph}</p>`
    ),
    "</div>"
  ].join("");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
