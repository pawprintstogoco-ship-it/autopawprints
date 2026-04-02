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

export function getMimeTypeForStorageKey(key: string, mimeType?: string | null) {
  return mimeType || getMimeTypeFromKey(key);
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
