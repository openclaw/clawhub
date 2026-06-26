import sharp from "sharp";

const NORMALIZED_LOGO_SIZE = 48;

function readDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

export async function normalizeOgLogoDataUrl(dataUrl: string | null | undefined) {
  if (!dataUrl) return null;
  const parsed = readDataUrl(dataUrl);
  if (!parsed || !parsed.mimeType.startsWith("image/")) return dataUrl;

  try {
    const normalized = await sharp(parsed.buffer)
      .ensureAlpha()
      .trim({ threshold: 8 })
      .resize(NORMALIZED_LOGO_SIZE, NORMALIZED_LOGO_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();
    return `data:image/png;base64,${normalized.toString("base64")}`;
  } catch {
    return dataUrl;
  }
}
