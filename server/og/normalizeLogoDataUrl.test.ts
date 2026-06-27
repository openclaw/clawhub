import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeOgLogoDataUrl } from "./normalizeLogoDataUrl";

async function makeLogoDataUrl(padding: number) {
  const size = 96;
  const markSize = size - padding * 2;
  const buffer = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${markSize}" height="${markSize}" viewBox="0 0 ${markSize} ${markSize}" xmlns="http://www.w3.org/2000/svg"><circle cx="${markSize / 2}" cy="${markSize / 2}" r="${markSize / 2}" fill="#D4453A"/></svg>`,
        ),
        left: padding,
        top: padding,
      },
    ])
    .png()
    .toBuffer();
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function visibleAlphaBounds(dataUrl: string) {
  const buffer = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
  const image = sharp(buffer).ensureAlpha();
  const metadata = await image.metadata();
  const raw = await image.raw().toBuffer();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < (metadata.height ?? 0); y += 1) {
    for (let x = 0; x < (metadata.width ?? 0); x += 1) {
      const alpha = raw[(y * (metadata.width ?? 0) + x) * 4 + 3] ?? 0;
      if (alpha === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
}

describe("normalizeOgLogoDataUrl", () => {
  it("normalizes logos with different transparent padding to the same visible size", async () => {
    const paddedLogo = await normalizeOgLogoDataUrl(await makeLogoDataUrl(24));
    const tightLogo = await normalizeOgLogoDataUrl(await makeLogoDataUrl(4));
    expect(paddedLogo).toMatch(/^data:image\/png;base64,/);
    expect(tightLogo).toMatch(/^data:image\/png;base64,/);

    await expect(visibleAlphaBounds(paddedLogo ?? "")).resolves.toEqual({ width: 48, height: 48 });
    await expect(visibleAlphaBounds(tightLogo ?? "")).resolves.toEqual({ width: 48, height: 48 });
  });

  it("fails closed for non-image and invalid image data URLs", async () => {
    await expect(normalizeOgLogoDataUrl("data:text/plain;base64,SGVsbG8=")).resolves.toBeNull();
    await expect(normalizeOgLogoDataUrl("data:image/png;base64,bm90LWEtcG5n")).resolves.toBeNull();
  });

  it("fails closed for images above the input pixel cap", async () => {
    const oversizedImage = await sharp({
      create: {
        width: 2001,
        height: 2001,
        channels: 4,
        background: { r: 212, g: 69, b: 58, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    await expect(
      normalizeOgLogoDataUrl(`data:image/png;base64,${oversizedImage.toString("base64")}`),
    ).resolves.toBeNull();
  });
});
