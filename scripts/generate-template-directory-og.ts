import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Resvg } from "@resvg/resvg-wasm";
import sharp from "sharp";
import { ensureResvgWasm, getFontBuffers, getMarkDataUrl } from "../server/og/ogAssets";
import { buildTemplateOgSvg } from "../server/og/templateOgSvg";
import { TEMPLATE_DIRECTORY_SHARE } from "../src/lib/templateShare";

// Regenerate offline: bun scripts/generate-template-directory-og.ts
// Unmodified official static Molty: openclaw/carapace@6c38d2a, preview/assets/openclaw-favicon.svg.
// Its preview/assets/RIGHTS.md attributes this original OpenClaw artwork to Vyctor Brzezowski.
const mascot = await sharp("scripts/assets/openclaw-mascot.svg", { density: 288 })
  .resize(282, 282)
  .png()
  .toBuffer();
await ensureResvgWasm();
const source = buildTemplateOgSvg({
  ...TEMPLATE_DIRECTORY_SHARE,
  owner: null,
  artwork: "data:image/png;base64," + mascot.toString("base64"),
  mark: await getMarkDataUrl(),
});
const renderer = new Resvg(source, { font: { fontBuffers: await getFontBuffers() } });
try {
  const png = renderer.render();
  try {
    const path = "public" + TEMPLATE_DIRECTORY_SHARE.imagePath;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, png.asPng());
  } finally {
    png.free();
  }
} finally {
  renderer.free();
}
