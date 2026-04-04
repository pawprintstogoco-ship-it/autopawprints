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
  const artifactBaseName = buildArtifactBaseName(petName);
  const previewKey = `${prefix}/${artifactBaseName}_preview.png`;
  const finalPngKey = `${prefix}/${artifactBaseName}_final.png`;

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
      `Create a premium custom pet portrait illustration for a pet named ${petName}.`,
      "",
      "CRITICAL - PRESERVE EXACT LIKENESS:",
      "The result must closely match the provided photo with high fidelity.",
      "Do not reinterpret or generalize the pet.",
      "Accurately preserve:",
      "- Face structure and proportions",
      "- Eye shape, size, spacing, and color",
      "- Nose shape and position",
      "- Fur pattern, markings, and color distribution",
      "- Unique features (patches, asymmetry, muzzle shape, ear position)",
      "The pet should be immediately recognizable as the same individual.",
      "",
      "STYLE:",
      "Render the pet in a clean, high-end illustrated style with smooth, simplified shapes and crisp edges.",
      "Use controlled painterly shading with clear fur direction and layered detail (not flat vector).",
      "Maintain detail in key areas (eyes, snout, fur transitions), while simplifying only non-essential micro-noise.",
      "",
      "COMPOSITION:",
      "- Centered bust or upper-body portrait",
      "- Pet occupies lower 60-70% of the canvas",
      "- Neutral head-on or natural 3/4 angle matching the original photo",
      "",
      "BACKGROUND:",
      "- Solid, clean, modern background (light neutral or muted color)",
      "- No texture, no gradients, no environment",
      "",
      "STRICT RULES:",
      "- No collars, tags, props, furniture, or accessories",
      "- No additional animals or elements",
      "- No text",
      "- No stylization that alters anatomy or likeness",
      "- No over-smoothing that removes identity features",
      "",
      "COLOR:",
      "- Use true-to-photo color accuracy",
      "- Avoid warm/yellow/sepia cast",
      "- Keep tones neutral and balanced",
      "",
      "OUTPUT:",
      "A polished, modern Etsy-style pet portrait that combines strong likeness accuracy with clean, minimal illustration."
    ].join("\n")
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

function buildArtifactBaseName(name: string) {
  const safeName = formatDisplayName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "your_pet";
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  const time = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");

  return `${safeName}_${date}_${time}`;
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
