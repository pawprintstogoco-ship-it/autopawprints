import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  analyzePosterComposition,
  buildTitleLayout,
  calculatePortraitVisualCenterOffset,
  calculatePosterCompositionCorrections,
  cleanPortraitOuterContour,
  getPosterLayoutConfig
} from "../lib/render";

describe("render layout", () => {
  it("places short single-line names in the upper third title band", () => {
    const layout = getPosterLayoutConfig();
    const title = buildTitleLayout("Zoey", "site");

    expect(title.firstLine).toBe("ZOEY");
    expect(title.secondLine).toBe("");
    expect(title.firstLineTop).toBeGreaterThanOrEqual(layout.titleBandTop);
    expect(title.firstLineTop + title.fontSize).toBeLessThan(layout.titleSafeHeight);
    expect(title.firstLineTop + title.fontSize / 2).toBeLessThan(layout.finalHeight / 3);
  });

  it("keeps the portrait area anchored into the bottom crop", () => {
    const layout = getPosterLayoutConfig();

    expect(layout.finalWidth).toBe(1800);
    expect(layout.finalHeight).toBe(2400);
    expect(layout.portraitAreaTop).toBeGreaterThanOrEqual(layout.titleSafeHeight);
    expect(layout.portraitAreaTop + layout.portraitAreaHeight).toBeGreaterThan(
      layout.finalHeight
    );
    expect(layout.portraitBottomBleed).toBeGreaterThan(0);
  });

  it("calculates a bounded visual center correction for off-balance portrait mass", async () => {
    const width = 120;
    const height = 160;
    const channels = 4;
    const data = Buffer.alloc(width * height * channels);

    for (let y = 20; y < 120; y += 1) {
      for (let x = 55; x < 105; x += 1) {
        const index = (y * width + x) * channels;

        data[index] = 180;
        data[index + 1] = 140;
        data[index + 2] = 90;
        data[index + 3] = 255;
      }
    }

    const source = await sharp(data, {
      raw: {
        width,
        height,
        channels
      }
    })
      .png()
      .toBuffer();

    expect(await calculatePortraitVisualCenterOffset(source)).toBeGreaterThan(0);
  });

  it("reports composition QA and recommends a bounded pet centering correction", async () => {
    const background = "#fbf6f1";
    const poster = await sharp(
      Buffer.from(`
        <svg width="1800" height="2400" xmlns="http://www.w3.org/2000/svg">
          <rect width="1800" height="2400" fill="${background}"/>
          <rect x="760" y="220" width="280" height="100" fill="#4c382b"/>
          <rect x="760" y="660" width="780" height="1740" fill="#c9964d"/>
          <rect x="1000" y="1200" width="300" height="260" fill="#3d2f27"/>
        </svg>
      `)
    )
      .png()
      .toBuffer();

    const report = await analyzePosterComposition(poster, background);
    const corrections = calculatePosterCompositionCorrections(report);

    expect(Math.abs(report.titleCenterDeltaPx ?? 0)).toBeLessThan(1);
    expect(report.petVisualCenterDeltaPx ?? 0).toBeGreaterThan(18);
    expect(report.bottomContact).toBe(true);
    expect(report.warnings).toContain("pet_visual_center_off");
    expect(corrections.portraitOffsetX).toBeLessThan(0);
  });
});

describe("portrait contour cleanup", () => {
  it("attenuates dark artificial outer contour pixels without changing interior markings", async () => {
    const width = 7;
    const height = 7;
    const channels = 4;
    const data = Buffer.alloc(width * height * channels);

    for (let y = 1; y <= 5; y += 1) {
      for (let x = 1; x <= 5; x += 1) {
        const index = (y * width + x) * channels;
        const isOuterRing = x === 1 || x === 5 || y === 1 || y === 5;
        const isInteriorMarking = x === 3 && y === 3;
        const color = isOuterRing || isInteriorMarking ? 18 : 178;

        data[index] = color;
        data[index + 1] = color;
        data[index + 2] = color;
        data[index + 3] = 255;
      }
    }

    const source = await sharp(data, {
      raw: {
        width,
        height,
        channels
      }
    })
      .png()
      .toBuffer();
    const cleaned = await cleanPortraitOuterContour(source);
    const { data: cleanedData, info } = await sharp(cleaned)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const alphaAt = (x: number, y: number) => {
      return cleanedData[(y * info.width + x) * info.channels + 3] ?? 0;
    };

    expect(alphaAt(1, 1)).toBeLessThan(80);
    expect(alphaAt(3, 3)).toBe(255);
    expect(alphaAt(3, 2)).toBe(255);
  });
});
