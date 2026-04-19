import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSafeFallbackPreview, buildSafeImagePreview } from "@/lib/previews";
import { getBuffer } from "@/lib/storage";

function toBody(buffer: Buffer) {
  return new Uint8Array(buffer);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await requireAdminSession();
  const { id } = await context.params;

  const upload = await prisma.customerUpload.findUnique({
    where: {
      id
    }
  });

  if (!upload) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  }

  try {
    const file = await getBuffer(upload.storageKey);
    const preview = await buildSafeImagePreview(file);
    return new NextResponse(toBody(preview), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    const fallback = await buildSafeFallbackPreview(`Upload for ${upload.petName}`);
    return new NextResponse(toBody(fallback), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      }
    });
  }
}
