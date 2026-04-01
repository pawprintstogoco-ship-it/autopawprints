import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { requireEnv } from "@/lib/env";
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
  const { blurScore, width, height } = await analyzeImage(source);
  const portraitBase = await createPortraitBase(source, petName);
  const base = sharp(portraitBase).resize(1600, 1600, {
    fit: "cover",
    position: "attention"
  });
  const metadata = await base.metadata();

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

async function createPortraitBase(source: Buffer, petName: string) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return createFallbackPortrait(source);
  }

  try {
    return await generateAiPortrait(source, petName);
  } catch (error) {
    console.error("[render] falling back to local portrait render", error);
    return createFallbackPortrait(source);
  }
}

async function generateAiPortrait(source: Buffer, petName: string) {
  const { OPENAI_API_KEY, OPENAI_IMAGE_MODEL } = requireEnv();
  const editedSource = await sharp(source)
    .resize(1536, 1536, {
      fit: "cover",
      position: "attention"
    })
    .jpeg({ quality: 92 })
    .toBuffer();

  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append(
    "prompt",
    [
      "Create a clean, polished custom pet memorial portrait from the provided pet photo.",
      "Keep the same pet identity, fur markings, face shape, and expression recognizable.",
      "Use a refined illustrated portrait style with soft painterly detail, a centered composition,",
      "and a simple warm neutral studio background suitable for an Etsy digital print.",
      "Show only the pet. Do not add collars, props, frames, extra animals, or any text."
    ].join(" ")
  );
  form.append("size", "1536x1536");
  form.append("quality", "high");
  form.append(
    "image",
    new Blob([new Uint8Array(editedSource)], { type: "image/jpeg" }),
    "pet-reference.jpg"
  );

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: form
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI image edit failed for ${petName}: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      b64_json?: string;
      url?: string;
    }>;
  };
  const image = payload.data?.[0];

  if (image?.b64_json) {
    return Buffer.from(image.b64_json, "base64");
  }

  if (image?.url) {
    const imageResponse = await fetch(image.url);
    if (!imageResponse.ok) {
      throw new Error(`OpenAI returned an unreadable image URL: ${imageResponse.status}`);
    }

    return Buffer.from(await imageResponse.arrayBuffer());
  }

  throw new Error("OpenAI image edit returned no image data");
}

async function createFallbackPortrait(source: Buffer) {
  return sharp(source)
    .resize(1600, 1600, {
      fit: "cover",
      position: "attention"
    })
    .modulate({ saturation: 0.8, brightness: 1.03 })
    .grayscale()
    .tint({ r: 214, g: 184, b: 148 })
    .png()
    .toBuffer();
}

function escapeSvgText(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
