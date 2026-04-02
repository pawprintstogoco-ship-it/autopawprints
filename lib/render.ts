import path from "node:path";
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
  blurScore: number;
  width: number;
  height: number;
};

const FINAL_WIDTH = 1800;
const FINAL_HEIGHT = 2400;
const TITLE_SAFE_HEIGHT = 430;

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

  const prefix = `orders/${orderId}/artifacts/v${version}`;
  const previewKey = `${prefix}/preview.png`;
  const finalPngKey = `${prefix}/final.png`;

  await Promise.all([
    putBuffer(previewKey, previewBuffer),
    putBuffer(finalPngKey, finalPngBuffer)
  ]);

  return {
    previewKey,
    finalPngKey,
    blurScore,
    width: metadata.width ?? width,
    height: metadata.height ?? height
  };
}

async function buildPosterPng(portraitBase: Buffer, petName: string) {
  const artWidth = 1500;
  const artHeight = 2280;
  const artLeft = Math.round((FINAL_WIDTH - artWidth) / 2);
  const artTop = 460;
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
  const firstLineOverlay = await createTitleTextLayer(
    title.firstLine,
    title.fontSize,
    FINAL_WIDTH - 120,
    title.secondLine ? 140 : 170
  );
  const secondLineOverlay = title.secondLine
    ? await createTitleTextLayer(title.secondLine, title.secondLineFontSize, FINAL_WIDTH - 120, 140)
    : null;

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
      {
        input: firstLineOverlay.buffer,
        left: Math.round((FINAL_WIDTH - firstLineOverlay.width) / 2),
        top: title.firstLineTop
      },
      ...(secondLineOverlay
        ? [
            {
              input: secondLineOverlay.buffer,
              left: Math.round((FINAL_WIDTH - secondLineOverlay.width) / 2),
              top: title.secondLineTop
            }
          ]
        : [])
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
      firstLine: displayName,
      secondLine: "",
      fontSize: displayName.length > 10 ? 132 : 152,
      secondLineFontSize: 0,
      firstLineTop: 92,
      secondLineTop: 0
    };
  }

  const midpoint = Math.ceil(words.length / 2);
  const firstLine = words.slice(0, midpoint).join(" ");
  const secondLine = words.slice(midpoint).join(" ");

  return {
    firstLine,
    secondLine,
    fontSize: 116,
    secondLineFontSize: 116,
    firstLineTop: 58,
    secondLineTop: 188
  };
}

function escapePangoText(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function getTitleFontPath() {
  return path.join(
    process.cwd(),
    "assets",
    "fonts",
    "title.ttf"
  );
}

async function createTitleTextLayer(
  text: string,
  fontSize: number,
  width: number,
  height: number
) {
  const rendered = await sharp({
    text: {
      text: `<span foreground="#4a3727">${escapePangoText(text)}</span>`,
      font: `Title ${fontSize}px`,
      fontfile: getTitleFontPath(),
      width,
      height,
      align: "centre",
      rgba: true
    }
  })
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      threshold: 1
    })
    .png()
    .toBuffer();

  const metadata = await sharp(rendered).metadata();

  return {
    buffer: rendered,
    width: metadata.width ?? width
  };
}
