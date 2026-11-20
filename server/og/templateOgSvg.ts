import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BlobsterIcon } from "../../src/components/BlobsterIcon";
import { escapeXml, wrapText } from "./registryOgSvg";

// The bundled static font files register these weight-specific family names in resvg.
const TITLE_FONT = "Bricolage Grotesque ExtraBold";
const COPY_FONT = "Bricolage Grotesque Medium";
const MONO_FONT = "IBM Plex Mono Medium";

type TemplateCard = {
  title: string;
  owner: string | null; // The directory card has no publisher.
  description: string;
  mark: string;
  artwork: string | null;
};

// Match the Template glyph in the catalog rather than implying a publisher avatar is its artwork.
const fallbackArtwork = renderToStaticMarkup(
  createElement(BlobsterIcon, {
    x: 861,
    y: 195,
    width: 212,
    height: 212,
    color: "#dda19a",
    strokeWidth: 1.15,
  }),
);

function lines(text: string[], x: number, firstY: number, step: number) {
  return text
    .map((line, i) => `<tspan x="${x}" y="${firstY + i * step}">${escapeXml(line)}</tspan>`)
    .join("");
}

export function buildTemplateOgSvg(card: TemplateCard) {
  // Keep short names oversized; give long names a third line before truncating.
  const title = card.title.slice(0, 256);
  const fullTitle = wrapText(title, 660, 104, 3);
  const size = fullTitle.length <= 2 ? 104 : 72;
  const titleLines = size === 104 ? fullTitle : wrapText(title, 660, size, 3);
  const step = Math.round(size * 0.94);
  const titleY = 149 + Math.round(size * 0.76);
  const ownerY = titleY + (titleLines.length - 1) * step + 58;
  const owner = card.owner === null ? null : "@" + card.owner;
  const byline = owner
    ? `<text x="74" y="${ownerY}" fill="#ddaaa6" font-family="${MONO_FONT},monospace" font-size="${Math.min(32, Math.floor(680 / (owner.length * 0.61)))}" font-weight="500" letter-spacing="-.8">${escapeXml(owner)}</text>`
    : "";
  const description = wrapText(card.description.slice(0, 1024), 710, 35, 3);
  const portrait = card.artwork
    ? `<image x="826" y="160" width="282" height="282" preserveAspectRatio="xMidYMid meet" href="${card.artwork}"/>`
    : fallbackArtwork;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="base" x2="1" y2="0.28" gradientUnits="objectBoundingBox"><stop stop-color="#170d10"/><stop offset=".58" stop-color="#090a0b"/><stop offset="1" stop-color="#09120f"/></linearGradient>
    <radialGradient id="warm" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1032 139) scale(645 308)"><stop stop-color="#462023" stop-opacity=".5"/><stop offset="1" stop-color="#462023" stop-opacity="0"/></radialGradient>
    <radialGradient id="cool" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(120 643) scale(640 382)"><stop stop-color="#0d4235" stop-opacity=".29"/><stop offset="1" stop-color="#0d4235" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#base)"/><rect width="1200" height="630" fill="url(#cool)"/><rect width="1200" height="630" fill="url(#warm)"/>
  <image x="70" y="58" width="50" height="50" href="${card.mark}"/>
  <g font-family="${MONO_FONT},monospace" font-size="26" font-weight="500" fill="#ff756d"><text x="136" y="93">ClawHub</text><text x="261" y="93" fill="#925950">/</text><text x="293" y="93">${owner ? "Template" : "Templates"}</text></g>
  <text fill="#f7f1ea" font-family="${TITLE_FONT},sans-serif" font-size="${size}" font-weight="800" letter-spacing="${-size * 0.053}">${lines(titleLines, 70, titleY, step)}</text>
  ${byline}
  <text fill="#c9c2bd" font-family="${COPY_FONT},sans-serif" font-size="35" font-weight="500" letter-spacing="-.65">${lines(description, 74, ownerY + (owner ? 94 : 36), 42)}</text>
  ${portrait}
</svg>`;
}
