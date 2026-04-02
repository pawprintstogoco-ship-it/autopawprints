import Link from "next/link";
import { requireAdminSession } from "@/lib/auth";
import { getAdminGeneratedGallery } from "@/lib/orders";

export default async function GeneratedFilesPage() {
  await requireAdminSession();
  const artifacts = await getAdminGeneratedGallery();

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">Generated images</div>
        <h1>Preview and final image management.</h1>
        <p>
          Review and remove generated preview and final portrait images.
        </p>
      </section>

      <section className="panel panel-pad stack">
        <div className="actions">
          <Link href="/orders" className="buttonSecondary">
            Back to orders
          </Link>
          <Link href="/orders/files" className="buttonSecondary">
            Customer uploads
          </Link>
        </div>
      </section>

      <section className="panel panel-pad stack" style={{ marginTop: 18 }}>
        <div className="eyebrow">Generated files</div>
        <div className="cards">
          {artifacts.map((artifact) => (
            <article key={artifact.id} className="card stack">
              <img
                alt={`${artifact.kind} for ${artifact.order.buyerName}`}
                src={`/api/admin/artifacts/${artifact.id}/thumbnail`}
                loading="lazy"
                style={{ aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 16 }}
              />
              <strong>{artifact.kind.replaceAll("_", " ")}</strong>
              <span className="muted">Buyer: {artifact.order.buyerName}</span>
              <span className="muted">Status: {artifact.order.status.replaceAll("_", " ")}</span>
              <span className="mono">Order ID: {artifact.orderId}</span>
              <Link href={`/orders/${artifact.orderId}`} className="buttonSecondary">
                Open order {artifact.order.receiptId}
              </Link>
              <span className="muted">Version {artifact.version}</span>
              <span className="muted">{artifact.createdAt.toLocaleString()}</span>
              <form action={`/api/admin/artifacts/${artifact.id}/delete`} method="post">
                <input type="hidden" name="redirectTo" value="/orders/generated" />
                <button className="buttonSecondary" type="submit">
                  Delete generated image
                </button>
              </form>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
