import Link from "next/link";
import { requireAdminSession } from "@/lib/auth";
import { getAdminGeneratedGallery } from "@/lib/orders";
import { OpsTopNav } from "@/app/orders/ops-top-nav";

export default async function GeneratedFilesPage() {
  await requireAdminSession();
  const artifacts = await getAdminGeneratedGallery();

  return (
    <main className="shell">
      <OpsTopNav active="generated" />

      <section className="hero opsHero">
        <div className="eyebrow">Internal operations</div>
        <h1>Generated portraits.</h1>
        <p>Review render outputs and remove bad generations from one gallery.</p>
      </section>

      <section className="panel panel-pad stack opsPanel">
        <div className="actions opsPrimaryActions">
          <Link href="/orders" className="buttonSecondary">
            Back to orders
          </Link>
          <Link href="/orders/files" className="buttonSecondary">
            Customer uploads
          </Link>
        </div>
      </section>

      <section className="panel panel-pad stack opsPanel" style={{ marginTop: 18 }}>
        <div className="eyebrow">Generated files</div>
        <div className="cards opsGallery">
          {artifacts.map((artifact) => (
            <article key={artifact.id} className="card stack opsMediaCard">
              <img
                alt={`${artifact.kind} for ${artifact.order.buyerName}`}
                src={`/api/admin/artifacts/${artifact.id}/thumbnail`}
                loading="lazy"
                className="opsMediaThumb"
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
