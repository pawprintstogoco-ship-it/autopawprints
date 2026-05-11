import Link from "next/link";
import { requireAdminSession } from "@/lib/auth";
import { getEtsyConnectionStatus } from "@/lib/orders";
import { getEtsyPilotListingIds, requireEnv } from "@/lib/env";
import { OpsTopNav } from "@/app/orders/ops-top-nav";

export default async function EtsySetupPage() {
  await requireAdminSession();
  const status = await getEtsyConnectionStatus();
  const listingIds = getEtsyPilotListingIds(requireEnv());
  const allowsAllListings = listingIds.some(
    (listingId) => listingId === "*" || listingId.toLowerCase() === "all"
  );
  const listingLabel = allowsAllListings ? "All shop listings" : listingIds.join(", ");
  const listingHelp = allowsAllListings
    ? "Every listing in this Etsy shop auto-enters the flow."
    : "Only these listings auto-enter the flow.";

  return (
    <main className="shell">
      <OpsTopNav active="etsy" />

      <section className="hero">
        <div className="eyebrow">Etsy setup</div>
        <h1>Connect the shop and manage listing eligibility.</h1>
        <p>
          This page handles Etsy OAuth, listing eligibility, and the digital sale
          message sync for the live order flow.
        </p>
      </section>

      <section className="columns">
        <div className="panel panel-pad stack">
          <div className="cards">
            <article className="card stack">
              <div className="eyebrow">Shop</div>
              <strong>{status.shopId}</strong>
              <span className="muted">
                {status.connected ? "OAuth connected" : "Not connected yet"}
              </span>
            </article>
            <article className="card stack">
              <div className="eyebrow">Eligible listings</div>
              <strong>{listingLabel}</strong>
              <span className="muted">{listingHelp}</span>
            </article>
            <article className="card stack">
              <div className="eyebrow">Webhook callback</div>
              <span className="mono">{status.webhookCallbackUrl}</span>
            </article>
          </div>

          <div className="actions">
            <a href="/api/etsy/oauth/start" className="button">
              {status.connected ? "Reconnect Etsy" : "Connect Etsy"}
            </a>
            <form action="/api/etsy/sync-sale-message" method="post">
              <button className="buttonSecondary" type="submit">
                Sync digital sale message
              </button>
            </form>
            <form action="/api/dev/seed-demo" method="post">
              <button className="buttonSecondary" type="submit">
                Seed 6 demo orders
              </button>
            </form>
            <Link href="/orders" className="buttonSecondary">
              Back to orders
            </Link>
          </div>
        </div>

        <aside className="panel panel-pad stack">
          <div className="eyebrow">Runbook</div>
          <div className="card stack">
            <strong>1. Create the Etsy developer app</strong>
            <span className="muted">
              Use the configured redirect URI and webhook callback URL from your
              environment.
            </span>
          </div>
          <div className="card stack">
            <strong>2. Connect OAuth</strong>
            <span className="muted">
              Approve `shops_r`, `shops_w`, `transactions_r`, and `transactions_w`
              so the app can read receipts, update the digital sale message, and
              mark completed receipts.
            </span>
          </div>
          <div className="card stack">
            <strong>3. Register the paid-order webhook</strong>
            <span className="muted">
              Point Etsy's `order.paid` event to the callback URL shown here for
              the connected shop.
            </span>
          </div>
        </aside>
      </section>
    </main>
  );
}
