import Link from "next/link";
import { requireAdminSession } from "@/lib/auth";
import { getEtsyConnectionStatus } from "@/lib/orders";

export default async function EtsySetupPage() {
  await requireAdminSession();
  const status = await getEtsyConnectionStatus();

  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <div className="brand">
            <div className="brand-mark">?</div>
            <div className="brand-copy">
              <div className="brand-title">Pet Sanctuary</div>
              <div className="brand-subtitle">Digital Portraits</div>
            </div>
          </div>
          <div className="avatar-chip" aria-hidden="true">
            ?
          </div>
        </div>
      </header>

      <main className="shell page-shell">
        <section className="hero hero-tight">
          <div className="eyebrow">Etsy pilot</div>
          <h1>Connect the shop and lock the pilot listing.</h1>
          <p>
            This page handles Etsy OAuth, pilot-listing configuration, and the digital sale message sync for the first live rollout.
          </p>
        </section>

        <section className="columns">
          <div className="panel panel-pad stack">
            <div className="cards">
              <article className="card stack">
                <div className="eyebrow">Shop</div>
                <strong>{status.shopId}</strong>
                <span className="muted">{status.connected ? "OAuth connected" : "Not connected yet"}</span>
              </article>
              <article className="card stack">
                <div className="eyebrow">Pilot listing</div>
                <strong>{status.pilotListingId}</strong>
                <span className="muted">Only this listing auto-enters the flow.</span>
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
                  Seed demo order
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
                Use the configured redirect URI and webhook callback URL from your environment.
              </span>
            </div>
            <div className="card stack">
              <strong>2. Connect OAuth</strong>
              <span className="muted">
                Approve shops_r, shops_w, and transactions_r so the app can read receipts and update the digital sale message.
              </span>
            </div>
            <div className="card stack">
              <strong>3. Register the paid-order webhook</strong>
              <span className="muted">Point Etsy to the callback URL shown here for the pilot shop.</span>
            </div>
          </aside>
        </section>
      </main>
    </>
  );
}
