import path from "node:path";
import sharp from "sharp";
import { requireEnv } from "@/lib/env";
import {
  getPosterBackgroundOption,
  getPosterFontOption,
  type PosterBackgroundStyle,
  type PosterFontStyle
} from "@/lib/poster-styles";
import { putBuffer } from "@/lib/storage";

type RenderInput = {
  source: Buffer;
  petName: string;
  fontStyle: PosterFontStyle;
  backgroundStyle: PosterBackgroundStyle;
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
const TITLE_SAFE_HEIGHT = 700;
const OPENAI_RENDER_TIMEOUT_MS = 90_000;
const OPENAI_IMAGE_DOWNLOAD_TIMEOUT_MS = 45_000;
const BUST_EXTENSION_HEIGHT = 620;
const PORTRAIT_BOTTOM_BLEED = 120;

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
  fontStyle,
  backgroundStyle,
  orderId,
  version
}: RenderInput): Promise<RenderOutput> {
  const { blurScore, width, height } = await analyzeImage(source);
  const portraitBase = await createPortraitBase(source, petName);
  const finalPngBuffer = await buildPosterPng(portraitBase, petName, {
    fontStyle,
    backgroundStyle
  });
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

async function buildPosterPng(
  portraitBase: Buffer,
  petName: string,
  {
    fontStyle,
    backgroundStyle
  }: {
    fontStyle: PosterFontStyle;
    backgroundStyle: PosterBackgroundStyle;
  }
) {
  const artWidth = 1440;
  const artHeight = 1700;
  const artLeft = Math.round((FINAL_WIDTH - artWidth) / 2);
  const artTop = 700;
  const title = buildTitleLayout(petName, fontStyle);
  const background = getPosterBackgroundOption(backgroundStyle);
  const titleFont = getPosterFontOption(fontStyle);
  const cleanedPortraitBase = await preparePortraitForComposition(portraitBase);

  const trimmedPortraitBase = await sharp(cleanedPortraitBase)
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      threshold: 8
    })
    .toBuffer();

  const portrait = await sharp(trimmedPortraitBase)
    .resize(artWidth, artHeight, {
      fit: "contain",
      position: "attention",
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
  const alignedPortrait = await sharp(portrait)
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      threshold: 3
    })
    .png()
    .toBuffer();
  const portraitWithBustBase = await createBustBaseExtension(alignedPortrait);
  const portraitMetadata = await sharp(portraitWithBustBase).metadata();
  const portraitWidth = portraitMetadata.width ?? artWidth;
  const portraitHeight = portraitMetadata.height ?? artHeight;
  const portraitLeft = artLeft + Math.round((artWidth - portraitWidth) / 2);
  const portraitTop = Math.max(artTop, FINAL_HEIGHT - portraitHeight + PORTRAIT_BOTTOM_BLEED);

  const posterBackground = Buffer.from(`
    <svg width="${FINAL_WIDTH}" height="${FINAL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${FINAL_WIDTH}" height="${FINAL_HEIGHT}" fill="${background.fill}"/>
    </svg>
  `);

  const titleSafeBand = Buffer.from(`
    <svg width="${FINAL_WIDTH}" height="${FINAL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${FINAL_WIDTH}" height="${TITLE_SAFE_HEIGHT}" fill="${background.fill}"/>
    </svg>
  `);
  const firstLineOverlay = await createTitleTextLayer(
    title.firstLine,
    title.fontSize,
    FINAL_WIDTH - 180,
    title.secondLine ? 170 : 200,
    titleFont.previewColor,
    fontStyle
  );
  const secondLineOverlay = title.secondLine
    ? await createTitleTextLayer(
        title.secondLine,
        title.secondLineFontSize,
        FINAL_WIDTH - 180,
        170,
        titleFont.previewColor,
        fontStyle
      )
    : null;

  return sharp({
    create: {
      width: FINAL_WIDTH,
      height: FINAL_HEIGHT,
      channels: 4,
      background: background.fill
    }
  })
    .composite([
      { input: posterBackground },
      { input: portraitWithBustBase, left: portraitLeft, top: portraitTop },
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
      `Create only the pet portrait asset. The app will build the final poster layout separately.`,
      "",
      "CRITICAL - EXACT PET LIKENESS:",
      "Use the provided photo as a strict visual reference.",
      "The pet must remain immediately recognizable as the same individual.",
      "Do not reinterpret, beautify, cartoonize, simplify away, or generalize the pet.",
      "",
      "Preserve exact identity with high fidelity, including:",
      "- exact face shape and skull proportions",
      "- eye shape, size, spacing, tilt, and color",
      "- nose shape, size, placement, and nostril structure",
      "- muzzle length, width, and contour",
      "- ear shape, angle, and position",
      "- exact fur markings, asymmetry, patch placement, and color transitions",
      "- all unique identifying details, even if small or subtle",
      "",
      "IMPORTANT DETAIL PRESERVATION:",
      "Do NOT remove, smooth out, simplify away, or merge small markings that help identify the pet.",
      "Preserve fine visible details such as:",
      "- white or lighter highlight hairs on the nose or muzzle",
      "- tiny fur streaks or blaze markings",
      "- eyebrow spots",
      "- chin and lip color variation",
      "- whisker pad highlights",
      "- small patches of lighter or darker fur",
      "- subtle contrast areas around the snout, eyes, and forehead",
      "- distinctive fur edges and transitions",
      "If a marking is visible in the source photo, it should still be visible in the final portrait.",
      "",
      "CROP / FRAMING (VERY IMPORTANT):",
      "The pet should be shown as a centered bust portrait only.",
      "Always compose as a frontal or slight three-quarter FRONTAL bust shot.",
      "The entire head must be fully visible, including BOTH ear tips with comfortable margin around them.",
      "The full upper chest / shoulders must be visible within the canvas, and the chest should feel broad and connected.",
      "Do NOT crop off ear tips, head sides, or shoulder edges.",
      "Do NOT zoom out to include the full body, legs, paws, or too much torso.",
      "The head should be large and prominent in frame, but still fully contained inside the canvas.",
      "The portrait should feel close, iconic, and symmetrical like a modern custom pet print.",
      "Leave comfortable empty space above the head so the app can place the pet name separately.",
      "The lower bust should flow downward as one connected chest shape, not as two thin side pieces with a hollow middle.",
      "Avoid a tapered V-shaped ending or separated body slivers at the bottom of the portrait.",
      "The lower fur mass should remain full and connected so the app can anchor the portrait cleanly to the bottom edge.",
      "The lower chest should stay simple, broad, and visually grounded.",
      "Do not invent extra lower-body anatomy, legs, paws, or tapered fur extensions below the chest.",
      "",
      "POSE:",
      "Use a calm frontal or slight three-quarter frontal angle based on the source image.",
      "Keep the pose simple, centered, and portrait-oriented.",
      "Do not exaggerate head tilt or alter the pet's natural expression.",
      "",
      "STYLE:",
      "Render as a premium semi-realistic illustrated pet portrait for a modern Etsy-style print.",
      "The result should feel elegant, editorial, refined, and tastefully stylized rather than cartoony.",
      "Use clean shapes and controlled simplification, but keep natural anatomy, believable facial proportions, and true expression.",
      "Shading should be soft and restrained, with subtle tonal transitions rather than glossy cartoon airbrushing.",
      "Edges should be clean, but do not use thick mascot outlines, sticker-like contouring, or comic-book linework.",
      "This should feel like a polished custom portrait print, not a children's-book illustration, mascot logo, or exaggerated cartoon.",
      "Retain layered fur detail and clear feature definition in the eyes, nose, muzzle, forehead, and fur transitions.",
      "Do not flatten, over-smooth, or oversimplify important fur structure.",
      "",
      "DETAIL RENDERING:",
      "Increase detail in the following areas:",
      "- nose texture and highlight shapes",
      "- fur direction around the muzzle and forehead",
      "- eye rims and eye reflections",
      "- subtle fur separation around the cheeks and ears",
      "- small white, grey, tan, or rust markings",
      "- fur edge breakup where the coat is uneven or fluffy",
      "Maintain crisp readability of small contrast features.",
      "Preserve realistic depth in the face and muzzle so the portrait does not become flat, generic, or icon-like.",
      "",
      "COLOR ACCURACY (VERY IMPORTANT):",
      "Match the original photo's fur colors as closely as possible.",
      "Maintain true-to-photo tones, contrast, and value relationships.",
      "Avoid shifting the pet warmer, cooler, redder, yellower, greyer, or creamier than the source.",
      "Do NOT add sepia, beige, vintage warmth, golden cast, or washed-out pastel toning.",
      "Black fur should remain black or charcoal, not brown.",
      "White fur should remain neutral white or soft grey-white, not cream or yellow.",
      "Brown / tan / rust markings must stay accurate to the original image.",
      "",
      "OUTPUT FORMAT (VERY IMPORTANT):",
      "Return ONLY the pet portrait cutout on a transparent background.",
      "No poster template, no frame, no border, no background block, and no blank card area.",
      "The lower chest / fur can continue toward the bottom edge of the asset, but there must be no text or banner.",
      "The portrait asset should reach low enough that the app can place it flush to the bottom of the final poster.",
      "The bottom of the bust should stay visually full and connected, with enough chest and fur volume to fill the lower poster area cleanly.",
      "Keep the bust ending clean and natural, because the final poster composition will crop slightly into the lower portrait.",
      "Avoid narrow points, mirrored side slivers, or abstract shape formation at the bottom edge of the pet.",
      "",
      "STRICT NEGATIVE RULES:",
      "- no full body",
      "- no paws",
      "- no sitting pose",
      "- no collars",
      "- no tags",
      "- no props",
      "- no extra animals",
      "- no accessories",
      "- no text",
      "- no nameplate",
      "- no pet name anywhere in the image",
      "- no bottom label",
      "- no caption box",
      "- no white plaque",
      "- no poster border",
      "- no decorative elements",
      "- no exaggerated stylization",
      "- no mascot look",
      "- no sticker look",
      "- no children's-book illustration look",
      "- no thick black outline treatment",
      "- no overly glossy cartoon shading",
      "- no generic breed icon rendering",
      "- no generic dog-face simplification",
      "- no smoothing away small markings",
      "- no merging light and dark fur patches into larger simplified shapes",
      "",
      "OUTPUT GOAL:",
      "A polished, modern, premium transparent pet portrait asset with:",
      "- exact pet likeness",
      "- accurate fur color",
      "- preserved small identifying markings",
      "- clean head-and-chest composition",
      "- elegant semi-realistic illustrated print styling",
      "- transparent background ready for local poster composition",
      "- refined Etsy-ready illustration quality"
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

  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/images/edits",
    {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: form
    },
    OPENAI_RENDER_TIMEOUT_MS,
    `OpenAI image edit timed out for ${petName}`
  );

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
    const imageResponse = await fetchWithTimeout(
      image.url,
      undefined,
      OPENAI_IMAGE_DOWNLOAD_TIMEOUT_MS,
      `OpenAI image download timed out for ${petName}`
    );
    if (!imageResponse.ok) {
      throw new Error(`OpenAI returned an unreadable image URL: ${imageResponse.status}`);
    }

    return Buffer.from(await imageResponse.arrayBuffer());
  }

  throw new Error("OpenAI image edit returned no image data");
}

async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
  timeoutMessage: string
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(timeoutMessage);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function createFallbackPortrait(source: Buffer) {
  return sharp(source)
    .resize(1024, 1536, {
      fit: "contain",
      position: "attention",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .modulate({ saturation: 0.88, brightness: 1.08 })
    .linear([0.95, 0.98, 1.04, 1], [4, 4, 8, 0])
    .normalise()
    .png()
    .toBuffer();
}

function formatDisplayName(name: string, fontStyle: PosterFontStyle) {
  const trimmed = name.trim();
  if (!trimmed) {
    return fontStyle === "script" ? "Your Pet" : "YOUR PET";
  }

  const sanitized = trimmed
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "");

  return fontStyle === "script" ? toTitleCase(sanitized) : sanitized.toUpperCase();
}

function buildArtifactBaseName(name: string) {
  const safeName = formatDisplayName(name, "site")
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

function buildTitleLayout(name: string, fontStyle: PosterFontStyle) {
  const displayName = formatDisplayName(name, fontStyle);
  const words = displayName.split(/\s+/).filter(Boolean);
  const shouldSplit =
    words.length > 1 && displayName.length > (fontStyle === "script" ? 14 : 12);

  if (!shouldSplit) {
    return {
      firstLine: displayName,
      secondLine: "",
      fontSize:
        fontStyle === "script"
          ? displayName.length > 10
            ? 164
            : 178
          : displayName.length > 10
          ? 132
          : 148,
      secondLineFontSize: 0,
      firstLineTop: fontStyle === "script" ? 142 : 132,
      secondLineTop: 0
    };
  }

  const midpoint = Math.ceil(words.length / 2);
  const firstLine = words.slice(0, midpoint).join(" ");
  const secondLine = words.slice(midpoint).join(" ");

  return {
    firstLine,
    secondLine,
    fontSize: fontStyle === "script" ? 136 : 110,
    secondLineFontSize: fontStyle === "script" ? 136 : 110,
    firstLineTop: fontStyle === "script" ? 116 : 104,
    secondLineTop: fontStyle === "script" ? 254 : 228
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
  return path.join(process.cwd(), "assets", "fonts", "title.ttf");
}

function getScriptFontPath() {
  return path.join(process.cwd(), "assets", "fonts", "script.ttf");
}

async function createTitleTextLayer(
  text: string,
  fontSize: number,
  width: number,
  height: number,
  color: string,
  fontStyle: PosterFontStyle
) {
  const rendered = await sharp({
    text: {
      text: `<span foreground="${color}">${escapePangoText(text)}</span>`,
      font: `${fontStyle === "script" ? "PosterScript" : "Title"} ${fontSize}px`,
      fontfile: fontStyle === "script" ? getScriptFontPath() : getTitleFontPath(),
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

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

async function preparePortraitForComposition(source: Buffer) {
  const metadata = await sharp(source).metadata();
  const bannerTrimmed = await cropBottomBanner(source);
  const hasTransparentAlpha = await hasTransparentPixels(source);

  if (hasTransparentAlpha) {
    return bannerTrimmed;
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const safeSource =
    width && height
      ? await sharp(bannerTrimmed)
          .extract({
            left: 0,
            top: 0,
            width,
            height
          })
          .png()
          .toBuffer()
      : bannerTrimmed;

  return removeFlatBackground(safeSource);
}

async function hasTransparentPixels(source: Buffer) {
  const image = sharp(source);
  const metadata = await image.metadata();
  if (!metadata.hasAlpha) {
    return false;
  }

  const stats = await image.stats();
  const alpha = stats.channels[3];
  return (alpha?.min ?? 255) < 250;
}

async function removeFlatBackground(source: Buffer) {
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const background = sampleCornerColor(data, info.width, info.height, info.channels);
  const output = Buffer.from(data);

  for (let index = 0; index < output.length; index += info.channels) {
    const distance = colorDistance(
      output[index] ?? 0,
      output[index + 1] ?? 0,
      output[index + 2] ?? 0,
      background.r,
      background.g,
      background.b
    );

    if (distance < 42) {
      output[index + 3] = 0;
    }
  }

  return sharp(output, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  })
    .png()
    .toBuffer();
}

function sampleCornerColor(data: Buffer, width: number, height: number, channels: number) {
  const sampleSize = Math.max(8, Math.min(24, Math.floor(Math.min(width, height) / 12)));
  const corners = [
    { x: 0, y: 0 },
    { x: width - sampleSize, y: 0 },
    { x: 0, y: height - sampleSize },
    { x: width - sampleSize, y: height - sampleSize }
  ];

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (const corner of corners) {
    for (let y = corner.y; y < corner.y + sampleSize; y += 1) {
      for (let x = corner.x; x < corner.x + sampleSize; x += 1) {
        const index = (y * width + x) * channels;
        r += data[index] ?? 0;
        g += data[index + 1] ?? 0;
        b += data[index + 2] ?? 0;
        count += 1;
      }
    }
  }

  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count)
  };
}

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

async function cropBottomBanner(source: Buffer) {
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let cutRow = info.height;
  let solidRows = 0;

  for (let y = info.height - 1; y >= 0; y -= 1) {
    let opaque = 0;
    let light = 0;

    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * info.channels;
      const alpha = data[index + 3] ?? 0;
      if (alpha > 220) {
        opaque += 1;
        const brightness =
          ((data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0)) / 3;
        if (brightness > 210) {
          light += 1;
        }
      }
    }

    const opaqueRatio = opaque / info.width;
    const lightRatio = opaque > 0 ? light / opaque : 0;

    if (opaqueRatio > 0.52 && lightRatio > 0.55) {
      solidRows += 1;
      cutRow = y;
      continue;
    }

    if (solidRows >= 18) {
      break;
    }

    solidRows = 0;
    cutRow = info.height;
    break;
  }

  if (cutRow >= info.height) {
    return source;
  }

  return sharp(source)
    .extract({
      left: 0,
      top: 0,
      width: info.width,
      height: Math.max(1, cutRow)
    })
    .png()
    .toBuffer();
}

async function createBustBaseExtension(source: Buffer) {
  const metadata = await sharp(source).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (!width || !height || height < 320) {
    return source;
  }

  const lowerBandHeight = Math.max(220, Math.min(420, Math.round(height * 0.3)));
  const lowerBandTop = Math.max(0, height - lowerBandHeight);
  const lowerBand = await sharp(source)
    .extract({
      left: 0,
      top: lowerBandTop,
      width,
      height: lowerBandHeight
    })
    .resize(width, BUST_EXTENSION_HEIGHT, {
      fit: "fill",
      position: "top"
    })
    .blur(1.4)
    .modulate({
      brightness: 1.01,
      saturation: 0.97
    })
    .png()
    .toBuffer();

  const chestCropWidth = Math.max(220, Math.min(Math.round(width * 0.58), width));
  const chestCropLeft = Math.max(0, Math.round((width - chestCropWidth) / 2));
  const chestCropHeight = Math.max(220, Math.min(Math.round(height * 0.28), height));
  const chestCropTop = Math.max(0, height - chestCropHeight);
  const chestExtensionWidth = Math.round(width * 0.78);
  const chestExtension = await sharp(source)
    .extract({
      left: chestCropLeft,
      top: chestCropTop,
      width: chestCropWidth,
      height: chestCropHeight
    })
    .resize(chestExtensionWidth, BUST_EXTENSION_HEIGHT, {
      fit: "fill",
      position: "top"
    })
    .blur(1)
    .modulate({
      brightness: 1.02,
      saturation: 0.96
    })
    .png()
    .toBuffer();

  const lowerBandMask = Buffer.from(`
    <svg width="${width}" height="${BUST_EXTENSION_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="underFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="white" stop-opacity="0.4"/>
          <stop offset="18%" stop-color="white" stop-opacity="0.6"/>
          <stop offset="100%" stop-color="white" stop-opacity="0.72"/>
        </linearGradient>
      </defs>
      <ellipse
        cx="${Math.round(width * 0.5)}"
        cy="${Math.round(BUST_EXTENSION_HEIGHT * 0.62)}"
        rx="${Math.round(width * 0.46)}"
        ry="${Math.round(BUST_EXTENSION_HEIGHT * 0.5)}"
        fill="url(#underFade)"
      />
    </svg>
  `);

  const chestMask = Buffer.from(`
    <svg width="${chestExtensionWidth}" height="${BUST_EXTENSION_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="chestFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="white" stop-opacity="0.72"/>
          <stop offset="14%" stop-color="white" stop-opacity="0.94"/>
          <stop offset="100%" stop-color="white" stop-opacity="1"/>
        </linearGradient>
      </defs>
      <path
        d="M ${Math.round(chestExtensionWidth * 0.17)} ${Math.round(BUST_EXTENSION_HEIGHT * 0.06)}
           C ${Math.round(chestExtensionWidth * 0.07)} ${Math.round(BUST_EXTENSION_HEIGHT * 0.3)},
             ${Math.round(chestExtensionWidth * 0.05)} ${Math.round(BUST_EXTENSION_HEIGHT * 0.72)},
             ${Math.round(chestExtensionWidth * 0.23)} ${Math.round(BUST_EXTENSION_HEIGHT * 0.98)}
           C ${Math.round(chestExtensionWidth * 0.36)} ${Math.round(BUST_EXTENSION_HEIGHT * 1.03)},
             ${Math.round(chestExtensionWidth * 0.64)} ${Math.round(BUST_EXTENSION_HEIGHT * 1.03)},
             ${Math.round(chestExtensionWidth * 0.77)} ${Math.round(BUST_EXTENSION_HEIGHT * 0.98)}
           C ${Math.round(chestExtensionWidth * 0.95)} ${Math.round(BUST_EXTENSION_HEIGHT * 0.72)},
             ${Math.round(chestExtensionWidth * 0.93)} ${Math.round(BUST_EXTENSION_HEIGHT * 0.3)},
             ${Math.round(chestExtensionWidth * 0.83)} ${Math.round(BUST_EXTENSION_HEIGHT * 0.06)}
           C ${Math.round(chestExtensionWidth * 0.72)} ${Math.round(BUST_EXTENSION_HEIGHT * 0.01)},
             ${Math.round(chestExtensionWidth * 0.28)} ${Math.round(BUST_EXTENSION_HEIGHT * 0.01)},
             ${Math.round(chestExtensionWidth * 0.17)} ${Math.round(BUST_EXTENSION_HEIGHT * 0.06)} Z"
        fill="url(#chestFade)"
      />
    </svg>
  `);

  const featheredLowerBand = await sharp(lowerBand)
    .composite([{ input: lowerBandMask, blend: "dest-in" }])
    .png()
    .toBuffer();

  const featheredChestExtension = await sharp(chestExtension)
    .composite([{ input: chestMask, blend: "dest-in" }])
    .png()
    .toBuffer();

  const overlap = Math.round(lowerBandHeight * 0.6);
  const extendedHeight = height + BUST_EXTENSION_HEIGHT - overlap;
  const extensionTop = height - overlap;
  const chestLeft = Math.round((width - chestExtensionWidth) / 2);
  const chestTop = extensionTop + Math.round(BUST_EXTENSION_HEIGHT * 0.02);

  return sharp({
    create: {
      width,
      height: extendedHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([
      {
        input: featheredLowerBand,
        left: 0,
        top: extensionTop
      },
      {
        input: featheredChestExtension,
        left: chestLeft,
        top: chestTop
      },
      {
        input: source,
        left: 0,
        top: 0
      }
    ])
    .png()
    .toBuffer();
}
