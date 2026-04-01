import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireEnv } from "@/lib/env";

type StoredFile = {
  key: string;
  absolutePath: string;
};

function resolveStoragePath(key: string) {
  const { STORAGE_ROOT } = requireEnv();
  return path.resolve(STORAGE_ROOT, key);
}

export async function ensureStoragePath(key: string) {
  const absolutePath = resolveStoragePath(key);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  return absolutePath;
}

export async function putBuffer(key: string, buffer: Buffer) {
  const absolutePath = await ensureStoragePath(key);
  await writeFile(absolutePath, buffer);
  return {
    key,
    absolutePath
  } satisfies StoredFile;
}

export async function getBuffer(key: string) {
  return readFile(resolveStoragePath(key));
}

export function getPublicFileUrl(key: string) {
  const { APP_URL } = requireEnv();
  const safePath = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${APP_URL}/api/files/${safePath}`;
}
