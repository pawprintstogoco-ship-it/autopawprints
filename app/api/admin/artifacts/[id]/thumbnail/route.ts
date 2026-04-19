import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { buildSafeFallbackPreview, buildSafeImagePreview } from "@/lib/previews";
import { prisma } from "@/lib/prisma";
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

    const fallback = await buildSafeFallbackPreview(
      `Missing ${artifact.kind.replaceAll("_", " ")}`
    );
    return new NextResponse(toBody(fallback), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      }
    });
  }
}
