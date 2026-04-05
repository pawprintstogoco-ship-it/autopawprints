import { notFound } from "next/navigation";
import { OrderStatus } from "@prisma/client";
import { headers } from "next/headers";
import { requireAdminSession } from "@/lib/auth";
import { getOrderById } from "@/lib/orders";
import { requireEnv } from "@/lib/env";
import { getPublicFileUrl } from "@/lib/storage";
import { ManualMessageTools } from "@/app/orders/[id]/manual-message-tools";
import { OpsTopNav } from "@/app/orders/ops-top-nav";

export default async function OrderDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    approveError?: string;
    rerenderError?: string;
    rerenderStarted?: string;
  }>;
}) {
  await requireAdminSession();
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const order = await getOrderById(id);
  const approveErrorMessage = query.approveError
    ? safelyDecode(query.approveError)
    : null;
  const rerenderErrorMessage = query.rerenderError
    ? safelyDecode(query.rerenderError)
    : null;
  const rerenderStarted = query.rerenderStarted === "1";
  const { APP_URL } = requireEnv();
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost ?? requestHeaders.get("host");
  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const protocol = forwardedProto ?? "https";
  const fallbackOrigin = new URL(APP_URL).origin;
  const origin = host ? `${protocol}://${host}` : fallbackOrigin;

  if (!order) {
    notFound();
  }

  const preview = order.artifacts.find((artifact) => artifact.kind === "PREVIEW");
  const initialUrl = `${origin}/upload/${order.uploadToken}`;
  const initialMessage = `Thank you for your order. Please upload your pet's photo here so this helps the artist draw the details accurately:\n${initialUrl}`;
  const readyImageUrl = `${origin}/api/files/final/${order.uploadToken}`;
  const deliveryUrl =
    order.status === OrderStatus.DELIVERED
      ? readyImageUrl
      : undefined;
  const deliveryMessage = deliveryUrl
    ? `Your portrait is ready. Save your final PNG here:\n${deliveryUrl}`
    : undefined;

  return (
    <main className="shell">
      <OpsTopNav active="orders" />

      <section className="hero opsHero">
        <div className="eyebrow">Internal operations</div>
        <h1>Receipt {order.receiptId}</h1>
        <p>
          {order.buyerName} · {order.status.replaceAll("_", " ")}
        </p>
      </section>

      <section className="columns">
        <div className="panel panel-pad stack opsPanel">
          <div className="actions opsPrimaryActions">
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

          {approveErrorMessage ? (
            <div className="errorBanner" role="alert">
              Approval failed: {approveErrorMessage}
            </div>
          ) : null}

          {rerenderErrorMessage ? (
            <div className="errorBanner" role="alert">
              Re-render failed: {rerenderErrorMessage}
            </div>
          ) : null}

          {rerenderStarted ? (
            <div className="successBanner" role="status">
              Re-render started. Refresh this page in a moment to see the updated preview.
            </div>
          ) : null}

          <ManualMessageTools
            initialUrl={initialUrl}
            initialMessage={initialMessage}
            deliveryUrl={deliveryUrl}
            deliveryMessage={deliveryMessage}
          />

          {preview ? (
            <img
              alt={`Preview for ${order.buyerName}`}
              src={getPublicFileUrl(preview.storageKey)}
              className="opsDetailPreview"
            />
          ) : (
            <div className="card opsEmptyCard">No preview yet.</div>
          )}

          <div className="cards opsSummaryCards">
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
                  <div key={upload.id} className="opsUploadCard">
                    <a
                      href={`/api/admin/uploads/${upload.id}/thumbnail`}
                      target="_blank"
                      rel="noreferrer"
                      className="opsUploadThumbLink"
                      aria-label={`Open uploaded photo for ${upload.petName}`}
                    >
                      <img
                        alt={`Uploaded photo for ${upload.petName}`}
                        src={`/api/admin/uploads/${upload.id}/thumbnail`}
                        className="opsUploadThumb"
                      />
                    </a>
                    <div className="stack">
                      <strong>{upload.petName}</strong>
                      <a
                        href={`/api/admin/uploads/${upload.id}/thumbnail`}
                        target="_blank"
                        rel="noreferrer"
                        className="opsUploadFileLink"
                      >
                        {upload.originalName}
                      </a>
                      <span className="mono">Blur {upload.blurScore ?? "n/a"}</span>
                    </div>
                  </div>
                ))
              )}
            </article>
          </div>
        </div>

        <aside className="stack">
          <section className="panel panel-pad stack opsPanel">
            <div className="eyebrow">Artifacts</div>
            {order.artifacts.map((artifact) => (
              <a
                href={getPublicFileUrl(artifact.storageKey)}
                key={artifact.id}
                className="card opsLinkCard"
              >
                {artifact.kind} v{artifact.version}
              </a>
            ))}
          </section>

          <section className="panel panel-pad stack opsPanel">
            <div className="eyebrow">Messages</div>
            {order.messageEvents.map((event) => (
              <div key={event.id} className="card stack">
                <strong>{event.eventType}</strong>
                <span className="muted">{event.channel}</span>
                <span>{event.body}</span>
              </div>
            ))}
          </section>

          <section className="panel panel-pad stack opsPanel">
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

function safelyDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
