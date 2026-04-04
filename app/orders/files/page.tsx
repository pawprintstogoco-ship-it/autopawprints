import Link from "next/link";
import { requireAdminSession } from "@/lib/auth";
import { getAdminUploadGallery } from "@/lib/orders";

export default async function OrderFilesPage() {
  await requireAdminSession();
  const uploads = await getAdminUploadGallery();

  return (
    <main className="shell">
      <section className="hero opsHero">
        <div className="eyebrow">Internal operations</div>
        <h1>Customer uploads.</h1>
        <p>Review source photos and remove bad files without leaving operations.</p>
      </section>

      <section className="panel panel-pad stack opsPanel">
        <div className="actions opsPrimaryActions">
          <Link href="/orders" className="buttonSecondary">
            Back to orders
          </Link>
          <Link href="/orders/generated" className="buttonSecondary">
            Generated images
          </Link>
        </div>
      </section>

      <section className="stack" style={{ marginTop: 18 }}>
        <div className="panel panel-pad stack opsPanel">
          <div className="eyebrow">Upload library</div>
          <div className="cards opsGallery">
            {uploads.map((upload) => (
              <article key={upload.id} className="card stack opsMediaCard">
                <img
                  alt={`Upload for ${upload.petName}`}
                  src={`/api/admin/uploads/${upload.id}/thumbnail`}
                  loading="lazy"
                  className="opsMediaThumb"
                />
                <strong>{upload.petName}</strong>
                <span className="muted">{upload.originalName}</span>
                <span className="muted">Buyer: {upload.order.buyerName}</span>
                <span className="muted">Status: {upload.order.status.replaceAll("_", " ")}</span>
                <span className="mono">Order ID: {upload.orderId}</span>
                <Link href={`/orders/${upload.orderId}`} className="buttonSecondary">
                  Open order {upload.order.receiptId}
                </Link>
                <span className="muted">{upload.createdAt.toLocaleString()}</span>
                <form action={`/api/admin/uploads/${upload.id}/delete`} method="post">
                  <input type="hidden" name="redirectTo" value="/orders/files" />
                  <button className="buttonSecondary" type="submit">
                    Delete upload
                  </button>
                </form>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
