import { notFound } from "next/navigation";
import { getOrderByDownloadToken, recordDeliveryOpen } from "@/lib/orders";

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

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">Your portrait is ready</div>
        <h1>Download your PawPrints files.</h1>
        <p>
          Your download link expires on{" "}
          {order.downloadTokenExpiresAt?.toLocaleString()}.
        </p>
      </section>

      <section className="panel panel-pad cards">
        {order.artifacts
          .filter((artifact) => artifact.kind === "FINAL_PNG")
          .map((artifact) => (
            <a
              href={`/api/files/final/${token}`}
              key={artifact.id}
              className="card stack"
              download
            >
              <strong>{artifact.kind.replaceAll("_", " ")}</strong>
              <span className="muted">{artifact.mimeType}</span>
            </a>
          ))}
      </section>
    </main>
  );
}
