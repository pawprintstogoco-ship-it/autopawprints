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
  const finalArtifacts = order.artifacts
    .filter((artifact) => artifact.kind === "FINAL_PNG")
    .sort((a, b) => b.version - a.version || b.createdAt.getTime() - a.createdAt.getTime());
  const latestFinalsBySlot = new Map<string, (typeof finalArtifacts)[number]>();

  for (const artifact of finalArtifacts) {
    const key = artifact.portraitSlotId ?? artifact.id;
    if (!latestFinalsBySlot.has(key)) {
      latestFinalsBySlot.set(key, artifact);
    }
  }

  const latestFinalArtifacts = Array.from(latestFinalsBySlot.values());

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
        {latestFinalArtifacts
          .map((artifact, index) => (
            <a
              href={`/api/files/final/${token}?artifactId=${artifact.id}`}
              key={artifact.id}
              className="card stack"
              download
            >
              <strong>
                {latestFinalArtifacts.length > 1
                  ? `FINAL PNG ${index + 1}`
                  : artifact.kind.replaceAll("_", " ")}
              </strong>
              <span className="muted">{artifact.mimeType}</span>
            </a>
          ))}
      </section>
    </main>
  );
}
