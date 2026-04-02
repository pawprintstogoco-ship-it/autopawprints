import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <div className="brand">
            <div className="brand-mark">✦</div>
            <div className="brand-copy">
              <div className="brand-title">Pet Sanctuary</div>
              <div className="brand-subtitle">Digital Portraits</div>
            </div>
          </div>
          <div className="avatar-chip" aria-hidden="true">
            ◌
          </div>
        </div>
      </header>

      <main className="shell page-shell">
        <section className="hero hero-tight">
          <div className="eyebrow">Magic portraits</div>
          <h1>
            Turn pet photos into vibrant AI artwork with a calmer, brighter flow.
          </h1>
          <p>
            Your buyer upload pages, portrait processing, gallery delivery, and internal
            review queue all share one premium Stitch-inspired visual system now.
          </p>
        </section>

        <section className="grid" style={{ maxWidth: 720 }}>
          <article className="panel panel-pad panel-soft">
            <div className="stack" style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 999,
                  background: "rgba(109, 35, 249, 0.12)",
                  color: "var(--primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto"
                }}
              >
                ↑
              </div>
              <div>
                <h2 style={{ fontSize: "1.55rem", fontWeight: 800, marginBottom: 8 }}>
                  Upload Pet Photo
                </h2>
                <p className="muted">
                  Drag and drop your JPEG or PNG file here, or tap to browse your gallery.
                </p>
              </div>
              <div className="actions" style={{ justifyContent: "center" }}>
                <Link href="/orders" className="button">
                  Open dashboard
                </Link>
                <Link href="/etsy" className="buttonSecondary">
                  Etsy setup
                </Link>
              </div>
            </div>
          </article>

          <article className="panel panel-pad">
            <div className="stack">
              <div className="eyebrow">Preview sanctuary</div>
              <div className="preview-frame">
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    opacity: 0.2,
                    background:
                      "linear-gradient(180deg, rgba(109,35,249,0.16) 0%, rgba(0,227,253,0.1) 100%)"
                  }}
                />
                <div className="preview-overlay" style={{ textAlign: "center" }}>
                  <div className="badge" style={{ marginBottom: 10 }}>
                    Portrait will appear here
                  </div>
                  <p className="muted">Our AI is waiting for your pet&apos;s best angle.</p>
                </div>
              </div>
            </div>
          </article>

          <div className="cards" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <article className="card card-muted">
              <div className="stack">
                <span className="badge badge-secondary">Instant Processing</span>
                <p className="muted">Fast upload, queue tracking, and render visibility.</p>
              </div>
            </article>
            <article className="card card-muted">
              <div className="stack">
                <span className="badge badge-tertiary">Vector Export</span>
                <p className="muted">Final files are ready for digital delivery and archiving.</p>
              </div>
            </article>
          </div>

          <article className="panel panel-pad">
            <div className="stack">
              <h3 style={{ fontSize: "1.2rem", fontWeight: 800 }}>How it works</h3>
              {[
                "Snap a photo of your furry friend in good lighting.",
                "Our AI analyzes the details, texture, and expression.",
                "Download your custom high-resolution portrait."
              ].map((step, index) => (
                <div key={step} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      background: "var(--primary)",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      fontSize: 13,
                      fontWeight: 700
                    }}
                  >
                    {index + 1}
                  </div>
                  <p className="muted" style={{ paddingTop: 6 }}>
                    {step}
                  </p>
                </div>
              ))}
            </div>
          </article>
        </section>
      </main>

      <nav className="bottom-nav mobile-only" aria-label="Primary">
        <span className="nav-item nav-item-active">Upload</span>
        <span className="nav-item">Gallery</span>
        <span className="nav-item">Dashboard</span>
        <span className="nav-item">Settings</span>
      </nav>
    </>
  );
}
