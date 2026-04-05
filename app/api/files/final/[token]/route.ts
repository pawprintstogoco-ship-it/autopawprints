import { NextResponse } from "next/server";
import { getOrderByUploadToken } from "@/lib/orders";
import { getBuffer } from "@/lib/storage";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const order = await getOrderByUploadToken(token);

  if (!order) {
    return new NextResponse("File not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  const finalArtifact = order.finalArtifacts[0];

  if (!finalArtifact) {
    return new NextResponse("Final portrait not ready", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  try {
    const file = await getBuffer(finalArtifact.storageKey);
    return new NextResponse(file, {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store",
        "content-disposition": 'attachment; filename="pawprints-portrait.png"',
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return new NextResponse("File not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
}
