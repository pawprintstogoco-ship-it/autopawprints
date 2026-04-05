export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

export function isAllowedUploadMimeType(mimeType: string) {
  return ALLOWED_UPLOAD_MIME_TYPES.has(mimeType.toLowerCase());
}
