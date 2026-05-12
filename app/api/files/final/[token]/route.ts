import { NextResponse } from "next/server";
import { getOrderByDownloadToken, getOrderByUploadToken } from "@/lib/orders";
import { getBuffer } from "@/lib/storage";

function getLatestFinalArtifacts<
  T extends {
    id: string;
    kind: string;
    portraitSlotId?: string | null;
    createdAt: Date;
    version: number;
  }
>(artifacts: T[]) {
  const latestBySlot = new Map<string, T>();

  for (const artifact of artifacts
    .filter((item) => item.kind === "FINAL_PNG")
    .sort((a, b) => b.version - a.version || b.createdAt.getTime() - a.createdAt.getTime())) {
    const key = artifact.portraitSlotId ?? artifact.id;
    if (!latestBySlot.has(key)) {
      latestBySlot.set(key, artifact);
    }
  }

  return Array.from(latestBySlot.values());
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const requestUrl = new URL(request.url);
  const artifactId = requestUrl.searchParams.get("artifactId");
  const uploadOrder = await getOrderByUploadToken(token);
  const downloadOrder = uploadOrder ? null : await getOrderByDownloadToken(token);
  const order = uploadOrder ?? downloadOrder;

  if (!order) {
    return new NextResponse("File not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  const finalArtifact =
    "finalArtifacts" in order
      ? artifactId
        ? order.finalArtifacts.find((artifact) => artifact.id === artifactId)
        : order.finalArtifacts[0]
      : getLatestFinalArtifacts(order.artifacts).find((artifact) =>
          artifactId ? artifact.id === artifactId : true
        );

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
