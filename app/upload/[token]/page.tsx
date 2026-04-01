import { notFound } from "next/navigation";
import { getOrderByUploadToken } from "@/lib/orders";
import { getPublicFileUrl } from "@/lib/storage";

export default async function UploadPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await getOrderByUploadToken(token);

  if (!order) {
    notFound();
  }

  const latestUpload = order.uploads[0] ?? null;
  const preview = order.artifacts.find((artifact) => artifact.kind === "PREVIEW") ?? null;
  const finalPng = order.artifacts.find((artifact) => artifact.kind === "FINAL_PNG") ?? null;
  const isReadyForDownload = Boolean(order.downloadToken && order.status === "DELIVERED");

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">Upload your photo</div>
        <h1>Let’s make {order.buyerName}&apos;s portrait.</h1>
        <p>
          Upload your best pet photo and tell us the name exactly as you want it
          shown on the print.
        </p>
      </section>

      {latestUpload ? (
        <section className="panel panel-pad stack" style={{ maxWidth: 720 }}>
          <div className="eyebrow">Order status</div>
          <strong>{order.status.replaceAll("_", " ")}</strong>
          <p>
            We received {latestUpload.petName}&apos;s photo and we&apos;re preparing the portrait.
          </p>

          {preview ? (
            <div className="stack">
              <img
                alt={`Preview for ${latestUpload.petName}`}
                src={getPublicFileUrl(preview.storageKey)}
              />
              <span className="muted">Latest preview</span>
            </div>
          ) : null}

          {isReadyForDownload ? (
            <a className="button" href={`/download/${order.downloadToken}`}>
              Open your finished portrait
            </a>
          ) : finalPng ? (
            <div className="card">
              Your portrait is rendered and waiting for final review. Check back here soon.
            </div>
          ) : (
            <div className="card">
              Your upload is in the queue. This page will show the preview once it&apos;s ready.
            </div>
          )}
        </section>
      ) : null}

      <section className="panel panel-pad" style={{ maxWidth: 720 }}>
        <form
          className="stack"
          action={`/api/uploads/${token}`}
          method="post"
          encType="multipart/form-data"
        >
          <div className="muted">
            Re-uploading a new photo will replace the current source image for the next render.
          </div>
          <label className="field">
            <span>Pet name</span>
            <input type="text" name="petName" required />
          </label>
          <label className="field">
            <span>Photo</span>
            <input type="file" name="photo" accept="image/*" required />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea name="notes" rows={5} placeholder="Anything we should know about the portrait?" />
          </label>
          <button className="button" type="submit">
            Submit photo
          </button>
        </form>
      </section>
    </main>
  );
}
