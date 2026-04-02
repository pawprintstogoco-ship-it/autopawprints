import { prisma } from "@/lib/prisma";

type StoredFile = {
  key: string;
  absolutePath: string | null;
};

export async function ensureStoragePath(key: string) {
  return key;
}

function getMimeTypeFromKey(key: string) {
  const normalizedKey = key.toLowerCase();

  if (normalizedKey.endsWith(".png")) {
    return "image/png";
  }

  if (normalizedKey.endsWith(".pdf")) {
    return "application/pdf";
  }

  if (normalizedKey.endsWith(".jpg") || normalizedKey.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  return "application/octet-stream";
}

function escapeSvgText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function getInlineImagePlaceholder(label: string) {
  const safeLabel = escapeSvgText(label);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
      <rect width="800" height="800" fill="#f5f1ea" />
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#6b5a49" font-family="Arial, sans-serif" font-size="42">${safeLabel}</text>
    </svg>
  `;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function getInlineImageSrc(key: string, mimeType?: string) {
  const object = await prisma.binaryObject.findUnique({
    where: {
      storageKey: key
    },
    select: {
      data: true,
      mimeType: true
    }
  });

  if (!object) {
    return null;
  }

  const resolvedMimeType = object.mimeType || mimeType || getMimeTypeFromKey(key);
  return `data:${resolvedMimeType};base64,${Buffer.from(object.data).toString("base64")}`;
}

export async function putBuffer(key: string, buffer: Buffer, mimeType?: string) {
  const bytes = new Uint8Array(buffer);

  await prisma.binaryObject.upsert({
    where: {
      storageKey: key
    },
    update: {
      data: bytes,
      mimeType: mimeType ?? getMimeTypeFromKey(key)
    },
    create: {
      storageKey: key,
      data: bytes,
      mimeType: mimeType ?? getMimeTypeFromKey(key)
    }
  });

  return {
    key,
    absolutePath: null
  } satisfies StoredFile;
}

export async function getBuffer(key: string) {
  const object = await prisma.binaryObject.findUnique({
    where: {
      storageKey: key
    }
  });

  if (!object) {
    throw new Error(`Storage object not found: ${key}`);
  }

  return Buffer.from(object.data);
}

export async function deleteObject(key: string) {
  await prisma.binaryObject.deleteMany({
    where: {
      storageKey: key
    }
  });
}

export function getPublicFileUrl(key: string) {
  const safePath = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/files/${safePath}`;
}
