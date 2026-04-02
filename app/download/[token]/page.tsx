import { notFound } from "next/navigation";
import { getOrderByDownloadToken, recordDeliveryOpen } from "@/lib/orders";
import { getPublicFileUrl } from "@/lib/storage";

export default async function DownloadPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await getOrderByDownloadToken(token);

  if (!order) {
    notFound();
  }

  await recordDeliveryOpen(order.id);

  const files = order.artifacts.filter(
    (artifact) => artifact.kind === "FINAL_PNG" || artifact.kind === "FINAL_PDF"
  );

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
          <div className="eyebrow">Your portrait is ready</div>
          <h1>Download your Pet Sanctuary files.</h1>
          <p>
            Choose the file you need below. Your download link expires on {order.downloadTokenExpiresAt?.toLocaleString()}.
          </p>
        </section>

        <section className="panel panel-pad panel-hero stack" style={{ marginBottom: 18 }}>
          <div className="badge" style={{ background: "rgba(255,255,255,0.16)", color: "#fff" }}>Ready for download</div>
          <h2 style={{ fontSize: "2rem", position: "relative" }}>Your portrait package is ready.</h2>
          <p style={{ color: "rgba(255,255,255,0.84)", position: "relative" }}>
            Download the final PNG for easy sharing or the PDF for a clean printable version.
          </p>
        </section>

        <section className="grid">
          {files.map((artifact) => (
            <a href={getPublicFileUrl(artifact.storageKey)} key={artifact.id} className="card stack">
              <strong style={{ fontSize: "1.05rem" }}>{artifact.kind.replaceAll("_", " ")}</strong>
              <span className="muted">{artifact.mimeType}</span>
              <span className="badge">Download file</span>
            </a>
          ))}
        </section>
      </main>
    </>
  );
}
