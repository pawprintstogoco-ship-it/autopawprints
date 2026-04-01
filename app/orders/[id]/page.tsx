import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { getOrderById } from "@/lib/orders";
import { getPublicFileUrl } from "@/lib/storage";

export default async function OrderDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminSession();
  const { id } = await params;
  const order = await getOrderById(id);

  if (!order) {
    notFound();
  }

  const preview = order.artifacts.find((artifact) => artifact.kind === "PREVIEW");

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">Order detail</div>
        <h1>Receipt {order.receiptId}</h1>
        <p>
          {order.buyerName} · {order.status.replaceAll("_", " ")}
        </p>
      </section>

      <section className="columns">
        <div className="panel panel-pad stack">
          <div className="actions">
            <form action={`/api/orders/${order.id}/approve`} method="post">
              <button className="button" type="submit">
                Approve and deliver
              </button>
            </form>
            <form action={`/api/orders/${order.id}/rerender`} method="post">
              <button className="buttonSecondary" type="submit">
                Re-render
              </button>
            </form>
            <form action={`/api/orders/${order.id}/manual-attention`} method="post">
              <input type="hidden" name="reason" value="Manual review requested from dashboard" />
              <button className="buttonSecondary" type="submit">
                Needs manual attention
              </button>
            </form>
          </div>

          {preview ? (
            <img
              alt={`Preview for ${order.buyerName}`}
              src={getPublicFileUrl(preview.storageKey)}
            />
          ) : (
            <div className="card">No preview yet.</div>
          )}

          <div className="cards">
            <article className="card stack">
              <div className="eyebrow">Buyer</div>
              <strong>{order.buyerName}</strong>
              <span className="muted">{order.buyerEmail ?? "No email captured"}</span>
              <span className="mono">Receipt {order.receiptId}</span>
            </article>

            <article className="card stack">
              <div className="eyebrow">Uploads</div>
              {order.uploads.length === 0 ? (
                <span className="muted">Waiting for upload</span>
              ) : (
                order.uploads.map((upload) => (
                  <div key={upload.id} className="stack">
                    <strong>{upload.petName}</strong>
                    <span className="muted">{upload.originalName}</span>
                    <span className="mono">Blur {upload.blurScore ?? "n/a"}</span>
                  </div>
                ))
              )}
            </article>
          </div>
        </div>

        <aside className="stack">
          <section className="panel panel-pad stack">
            <div className="eyebrow">Artifacts</div>
            {order.artifacts.map((artifact) => (
              <a
                href={getPublicFileUrl(artifact.storageKey)}
                key={artifact.id}
                className="card"
              >
                {artifact.kind} v{artifact.version}
              </a>
            ))}
          </section>

          <section className="panel panel-pad stack">
            <div className="eyebrow">Messages</div>
            {order.messageEvents.map((event) => (
              <div key={event.id} className="card stack">
                <strong>{event.eventType}</strong>
                <span className="muted">{event.channel}</span>
                <span>{event.body}</span>
              </div>
            ))}
          </section>

          <section className="panel panel-pad stack">
            <div className="eyebrow">Audit log</div>
            {order.auditLog.map((event) => (
              <div key={event.id} className="card stack">
                <strong>{event.action}</strong>
                <span className="muted">{event.createdAt.toLocaleString()}</span>
              </div>
            ))}
          </section>
        </aside>
      </section>
    </main>
  );
}
