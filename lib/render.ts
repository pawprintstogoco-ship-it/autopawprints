import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { putBuffer } from "@/lib/storage";

type RenderInput = {
  source: Buffer;
  petName: string;
  orderId: string;
  version: number;
};

export type RenderOutput = {
  previewKey: string;
  finalPngKey: string;
  finalPdfKey: string;
  blurScore: number;
  width: number;
  height: number;
};

export async function analyzeImage(source: Buffer) {
  const image = sharp(source);
  const metadata = await image.metadata();
  const stats = await image.stats();
  const blurScore = Number((stats.channels[0]?.stdev ?? 0).toFixed(2));

  return {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    blurScore
  };
}

export async function renderPortrait({
  source,
  petName,
  orderId,
  version
}: RenderInput): Promise<RenderOutput> {
  const base = sharp(source).resize(1600, 1600, {
    fit: "cover",
    position: "attention"
  });
  const metadata = await base.metadata();
  const { blurScore, width, height } = await analyzeImage(source);

  const overlay = Buffer.from(`
    <svg width="1600" height="1600" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="wash" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f6f0e7" stop-opacity="0.0"/>
          <stop offset="100%" stop-color="#d9b28f" stop-opacity="0.42"/>
        </linearGradient>
      </defs>
      <rect width="1600" height="1600" fill="url(#wash)" />
      <rect x="48" y="48" width="1504" height="1504" rx="40" fill="none" stroke="#faf7f1" stroke-width="6" />
      <text x="800" y="1480" text-anchor="middle" font-size="110" font-family="Georgia, serif" fill="#faf7f1">${escapeSvgText(
        petName
      )}</text>
    </svg>
  `);

  const previewBuffer = await base
    .modulate({ saturation: 0.8, brightness: 1.03 })
    .grayscale()
    .tint({ r: 214, g: 184, b: 148 })
    .composite([{ input: overlay }])
    .png()
    .toBuffer();

  const finalPngBuffer = await sharp(previewBuffer)
    .resize(2400, 2400, {
      fit: "cover"
    })
    .png()
    .toBuffer();

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([1800, 2400]);
  const pngImage = await pdf.embedPng(finalPngBuffer);
  page.drawImage(pngImage, {
    x: 0,
    y: 0,
    width: 1800,
    height: 2400
  });
  const pdfBuffer = Buffer.from(await pdf.save());

  const prefix = `orders/${orderId}/artifacts/v${version}`;
  const previewKey = `${prefix}/preview.png`;
  const finalPngKey = `${prefix}/final.png`;
  const finalPdfKey = `${prefix}/final.pdf`;

  await Promise.all([
    putBuffer(previewKey, previewBuffer),
    putBuffer(finalPngKey, finalPngBuffer),
    putBuffer(finalPdfKey, pdfBuffer)
  ]);

  return {
    previewKey,
    finalPngKey,
    finalPdfKey,
    blurScore,
    width: metadata.width ?? width,
    height: metadata.height ?? height
  };
}

function escapeSvgText(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
