import Link from "next/link";
import { requireAdminSession } from "@/lib/auth";
import { getPendingInitialEtsyUploadMessages } from "@/lib/pending-etsy-messages";
import { OpsTopNav } from "@/app/orders/ops-top-nav";

export default async function PendingEtsyMessagesPage() {
  await requireAdminSession();
  const messages = await getPendingInitialEtsyUploadMessages();

  return (
    <main className="shell">
      <OpsTopNav active="etsyMessages" />

      <section className="hero opsHero">
        <div className="eyebrow">Etsy operations</div>
        <h1>Pending upload messages.</h1>
        <p>Structured queue for orders that are waiting for the initial Etsy upload link.</p>
      </section>

      <section className="panel panel-pad stack opsPanel">
        <div className="cards opsSummaryCards">
          <article className="card stack">
            <div className="eyebrow">Pending messages</div>
            <strong className="opsMetric">{messages.length}</strong>
            <span className="muted">Eligible orders awaiting photo upload</span>
          </article>
        </div>

        {messages.length === 0 ? (
          <div className="card opsEmptyCard">No pending Etsy upload messages.</div>
        ) : (
          <div className="opsTableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Buyer</th>
                  <th>Listing</th>
                  <th>Upload link</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => (
                  <tr key={message.orderId}>
                    <td>
                      <Link href={`/orders/${message.orderId}`} className="mono">
                        {message.receiptId}
                      </Link>
                    </td>
                    <td>{message.buyerName}</td>
                    <td>{message.listingId ?? "n/a"}</td>
                    <td>
                      <a href={message.uploadUrl} className="mono" target="_blank" rel="noreferrer">
                        {message.uploadUrl}
                      </a>
                    </td>
                    <td>{message.createdAt.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
