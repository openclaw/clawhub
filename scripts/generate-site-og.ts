import { readFile, writeFile } from "node:fs/promises";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import sharp from "sharp";
import { SITE_DESCRIPTION, SITE_TAGLINE } from "../src/lib/site";

// Regenerate both shipped assets together: bun scripts/generate-site-og.ts.
// Reuse the homepage artwork within ClawHub, rather than a screenshot.
const background = await sharp("public/home-hero-claw.webp").png().toBuffer();
const fontBuffers = await Promise.all(
  [
    "node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2",
    "node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-500-normal.woff2",
  ].map((path) => readFile(path)),
);
await initWasm(await readFile("node_modules/@resvg/resvg-wasm/index_bg.wasm"));

function escapeXml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const source = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#08090a" />
  <image href="data:image/png;base64,${background.toString("base64")}" width="1200" height="630" preserveAspectRatio="xMidYMid slice" />
  <rect width="1200" height="630" fill="#000" opacity="0.25" />
  <text x="600" y="300" text-anchor="middle" fill="#f5654a" font-family="IBM Plex Mono" font-size="76" font-weight="700" letter-spacing="-2">${escapeXml(SITE_TAGLINE)}</text>
  <text x="600" y="368" text-anchor="middle" fill="#ccc" font-family="Bricolage Grotesque 96pt ExtraBold" font-size="28" font-weight="500">${escapeXml(SITE_DESCRIPTION)}</text>
</svg>`;
const renderer = new Resvg(source, { font: { fontBuffers } });
// Outline the type and embed the art so both assets render without local fonts
// or relative images, including when a crawler fetches the SVG directly.
const svg = renderer
  .toString()
  .replace(
    /(<svg[^>]*>)/,
    `$1<title>${escapeXml(SITE_TAGLINE)}</title><desc>${escapeXml(SITE_DESCRIPTION)}</desc>`,
  );
await writeFile("public/og.svg", svg);
await writeFile("public/og.png", renderer.render().asPng());
renderer.free();
