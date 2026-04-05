import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSafeImagePreview } from "@/lib/previews";
import { getBuffer } from "@/lib/storage";

function buildFallbackSvg(label: string) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
      <rect width="800" height="800" fill="#f5f1ea" />
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#6b5a49" font-family="Arial, sans-serif" font-size="42">${label}</text>
    </svg>
  `);
}

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
    return new NextResponse(toBody(buildFallbackSvg(`Upload for ${upload.petName}`)), {
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      }
    });
  }
}
