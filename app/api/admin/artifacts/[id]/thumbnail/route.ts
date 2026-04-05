import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { buildSafeImagePreview } from "@/lib/previews";
import { prisma } from "@/lib/prisma";
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

  const artifact = await prisma.artifact.findUnique({
    where: {
      id
    }
  });

  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  try {
    const file = await getBuffer(artifact.storageKey);
    const preview = await buildSafeImagePreview(file);
    return new NextResponse(toBody(preview), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    const latestUpload = await prisma.customerUpload.findFirst({
      where: {
        orderId: artifact.orderId
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (latestUpload) {
      try {
        const uploadBuffer = await getBuffer(latestUpload.storageKey);
        const preview = await buildSafeImagePreview(uploadBuffer);
        return new NextResponse(toBody(preview), {
          headers: {
            "content-type": "image/png",
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff"
          }
        });
      } catch {
        // Fall through to SVG placeholder below.
      }
    }

    return new NextResponse(toBody(buildFallbackSvg(`Missing ${artifact.kind.replaceAll("_", " ")}`)), {
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      }
    });
  }
}
