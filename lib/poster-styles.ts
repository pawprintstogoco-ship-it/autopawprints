export const POSTER_FONT_STYLES = ["site", "script"] as const;
export const POSTER_BACKGROUND_STYLES = [
  "offWhite",
  "sage",
  "sky",
  "slate",
  "beige",
  "pink"
] as const;

export type PosterFontStyle = (typeof POSTER_FONT_STYLES)[number];
export type PosterBackgroundStyle = (typeof POSTER_BACKGROUND_STYLES)[number];

export const DEFAULT_POSTER_FONT_STYLE: PosterFontStyle = "site";
export const DEFAULT_POSTER_BACKGROUND_STYLE: PosterBackgroundStyle = "offWhite";

export const POSTER_FONT_OPTIONS: Array<{
  id: PosterFontStyle;
  label: string;
  description: string;
  previewFamily: string;
  previewColor: string;
}> = [
  {
    id: "site",
    label: "Classic",
    description: "Clean and modern.",
    previewFamily: "var(--font-poster-title), var(--font-display), serif",
    previewColor: "#4a3727"
  },
  {
    id: "script",
    label: "Script",
    description: "Confident and elegant.",
    previewFamily: "var(--font-poster-script), cursive",
    previewColor: "#1f1813"
  }
];

export const POSTER_BACKGROUND_OPTIONS: Array<{
  id: PosterBackgroundStyle;
  label: string;
  fill: string;
  accent: string;
}> = [
  { id: "offWhite", label: "Off-white", fill: "#f7f1e8", accent: "#d8cbb8" },
  { id: "sage", label: "Sage green", fill: "#d9e2d3", accent: "#a8b8a0" },
  { id: "sky", label: "Sky blue", fill: "#dceaf4", accent: "#adc8dc" },
  { id: "slate", label: "Slate grey", fill: "#d9dde2", accent: "#a4adb8" },
  { id: "beige", label: "Beige", fill: "#eadccf", accent: "#ceb59d" },
  { id: "pink", label: "Pink", fill: "#f3d8df", accent: "#e0aeb9" }
];

export function isPosterFontStyle(value: string): value is PosterFontStyle {
  return POSTER_FONT_STYLES.includes(value as PosterFontStyle);
}

export function isPosterBackgroundStyle(value: string): value is PosterBackgroundStyle {
  return POSTER_BACKGROUND_STYLES.includes(value as PosterBackgroundStyle);
}

export function parsePosterFontStyle(value: unknown): PosterFontStyle {
  const normalized = String(value ?? DEFAULT_POSTER_FONT_STYLE);
  if (isPosterFontStyle(normalized)) {
    return normalized;
  }

  throw new Error("Please choose one of the available font styles.");
}

export function parsePosterBackgroundStyle(value: unknown): PosterBackgroundStyle {
  const normalized = String(value ?? DEFAULT_POSTER_BACKGROUND_STYLE);
  if (isPosterBackgroundStyle(normalized)) {
    return normalized;
  }

  throw new Error("Please choose one of the available background colours.");
}

export function getPosterFontOption(style: PosterFontStyle) {
  return POSTER_FONT_OPTIONS.find((option) => option.id === style) ?? POSTER_FONT_OPTIONS[0];
}

export function getPosterBackgroundOption(style: PosterBackgroundStyle) {
  return (
    POSTER_BACKGROUND_OPTIONS.find((option) => option.id === style) ??
    POSTER_BACKGROUND_OPTIONS[0]
  );
}

export function posterFontStyleToDb(style: PosterFontStyle) {
  return style === "script" ? "SCRIPT" : "SITE";
}

export function posterBackgroundStyleToDb(style: PosterBackgroundStyle) {
  switch (style) {
    case "sage":
      return "SAGE";
    case "sky":
      return "SKY";
    case "slate":
      return "SLATE";
    case "beige":
      return "BEIGE";
    case "pink":
      return "PINK";
    default:
      return "OFF_WHITE";
  }
}

export function posterFontStyleFromDb(value: unknown): PosterFontStyle {
  return String(value) === "SCRIPT" ? "script" : "site";
}

export function posterBackgroundStyleFromDb(value: unknown): PosterBackgroundStyle {
  switch (String(value)) {
    case "SAGE":
      return "sage";
    case "SKY":
      return "sky";
    case "SLATE":
      return "slate";
    case "BEIGE":
      return "beige";
    case "PINK":
      return "pink";
    default:
      return "offWhite";
  }
}
