import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">PawPrintsCA</div>
        <h1>Custom portrait orders, tracked from Etsy to delivery.</h1>
        <p>
          This dashboard is the operational home for paid Etsy orders, customer
          photo uploads, render approval, reminders, and digital delivery.
        </p>
      </section>

      <section className="panel panel-pad grid">
        <div className="cards">
          <article className="card stack">
            <div className="eyebrow">Admin</div>
            <h2 style={{ fontSize: "1.6rem" }}>Order dashboard</h2>
            <p className="muted">
              Review paid orders, chase missing photos, approve portrait renders,
              and send delivery links.
            </p>
            <Link href="/orders" className="button">
              Open orders
            </Link>
            <Link href="/etsy" className="buttonSecondary">
              Etsy setup
            </Link>
          </article>

          <article className="card stack">
            <div className="eyebrow">Buyer</div>
            <h2 style={{ fontSize: "1.6rem" }}>Upload flow</h2>
            <p className="muted">
              Buyers receive a secure upload link after purchase and submit the
              pet photo and name through your own branded page.
            </p>
            <span className="badge">Tokenized upload links</span>
          </article>

          <article className="card stack">
            <div className="eyebrow">Ops</div>
            <h2 style={{ fontSize: "1.6rem" }}>Worker-ready</h2>
            <p className="muted">
              Background jobs handle rendering, reminders, and delivery while
              preserving audit history on every order.
            </p>
            <span className="badge">BullMQ queue hooks included</span>
          </article>
        </div>
      </section>
    </main>
  );
}
