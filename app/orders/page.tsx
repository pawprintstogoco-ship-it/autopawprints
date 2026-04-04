import Link from "next/link";
import { OrderStatus } from "@prisma/client";
import { requireAdminSession } from "@/lib/auth";
import { getDashboardOrders } from "@/lib/orders";
import { OpsTopNav } from "@/app/orders/ops-top-nav";

const statusOptions = Object.values(OrderStatus);

export default async function OrdersPage({
  searchParams
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  await requireAdminSession();
  const params = (await searchParams) ?? {};
  const selectedStatus = statusOptions.find((option) => option === params.status);
  let orders = [] as Awaited<ReturnType<typeof getDashboardOrders>>;
  let loadError: string | null = null;

  try {
    orders = await getDashboardOrders(selectedStatus);
  } catch (error) {
    console.error("OrdersPage failed to load dashboard orders", error);
    loadError = "Orders are temporarily unavailable. Please try again in a moment.";
  }

  const awaitingPhotoCount = orders.filter((order) => order.status === OrderStatus.AWAITING_PHOTO).length;
  const manualCount = orders.filter((order) => !order.pilotListingEligible).length;

  return (
    <main className="shell">
      <OpsTopNav active="orders" />

      <section className="hero opsHero">
        <div className="eyebrow">Internal operations</div>
        <h1>Order operations dashboard.</h1>
        <p>Track every order, jump to actions quickly, and keep the production queue moving.</p>
      </section>

      <section className="panel panel-pad stack opsPanel">
        <div className="cards opsSummaryCards">
          <article className="card stack">
            <div className="eyebrow">Visible orders</div>
            <strong className="opsMetric">{orders.length}</strong>
            <span className="muted">Filtered by selected status</span>
          </article>
          <article className="card stack">
            <div className="eyebrow">Awaiting photo</div>
            <strong className="opsMetric">{awaitingPhotoCount}</strong>
            <span className="muted">Orders waiting for customer upload</span>
          </article>
          <article className="card stack">
            <div className="eyebrow">Manual flow</div>
            <strong className="opsMetric">{manualCount}</strong>
            <span className="muted">Orders outside pilot listing</span>
          </article>
        </div>

        <div className="actions opsPrimaryActions">
          <Link href="/etsy" className="button">
            Etsy pilot setup
          </Link>
          <Link href="/orders/files" className="buttonSecondary">
            Uploads
          </Link>
          <Link href="/orders/generated" className="buttonSecondary">
            Generated images
          </Link>
        </div>

        <div className="actions opsFilterActions">
          <Link href="/orders" className={selectedStatus ? "buttonSecondary" : "button"}>
            All statuses
          </Link>
          {statusOptions.map((status) => {
            const active = selectedStatus === status;
            return (
              <Link
                href={`/orders?status=${status}`}
                className={active ? "button" : "buttonSecondary"}
                key={status}
              >
                {status.replaceAll("_", " ")}
              </Link>
            );
          })}
        </div>

        {loadError ? (
          <div className="errorBanner" role="alert">
            {loadError}
          </div>
        ) : null}

        <div className="opsTableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Buyer</th>
                <th>Status</th>
                <th>Pilot</th>
                <th>Photo</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <Link href={`/orders/${order.id}`} className="mono">
                      {order.receiptId}
                    </Link>
                  </td>
                  <td>{order.buyerName}</td>
                  <td>
                    <span className="badge">{order.status.replaceAll("_", " ")}</span>
                  </td>
                  <td>
                    <span className="badge">
                      {order.pilotListingEligible ? "Pilot listing" : "Manual"}
                    </span>
                  </td>
                  <td>{order.latestUploadName ?? "Waiting for upload"}</td>
                  <td>{order.createdAt.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
