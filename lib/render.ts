import fs from "node:fs";
import path from "node:path";
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

const FINAL_WIDTH = 1800;
const FINAL_HEIGHT = 2400;
const TITLE_SAFE_HEIGHT = 430;
let embeddedTitleFontDataUri: string | null = null;

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
  const finalPngBuffer = await buildPosterPng(portraitBase, petName);
  const previewBuffer = await sharp(finalPngBuffer)
    .resize(1080, 1440, {
      fit: "inside"
    })
    .png()
    .toBuffer();
  const metadata = await sharp(finalPngBuffer).metadata();

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([FINAL_WIDTH, FINAL_HEIGHT]);
  const pngImage = await pdf.embedPng(finalPngBuffer);
  page.drawImage(pngImage, {
    x: 0,
    y: 0,
    width: FINAL_WIDTH,
    height: FINAL_HEIGHT
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

async function buildPosterPng(portraitBase: Buffer, petName: string) {
  const artWidth = 1380;
  const artHeight = 1860;
  const artLeft = Math.round((FINAL_WIDTH - artWidth) / 2);
  const artTop = 500;
  const title = buildTitleLayout(petName);

  const trimmedPortraitBase = await sharp(portraitBase)
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      threshold: 8
    })
    .toBuffer();

  const portrait = await sharp(trimmedPortraitBase)
    .resize(artWidth, artHeight, {
      fit: "contain",
      position: "top",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .modulate({
      saturation: 0.88,
      brightness: 1.1
    })
    .linear([0.94, 0.97, 1.05, 1], [6, 6, 10, 0])
    .normalise()
    .png()
    .toBuffer();

  const posterBackground = Buffer.from(`
    <svg width="${FINAL_WIDTH}" height="${FINAL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${FINAL_WIDTH}" height="${FINAL_HEIGHT}" fill="#ffffff"/>
    </svg>
  `);

  const titleSafeBand = Buffer.from(`
    <svg width="${FINAL_WIDTH}" height="${FINAL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${FINAL_WIDTH}" height="${TITLE_SAFE_HEIGHT}" fill="#ffffff"/>
    </svg>
  `);

  const titleOverlay = Buffer.from(`
    <svg width="${FINAL_WIDTH}" height="${FINAL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          @font-face {
            font-family: 'PawprintsTitle';
            src: url('${getEmbeddedTitleFontDataUri()}') format('truetype');
            font-weight: 700;
            font-style: normal;
          }
        </style>
      </defs>
      <text
        x="${FINAL_WIDTH / 2}"
        y="${title.firstLineY}"
        text-anchor="middle"
        font-size="${title.fontSize}"
        font-family="PawprintsTitle"
        font-weight="700"
        fill="#4a3727">${title.firstLine}</text>
      ${title.secondLine ? `<text
        x="${FINAL_WIDTH / 2}"
        y="${title.secondLineY}"
        text-anchor="middle"
        font-size="${title.secondLineFontSize}"
        font-family="PawprintsTitle"
        font-weight="700"
        fill="#4a3727">${title.secondLine}</text>` : ""}
    </svg>
  `);

  return sharp({
    create: {
      width: FINAL_WIDTH,
      height: FINAL_HEIGHT,
      channels: 4,
      background: "#ffffff"
    }
  })
    .composite([
      { input: posterBackground },
      { input: portrait, left: artLeft, top: artTop },
      { input: titleSafeBand },
      { input: titleOverlay }
    ])
    .png()
    .toBuffer();
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
    .resize(1024, 1536, {
      fit: "contain",
      position: "attention",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();

  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append(
    "prompt",
    [
      `Create a premium custom pet portrait poster illustration for a pet named ${petName}.`,
      "Keep the same pet identity, fur markings, face shape, and expression recognizable.",
      "Remove the original photo background completely and return only the pet as the subject.",
      "Create a clean stylized illustrated portrait with smooth simplified shapes and crisp edges, similar to premium vector-inspired Etsy pet art.",
      "Use soft painterly color blocks, clear fur definition, an elegant polished finish, and bright neutral color balance.",
      "Avoid sepia, yellow cast, cream cast, or warm vintage toning.",
      "Frame the pet as a centered bust or upper-body portrait facing forward or in natural three-quarter view.",
      "Do not include any room background, scenery, props, collars, frames, shadows on the floor, furniture, extra animals, or any text.",
      "The final image should be just the isolated pet on a transparent background."
    ].join(" ")
  );
  form.append("size", "1024x1536");
  form.append("quality", "high");
  form.append("background", "transparent");
  form.append("output_format", "png");
  form.append("input_fidelity", "high");
  form.append(
    "image",
    new Blob([new Uint8Array(editedSource)], { type: "image/png" }),
    "pet-reference.png"
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
    .resize(1024, 1536, {
      fit: "contain",
      position: "attention",
      background: "#ffffff"
    })
    .modulate({ saturation: 0.88, brightness: 1.08 })
    .linear([0.95, 0.98, 1.04, 1], [4, 4, 8, 0])
    .normalise()
    .png()
    .toBuffer();
}

function formatDisplayName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return "YOUR PET";
  }

  return trimmed
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .toUpperCase();
}

function buildTitleLayout(name: string) {
  const displayName = formatDisplayName(name);
  const words = displayName.split(/\s+/).filter(Boolean);
  const shouldSplit = displayName.length > 12 && words.length > 1;

  if (!shouldSplit) {
    return {
      firstLine: escapeSvgText(displayName),
      secondLine: "",
      fontSize: displayName.length > 10 ? 112 : 128,
      secondLineFontSize: 0,
      letterSpacing: displayName.length > 10 ? 4 : 6,
      secondLineLetterSpacing: 0,
      firstLineY: 220,
      secondLineY: 0,
      subtitleY: 0
    };
  }

  const midpoint = Math.ceil(words.length / 2);
  const firstLine = escapeSvgText(words.slice(0, midpoint).join(" "));
  const secondLine = escapeSvgText(words.slice(midpoint).join(" "));

  return {
    firstLine,
    secondLine,
    fontSize: 94,
    secondLineFontSize: 94,
    letterSpacing: 3,
    secondLineLetterSpacing: 3,
    firstLineY: 190,
    secondLineY: 292,
    subtitleY: 0
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

function getEmbeddedTitleFontDataUri() {
  if (embeddedTitleFontDataUri) {
    return embeddedTitleFontDataUri;
  }

  const fontPath = path.join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "compiled",
    "@vercel",
    "og",
    "noto-sans-v27-latin-regular.ttf"
  );
  const fontBytes = fs.readFileSync(fontPath);
  embeddedTitleFontDataUri = `data:font/ttf;base64,${fontBytes.toString("base64")}`;
  return embeddedTitleFontDataUri;
}
