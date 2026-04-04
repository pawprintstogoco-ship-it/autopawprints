# PawPrints Automation

PawPrints Automation is a Next.js app for running custom Etsy portrait orders through a structured internal workflow: order intake, secure photo upload, AI-assisted portrait rendering, manual approval, reminders, and digital delivery.

## What is implemented

- Etsy PKCE OAuth setup flow at `/etsy` and `/api/etsy/oauth/*`
- Etsy `ORDER_PAID` webhook endpoint at `/api/etsy/webhooks/order-paid`
- Admin login and protected order dashboard
- Tokenized customer upload flow at `/upload/[token]`
- AI-assisted portrait renderer using OpenAI image edits plus `sharp` and `pdf-lib`
- Approval, rerender, and manual-attention admin actions
- Token-page delivery on the same customer upload link after approval
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
DELIVERY_LINK_TTL_HOURS=168
OPENAI_API_KEY=...
OPENAI_IMAGE_MODEL=gpt-image-1
INLINE_RENDER_JOBS=false
ETSY_CLIENT_ID=...
ETSY_CLIENT_SECRET=
ETSY_REDIRECT_URI=https://your-domain.com/api/etsy/oauth/callback
ETSY_SHOP_ID=12345678
ETSY_PILOT_LISTING_ID=1234567890
ETSY_WEBHOOK_CALLBACK_URL=https://your-domain.com/api/etsy/webhooks/order-paid
ETSY_WEBHOOK_SIGNING_SECRET=...
ETSY_API_BASE_URL=https://api.etsy.com/v3
ETSY_DIGITAL_SALE_MESSAGE_TEMPLATE="Thanks for your order! Upload your pet photo here: {{UPLOAD_URL}}"
ETSY_DELIVERY_MESSAGE_TEMPLATE="Your portrait is ready. Open it here: {{DELIVERY_URL}}"
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

- Storage is persisted in the database for the hosted demo flow, avoiding Vercel filesystem write errors.
- Delivery stays on the same tokenized customer page in v1. Buyers upload, wait in review state, then save the final portrait from that same link after approval.
- If `OPENAI_API_KEY` is set, uploaded pet photos are transformed into a stylized portrait with OpenAI before the app adds the buyer-facing layout and export formats. Without that key, the app falls back to the simpler local stylizer.
- `INLINE_RENDER_JOBS=false` keeps uploads fast by queueing render work instead of running it inside the upload request. Only enable inline mode for local debugging or tightly controlled demos.
- Approval marks the order delivered and logs a manual Etsy messaging reminder with a prebuilt delivery message.
- Etsy OAuth uses the documented PKCE flow and stores the seller token pair in the database.
- The webhook route expects Etsy-style `webhook-id`, `webhook-timestamp`, and `webhook-signature` headers and fetches the receipt resource from Etsy before creating the order.
- The pilot is intentionally limited to `ETSY_PILOT_LISTING_ID`; non-pilot receipts are captured and flagged for manual handling.
- Queue-backed render and delivery jobs are the recommended production path. If you deploy on Vercel, make sure the worker process is running against the same Redis and database.
