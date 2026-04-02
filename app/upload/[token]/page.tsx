import { notFound } from "next/navigation";
import { Newsreader, Plus_Jakarta_Sans } from "next/font/google";
import { getOrderByUploadToken } from "@/lib/orders";
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
  const statusLabel = latestUpload ? "In Progress" : "Awaiting Photo";
  const title = latestUpload
    ? "Refresh the source photo"
    : `Upload a photo for ${order.buyerName}'s portrait`;
  const intro = latestUpload
    ? "If you have a clearer or better-lit photo, send it here and we'll use it for the next render."
    : "Send us a sharp, well-lit image and we'll turn it into a portrait-ready reference for the next stage.";

  return (
    <div className={`${headline.variable} ${body.variable} upload-stitch-page`}>
      <header className="upload-topbar">
        <div className="upload-topbar-inner">
          <div className="upload-brand">
            <span className="upload-brand-mark" aria-hidden="true">
              Paw
            </span>
            <span className="upload-brand-name">PawPrints</span>
          </div>
          <div className="upload-avatar" aria-hidden="true">
            PP
          </div>
        </div>
      </header>

      <main className="upload-shell upload-shell-wide">
        <section className="upload-progress upload-hero-card">
          <div className="upload-progress-row">
            <span className="upload-status-pill">{statusLabel}</span>
            <span className="upload-progress-line" />
          </div>

          <div className="upload-hero-grid">
            <div className="upload-hero-copy">
              <h1 className="upload-title">{title}</h1>
              <p className="upload-hero-text">{intro}</p>
            </div>

            <aside className="upload-side-note" aria-label="Photo tips">
              <span className="upload-side-note-label">Best Results</span>
              <h2 className="upload-side-note-title">Use one strong reference photo</h2>
              <p className="upload-side-note-text">
                Front-facing photos with bright natural light and a clear view of the face will
                give the cleanest portrait result.
              </p>
            </aside>
          </div>
        </section>

        <section className="upload-form-section upload-form-card">
          <div className="upload-form-heading upload-form-heading-left">
            <h2 className="upload-form-title">Update your upload</h2>
            <p className="upload-form-subtitle">
              Add the email we should use for delivery, confirm the pet name, and upload the new
              photo below.
            </p>
          </div>

          <UploadForm token={token} />
        </section>
      </main>
    </div>
  );
}
