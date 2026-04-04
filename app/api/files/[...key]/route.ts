import { NextResponse } from "next/server";
import { getBuffer } from "@/lib/storage";

function getContentType(key: string) {
  if (key.endsWith(".png")) {
    return "image/png";
  }

  if (key.endsWith(".pdf")) {
    return "application/pdf";
  }

  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  return "application/octet-stream";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> }
) {
  const { key } = await context.params;
  const storageKey = key.join("/");

  try {
    const file = await getBuffer(storageKey);
    return new NextResponse(file, {
      headers: {
        "content-type": getContentType(storageKey),
        "cache-control": "private, max-age=60"
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
