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
    "node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2",
  ].map((path) => readFile(path)),
);
await initWasm(await readFile("node_modules/@resvg/resvg-wasm/index_bg.wasm"));

function escapeXml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// Share clients commonly shrink this to roughly 360px wide. Use deliberate
// line breaks so the subtitle remains 15px at that size, not 8px fine print.
const titleLines = ["Tools for", "your agents"];
const descriptionLines = ["Discover skills and plugins", "from top creators"];
if (titleLines.join(" ") !== SITE_TAGLINE || descriptionLines.join(" ") !== SITE_DESCRIPTION) {
  throw new Error("Update the social image line breaks to match the current site copy.");
}

const source = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="readability" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.25" />
      <stop offset="0.2" stop-color="#000" stop-opacity="0.6" />
      <stop offset="0.85" stop-color="#000" stop-opacity="0.6" />
      <stop offset="1" stop-color="#000" stop-opacity="0.25" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="#08090a" />
  <image href="data:image/png;base64,${background.toString("base64")}" width="1200" height="630" preserveAspectRatio="xMidYMid slice" />
  <rect width="1200" height="630" fill="url(#readability)" />
  <g text-anchor="middle" fill="#f5654a" font-family="IBM Plex Mono" font-size="136" font-weight="700" letter-spacing="-2">
    ${titleLines.map((line, index) => `<text x="600" y="${230 + index * 135}">${escapeXml(line)}</text>`).join("\n")}
  </g>
  <g text-anchor="middle" fill="#f3f3f3" font-family="Bricolage Grotesque 96pt ExtraBold" font-size="50" font-weight="700">
    ${descriptionLines.map((line, index) => `<text x="600" y="${464 + index * 61}">${escapeXml(line)}</text>`).join("\n")}
  </g>
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
