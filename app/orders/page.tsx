import Link from "next/link";
import { OrderStatus } from "@prisma/client";
import { requireAdminSession } from "@/lib/auth";
import { getDashboardOrders } from "@/lib/orders";

const statusOptions = Object.values(OrderStatus);

export default async function OrdersPage({
  searchParams
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  await requireAdminSession();
  const params = (await searchParams) ?? {};
  const selectedStatus = statusOptions.find((option) => option === params.status);
  const orders = await getDashboardOrders(selectedStatus);

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">Operations</div>
        <h1>Orders in motion.</h1>
        <p>
          Paid orders flow through upload, render, approval, reminder, and
          delivery states here.
        </p>
      </section>

      <section className="panel panel-pad stack">
        <div className="actions">
          <Link href="/etsy" className="button">
            Etsy pilot setup
          </Link>
          <Link href="/orders/files" className="buttonSecondary">
            File gallery
          </Link>
          <Link href="/orders" className="buttonSecondary">
            All
          </Link>
          {statusOptions.map((status) => (
            <Link
              href={`/orders?status=${status}`}
              className="buttonSecondary"
              key={status}
            >
              {status.replaceAll("_", " ")}
            </Link>
          ))}
        </div>

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
      </section>
    </main>
  );
}
