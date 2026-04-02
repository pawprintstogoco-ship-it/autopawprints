import Link from "next/link";
import { OrderStatus } from "@prisma/client";
import { requireAdminSession } from "@/lib/auth";
import { getDashboardOrders } from "@/lib/orders";

const statusOptions = Object.values(OrderStatus);

export default async function OrdersPage({
  searchParams
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  await requireAdminSession();
  const params = (await searchParams) ?? {};
  const selectedStatus = statusOptions.find((option) => option === params.status);
  const orders = await getDashboardOrders(selectedStatus);
  const featuredOrder = orders[0] ?? null;

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

      <main className="shell page-shell" style={{ maxWidth: 860 }}>
        <section className="hero hero-tight">
          <div className="eyebrow">Review queue</div>
          <h1>Pending approval.</h1>
          <p>
            Paid portrait orders flow through upload, render, approval, and delivery in a cleaner Stitch-style review dashboard.
          </p>
        </section>

        <section className="stack">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Queue</div>
              <h2 style={{ fontSize: "2rem", fontWeight: 800 }}>
                {selectedStatus ? `${selectedStatus.replaceAll("_", " ")} orders` : "All orders"}
              </h2>
            </div>
            <div className="badge badge-tertiary">{orders.length} items</div>
          </div>

          <div className="actions" style={{ overflowX: "auto", flexWrap: "nowrap", paddingBottom: 4 }}>
            <Link href="/orders" className={selectedStatus ? "buttonSecondary" : "button"}>
              All uploads
            </Link>
            {statusOptions.map((status) => (
              <Link
                href={`/orders?status=${status}`}
                className={selectedStatus === status ? "button" : "buttonSecondary"}
                key={status}
              >
                {status.replaceAll("_", " ")}
              </Link>
            ))}
          </div>
        </section>

        <section className="grid" style={{ marginTop: 18 }}>
          {featuredOrder ? (
            <article className="panel panel-pad stack">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Active review</div>
                  <h3 style={{ fontSize: "1.5rem", fontWeight: 800 }}>{featuredOrder.buyerName}</h3>
                  <p className="muted">Receipt {featuredOrder.receiptId}</p>
                </div>
                <div className="badge">{featuredOrder.status.replaceAll("_", " ")}</div>
              </div>

              <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <div className="card card-muted stack">
                  <div className="eyebrow" style={{ marginBottom: 0 }}>Original</div>
                  <div className="preview-frame" style={{ minHeight: 220 }} />
                </div>
                <div className="card stack" style={{ background: "linear-gradient(135deg, var(--primary) 0%, #9d79ff 100%)", color: "#fff" }}>
                  <div className="eyebrow" style={{ marginBottom: 0, color: "rgba(255,255,255,0.8)" }}>AI portrait</div>
                  <div className="preview-frame" style={{ minHeight: 220, background: "rgba(255,255,255,0.16)" }} />
                </div>
              </div>

              <div className="chip-row">
                <span className="badge badge-tertiary">Regal Style</span>
                <span className="badge badge-secondary">Pilot listing</span>
                <span className="badge badge-outline">{featuredOrder.latestUploadName ?? "Waiting for upload"}</span>
              </div>

              <div className="actions">
                <Link href={`/orders/${featuredOrder.id}`} className="button">
                  Open review
                </Link>
                <Link href="/etsy" className="buttonSecondary">
                  Etsy setup
                </Link>
              </div>
            </article>
          ) : null}

          <article className="panel panel-pad stack">
            <div className="eyebrow">Up next in review</div>
            {orders.map((order) => (
              <Link href={`/orders/${order.id}`} key={order.id} className="card" style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 16,
                    background: "linear-gradient(135deg, var(--surface-highest) 0%, #fff 100%)",
                    flexShrink: 0
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: "1rem" }}>{order.buyerName}</strong>
                  <div className="muted">{order.latestUploadName ?? "Waiting for upload"}</div>
                </div>
                <div className="stack" style={{ justifyItems: "end" }}>
                  <span className="badge">{order.status.replaceAll("_", " ")}</span>
                  <span className="muted mono">{order.receiptId}</span>
                </div>
              </Link>
            ))}
          </article>
        </section>
      </main>

      <nav className="bottom-nav mobile-only" aria-label="Primary">
        <span className="nav-item">Upload</span>
        <span className="nav-item">Gallery</span>
        <span className="nav-item nav-item-active">Dashboard</span>
        <span className="nav-item">Settings</span>
      </nav>
    </>
  );
}
