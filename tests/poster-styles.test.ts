import { describe, expect, it } from "vitest";
import {
  getPosterBackgroundOption,
  getPosterFontOption,
  parsePosterBackgroundStyle,
  parsePosterFontStyle,
  posterBackgroundStyleFromDb,
  posterBackgroundStyleToDb,
  posterFontStyleFromDb,
  posterFontStyleToDb
} from "../lib/poster-styles";

describe("poster styles", () => {
  it("parses valid upload selections", () => {
    expect(parsePosterFontStyle("site")).toBe("site");
    expect(parsePosterFontStyle("script")).toBe("script");
    expect(parsePosterBackgroundStyle("pink")).toBe("pink");
    expect(parsePosterBackgroundStyle("sage")).toBe("sage");
  });

  it("rejects invalid upload selections", () => {
    expect(() => parsePosterFontStyle("serif")).toThrow(/font styles/i);
    expect(() => parsePosterBackgroundStyle("orange")).toThrow(/background/i);
  });

  it("maps style selections to database-safe values", () => {
    expect(posterFontStyleToDb("site")).toBe("SITE");
    expect(posterFontStyleToDb("script")).toBe("SCRIPT");
    expect(posterBackgroundStyleToDb("offWhite")).toBe("OFF_WHITE");
    expect(posterBackgroundStyleToDb("pink")).toBe("PINK");
  });

  it("maps database values back to poster styles", () => {
    expect(posterFontStyleFromDb("SITE")).toBe("site");
    expect(posterFontStyleFromDb("SCRIPT")).toBe("script");
    expect(posterBackgroundStyleFromDb("OFF_WHITE")).toBe("offWhite");
    expect(posterBackgroundStyleFromDb("PINK")).toBe("pink");
  });

  it("exposes preview metadata for the form and renderer", () => {
    expect(getPosterFontOption("script").previewColor).toMatch(/^#/);
    expect(getPosterBackgroundOption("sky")).toMatchObject({
      label: "Sky blue",
      fill: expect.stringMatching(/^#/)
    });
  });
});
