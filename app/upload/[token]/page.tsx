import { notFound } from "next/navigation";
import { Newsreader, Plus_Jakarta_Sans } from "next/font/google";
import { getOrderByUploadToken } from "@/lib/orders";
import { getPublicFileUrl } from "@/lib/storage";
import { UploadForm } from "@/app/upload/[token]/upload-form";

const headline = Newsreader({
  subsets: ["latin"],
  variable: "--upload-headline"
});

const body = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--upload-body"
});

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
    <div className={`${headline.variable} ${body.variable} upload-stitch-page`}>
      <header className="upload-topbar">
        <div className="upload-topbar-inner">
          <div className="upload-brand">
            <span className="upload-menu" aria-hidden="true">
              =
            </span>
            <span className="upload-brand-name">PawPrints</span>
          </div>
          <div className="upload-avatar" aria-hidden="true">
            ?
          </div>
        </div>
      </header>

      <main className="upload-shell">
        <section className="upload-progress">
          <div className="upload-progress-row">
            <span className="upload-status-pill">
              {isReadyForDownload
                ? "Ready to Download"
                : preview
                  ? "Awaiting Approval"
                  : latestUpload
                    ? "In Progress"
                    : "Awaiting Photo"}
            </span>
            <span className="upload-progress-line" />
          </div>
          <h1 className="upload-title">
            {preview
              ? "Refining the Portrait"
              : latestUpload
                ? "Crafting the Portrait"
                : `Let's start ${order.buyerName}'s portrait`}
          </h1>
        </section>

        {latestUpload ? (
          <section className="upload-preview-section">
            <div className="upload-preview-stack">
              <label className="upload-section-label">{latestUpload.petName.toUpperCase()}</label>
              <div className="upload-image-frame">
                <img
                  className="upload-image"
                  alt={`Current source for ${latestUpload.petName}`}
                  src={getPublicFileUrl(preview ? preview.storageKey : latestUpload.storageKey)}
                />
                <div className="upload-image-badge">
                  <span className="upload-badge-icon" aria-hidden="true">
                    ?
                  </span>
                  {preview ? "Latest Preview" : "Original Upload"}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="upload-note-panel">
          <div className="upload-note-header">
            <span className="upload-note-icon" aria-hidden="true">
              ?
            </span>
            <h2 className="upload-note-title">Latest Preview</h2>
          </div>
          <div className="upload-note-copy">
            <p>
              {preview
                ? "Your latest portrait preview is ready. If anything looks off, you can upload a clearer image below for the next render."
                : finalPng
                  ? "Your portrait has finished rendering and is in final review. If you noticed an issue with the original photo, you can still submit a replacement."
                  : latestUpload
                    ? `Our artists are currently reviewing the lighting in ${latestUpload.petName}'s photo to ensure the final digital painting captures every important detail.`
                    : "Upload a clear photo below and our team will turn it into a portrait-ready preview."}
            </p>
          </div>
        </section>

        <section className="upload-form-section">
          <div className="upload-form-heading">
            <h2 className="upload-form-title">Need to make a change?</h2>
            <p className="upload-form-subtitle">Re-upload a clearer photo for better results.</p>
          </div>

          <div className="upload-action-cluster">
            {isReadyForDownload ? (
              <a className="button" href={`/download/${order.downloadToken}`}>
                Open your finished portrait
              </a>
            ) : null}
            {preview && !isReadyForDownload ? (
              <div className="upload-helper-chip">Latest preview available</div>
            ) : null}
          </div>

          <UploadForm token={token} />
        </section>
      </main>

      <nav className="upload-bottom-nav" aria-label="Customer navigation">
        <button className="upload-nav-item" type="button">
          <span aria-hidden="true">?</span>
          <span>Gallery</span>
        </button>
        <button className="upload-nav-primary" type="button">
          <span aria-hidden="true">+</span>
        </button>
        <button className="upload-nav-item" type="button">
          <span aria-hidden="true">?</span>
          <span>Orders</span>
        </button>
        <button className="upload-nav-item" type="button">
          <span aria-hidden="true">?</span>
          <span>Profile</span>
        </button>
      </nav>
    </div>
  );
}
