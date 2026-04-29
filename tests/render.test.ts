import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  buildTitleLayout,
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
