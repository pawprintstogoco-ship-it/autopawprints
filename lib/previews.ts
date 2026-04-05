import sharp from "sharp";

const PREVIEW_MAX_DIMENSION = 1600;

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
