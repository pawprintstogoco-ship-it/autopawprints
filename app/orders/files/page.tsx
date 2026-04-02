import Link from "next/link";
import { requireAdminSession } from "@/lib/auth";
import { getAdminFileGallery } from "@/lib/orders";
import { getPublicFileUrl } from "@/lib/storage";

export default async function OrderFilesPage() {
  await requireAdminSession();
  const { uploads, artifacts } = await getAdminFileGallery();

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">Admin files</div>
        <h1>Uploads and generated artwork.</h1>
        <p>
          Review every customer upload, preview, and final image file in one place.
        </p>
      </section>

      <section className="panel panel-pad stack">
        <div className="actions">
          <Link href="/orders" className="buttonSecondary">
            Back to orders
          </Link>
        </div>
      </section>

      <section className="stack" style={{ marginTop: 18 }}>
        <div className="panel panel-pad stack">
          <div className="eyebrow">Customer uploads</div>
          <div className="cards">
            {uploads.map((upload) => (
              <article key={upload.id} className="card stack">
                <img
                  alt={`Upload for ${upload.petName}`}
                  src={getPublicFileUrl(upload.storageKey)}
                  style={{ aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 16 }}
                />
                <strong>{upload.petName}</strong>
                <span className="muted">{upload.originalName}</span>
                <span className="muted">{upload.order.buyerName}</span>
                <Link href={`/orders/${upload.orderId}`} className="mono">
                  Receipt {upload.order.receiptId}
                </Link>
                <span className="muted">{upload.createdAt.toLocaleString()}</span>
              </article>
            ))}
          </div>
        </div>

        <div className="panel panel-pad stack">
          <div className="eyebrow">Generated files</div>
          <div className="cards">
            {artifacts.map((artifact) => (
              <article key={artifact.id} className="card stack">
                <img
                  alt={`${artifact.kind} for ${artifact.order.buyerName}`}
                  src={getPublicFileUrl(artifact.storageKey)}
                  style={{ aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 16 }}
                />
                <strong>{artifact.kind.replaceAll("_", " ")}</strong>
                <span className="muted">{artifact.order.buyerName}</span>
                <Link href={`/orders/${artifact.orderId}`} className="mono">
                  Receipt {artifact.order.receiptId}
                </Link>
                <span className="muted">Version {artifact.version}</span>
                <span className="muted">{artifact.createdAt.toLocaleString()}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
