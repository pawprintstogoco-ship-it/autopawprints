import { notFound } from "next/navigation";
import { getOrderByUploadToken } from "@/lib/orders";

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

      <section className="panel panel-pad" style={{ maxWidth: 720 }}>
        <form
          className="stack"
          action={`/api/uploads/${token}`}
          method="post"
          encType="multipart/form-data"
        >
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
