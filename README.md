# PawPrints Automation

PawPrints Automation is a Next.js starter app for running custom Etsy portrait orders through a structured internal workflow: order intake, secure photo upload, deterministic rendering, manual approval, reminders, and digital delivery.

## What is implemented

- Etsy PKCE OAuth setup flow at `/etsy` and `/api/etsy/oauth/*`
- Etsy `ORDER_PAID` webhook endpoint at `/api/etsy/webhooks/order-paid`
- Admin login and protected order dashboard
- Tokenized customer upload flow at `/upload/[token]`
- Deterministic portrait renderer using `sharp` and `pdf-lib`
- Approval, rerender, and manual-attention admin actions
- Delivery links and portal-first fulfillment
- Background worker hooks for rendering, reminders, and delivery
- Pilot-listing gating so only one Etsy listing auto-enters the flow
- Prisma schema for Postgres-backed persistence and Etsy connection state

## Environment

Copy `.env.example` to `.env` and update the credentials:

```bash
DATABASE_URL=...
REDIS_URL=...
APP_URL=http://localhost:3010
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
SESSION_SECRET=...
STORAGE_ROOT=./storage
SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASSWORD=...
MAIL_FROM=...
DELIVERY_LINK_TTL_HOURS=168
ETSY_CLIENT_ID=...
ETSY_CLIENT_SECRET=
ETSY_REDIRECT_URI=https://your-domain.com/api/etsy/oauth/callback
ETSY_SHOP_ID=12345678
ETSY_PILOT_LISTING_ID=1234567890
ETSY_WEBHOOK_CALLBACK_URL=https://your-domain.com/api/etsy/webhooks/order-paid
ETSY_WEBHOOK_SIGNING_SECRET=...
ETSY_API_BASE_URL=https://api.etsy.com/v3
ETSY_DIGITAL_SALE_MESSAGE_TEMPLATE="Thanks for your order! Upload your pet photo here: {{UPLOAD_URL}}"
```

## Local development

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

Start the worker in a second terminal:

```bash
npm run worker
```

The app defaults to port `3010` in the provided npm scripts.

To seed a local pilot order without Etsy:

```bash
npm run seed:demo
```

## Notes

- Storage defaults to the local filesystem under `STORAGE_ROOT`.
- Delivery is portal-first in v1. Buyers upload through the portal and return to a secure download link after approval.
- Etsy conversation follow-up remains manual in v1; reminder jobs create internal dashboard alerts instead of sending thread replies.
- Etsy OAuth uses the documented PKCE flow and stores the seller token pair in the database.
- The webhook route expects Etsy-style `webhook-id`, `webhook-timestamp`, and `webhook-signature` headers and fetches the receipt resource from Etsy before creating the order.
- The pilot is intentionally limited to `ETSY_PILOT_LISTING_ID`; non-pilot receipts are captured and flagged for manual handling.
