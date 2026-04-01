import { notFound } from "next/navigation";
import { getOrderByDownloadToken, recordDeliveryOpen } from "@/lib/orders";
import { getPublicFileUrl } from "@/lib/storage";

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
          Choose the file you need below. Your download link expires on{" "}
          {order.downloadTokenExpiresAt?.toLocaleString()}.
        </p>
      </section>

      <section className="panel panel-pad cards">
        {order.artifacts
          .filter((artifact) => artifact.kind === "FINAL_PNG" || artifact.kind === "FINAL_PDF")
          .map((artifact) => (
            <a
              href={getPublicFileUrl(artifact.storageKey)}
              key={artifact.id}
              className="card stack"
            >
              <strong>{artifact.kind.replaceAll("_", " ")}</strong>
              <span className="muted">{artifact.mimeType}</span>
            </a>
          ))}
      </section>
    </main>
  );
}
