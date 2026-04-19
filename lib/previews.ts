import sharp from "sharp";

const PREVIEW_MAX_DIMENSION = 1600;
const FALLBACK_PREVIEW_SIZE = 800;

export async function buildSafeImagePreview(source: Buffer) {
  return sharp(source, {
    limitInputPixels: 40_000_000
  })
    .rotate()
    .resize(PREVIEW_MAX_DIMENSION, PREVIEW_MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true
    })
    .png()
    .toBuffer();
}

function escapeSvgText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function buildSafeFallbackPreview(label: string) {
  const safeLabel = escapeSvgText(label.trim().slice(0, 80) || "Preview unavailable");
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${FALLBACK_PREVIEW_SIZE}" height="${FALLBACK_PREVIEW_SIZE}" viewBox="0 0 ${FALLBACK_PREVIEW_SIZE} ${FALLBACK_PREVIEW_SIZE}">
      <rect width="${FALLBACK_PREVIEW_SIZE}" height="${FALLBACK_PREVIEW_SIZE}" fill="#f5f1ea" />
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#6b5a49" font-family="Arial, sans-serif" font-size="42">${safeLabel}</text>
    </svg>
  `);

  return sharp(svg, {
    limitInputPixels: 4_000_000
  })
    .png()
    .toBuffer();
}
