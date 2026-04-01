import { NextResponse } from "next/server";
import { getOrderByUploadToken, storeCustomerUpload } from "@/lib/orders";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const order = await getOrderByUploadToken(token);

  if (!order) {
    return NextResponse.json({ error: "Upload link is invalid or expired" }, { status: 404 });
  }

  const formData = await request.formData();
  const petName = String(formData.get("petName") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const photo = formData.get("photo");

  if (!(photo instanceof File)) {
    return NextResponse.json({ error: "Photo upload is required" }, { status: 400 });
  }

  try {
    await storeCustomerUpload({
      orderId: order.id,
      petName,
      notes,
      originalName: photo.name,
      mimeType: photo.type,
      fileBuffer: Buffer.from(await photo.arrayBuffer())
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 }
    );
  }

  return NextResponse.redirect(new URL(`/upload/${token}?success=1`, request.url), {
    status: 303
  });
}
