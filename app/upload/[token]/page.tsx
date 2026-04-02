import { notFound } from "next/navigation";
import { getOrderByUploadToken } from "@/lib/orders";
import { getPublicFileUrl } from "@/lib/storage";
import { UploadForm } from "@/app/upload/[token]/upload-form";

export default async function UploadPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await getOrderByUploadToken(token);

  if (!order) {
    notFound();
  }

  const latestUpload = order.uploads[0] ?? null;
  const preview = order.artifacts.find((artifact) => artifact.kind === "PREVIEW") ?? null;
  const finalPng = order.artifacts.find((artifact) => artifact.kind === "FINAL_PNG") ?? null;
  const isReadyForDownload = Boolean(order.downloadToken && order.status === "DELIVERED");

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

      <main className="shell page-shell" style={{ maxWidth: 760 }}>
        <section className="hero hero-tight">
          <div className="eyebrow">Upload your photo</div>
          <h1>Let&apos;s make {order.buyerName}&apos;s portrait.</h1>
          <p>
            Upload your best pet photo and tell us the name exactly as you want it shown on the artwork.
          </p>
        </section>

        {!latestUpload ? (
          <section className="grid">
            <article className="panel panel-pad panel-soft">
              <div className="stack" style={{ textAlign: "center" }}>
                <div
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: 999,
                    background: "rgba(109, 35, 249, 0.12)",
                    color: "var(--primary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto",
                    fontSize: 34
                  }}
                >
                  ?
                </div>
                <div>
                  <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: 8 }}>
                    Upload Pet Photo
                  </h2>
                  <p className="muted">
                    Drag and drop your JPEG or PNG file here, or tap to browse your gallery.
                  </p>
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
          </section>
        ) : (
          <section className="grid">
            <article className="panel panel-pad" style={{ textAlign: "center" }}>
              <div className="circle-stage">
                <div className="progress-ring" />
                <div className="circle-stage-inner">
                  {preview ? (
                    <img alt={`Preview for ${latestUpload.petName}`} src={getPublicFileUrl(preview.storageKey)} />
                  ) : (
                    <img alt={`Upload for ${latestUpload.petName}`} src={getPublicFileUrl(latestUpload.storageKey)} />
                  )}
                  <div className="scan-line" />
                </div>
                <div className="badge badge-tertiary floating-chip">AI analyzing</div>
              </div>

              <div className="stack">
                <h2 style={{ fontSize: "2rem", fontWeight: 800 }}>
                  {preview ? `${latestUpload.petName}'s portrait is ready to review` : "Crafting magic..."}
                </h2>
                <p className="muted">
                  {preview
                    ? "Your portrait preview is ready below."
                    : `We received ${latestUpload.petName}'s photo and we're preparing the portrait.`}
                </p>
              </div>

              <div className="stack" style={{ marginTop: 20, textAlign: "left" }}>
                <div className="card">Isolating subject</div>
                <div className="card card-muted">
                  <strong style={{ color: "var(--primary)" }}>Vectorizing textures</strong>
                  <div className="muted">72%</div>
                </div>
                <div className="card" style={{ opacity: 0.5 }}>
                  Applying editorial finish
                </div>
              </div>
            </article>

            {preview ? (
              <article className="panel panel-pad">
                <div className="stack">
                  <div className="eyebrow">Final portrait</div>
                  <div className="preview-frame">
                    <img alt={`Preview for ${latestUpload.petName}`} src={getPublicFileUrl(preview.storageKey)} />
                    <div className="preview-overlay">
                      <div className="chip-row">
                        <span className="badge">Detected personality</span>
                      </div>
                      <strong>Spirited &amp; playful</strong>
                    </div>
                  </div>

                  {isReadyForDownload ? (
                    <a className="button" href={`/download/${order.downloadToken}`}>
                      Open your finished portrait
                    </a>
                  ) : finalPng ? (
                    <div className="card card-muted">
                      Your portrait is rendered and waiting for final review. Check back here soon.
                    </div>
                  ) : (
                    <div className="actions">
                      <button className="button" type="button">
                        Keep this portrait
                      </button>
                      <button className="buttonSecondary" type="button">
                        Re-roll
                      </button>
                      <button className="buttonGhost" type="button">
                        Change photo
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ) : null}
          </section>
        )}

        <section className="panel panel-pad" style={{ marginTop: 18 }}>
          <UploadForm token={token} />
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
