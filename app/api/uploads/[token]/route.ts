import { NextResponse } from "next/server";
import { getOrderByUploadToken, storeCustomerUpload } from "@/lib/orders";
import { MAX_UPLOAD_BYTES, isAllowedUploadMimeType } from "@/lib/uploads";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  let order;

  try {
    order = await getOrderByUploadToken(token);
  } catch (error) {
    console.error("Upload token lookup failed", error);
    return NextResponse.json(
      { error: "Upload service is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }

  if (!order) {
    return NextResponse.json({ error: "Upload link is invalid or expired" }, { status: 404 });
  }

  if (order.uploads.length > 0) {
    return NextResponse.json(
      { error: "Photo already received for this order." },
      { status: 409 }
    );
  }

  const formData = await request.formData();
  const petName = String(formData.get("petName") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const photo = formData.get("photo");

  if (!(photo instanceof File)) {
    return NextResponse.json({ error: "Photo upload is required" }, { status: 400 });
  }

  if (!isAllowedUploadMimeType(photo.type)) {
    return NextResponse.json(
      { error: "Only JPG, PNG, WEBP, or HEIC images are supported" },
      { status: 400 }
    );
  }

  if (photo.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Photo is too large. Please upload an image under 15 MB." },
      { status: 413 }
    );
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

  return NextResponse.json({ ok: true });
}
