import nodemailer from "nodemailer";
import { requireEnv } from "@/lib/env";

export async function sendDeliveryEmail({
  to,
  subject,
  html
}: {
  to: string;
  subject: string;
  html: string;
}) {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASSWORD,
    MAIL_FROM
  } = requireEnv();

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASSWORD
    }
  });

  return transporter.sendMail({
    from: MAIL_FROM,
    to,
    subject,
    html
  });
}
