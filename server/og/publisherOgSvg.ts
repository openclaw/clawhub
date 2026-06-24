import { FONT_SANS } from "./ogAssets";
import {
  escapeXml,
  OPENCLAW_RED,
  type RegistryOgStat,
  statLabelMarkup,
  wrapText,
} from "./registryOgSvg";

export type PublisherOgSvgParams = {
  markDataUrl: string;
  watermarkDataUrl?: string | null;
  avatarDataUrl?: string | null;
  avatarShape?: "circle" | "rounded";
  title: string;
  description: string;
  handleLabel: string;
  stats?: RegistryOgStat[];
};

function statBlock(stats: RegistryOgStat[] | undefined, x: number, y: number) {
  const stat = stats?.[0] ?? { value: "ClawHub", label: "Publisher" };
  return `<g>
    ${statLabelMarkup(x, y, stat.label, { fontSize: 22 })}
    <text x="${x}" y="${y + 44}"
      fill="#F7F1EA"
      font-size="44"
      font-weight="800"
      font-family="${FONT_SANS}, sans-serif">${escapeXml(stat.value)}</text>
  </g>`;
}

export function buildPublisherOgSvg(params: PublisherOgSvgParams) {
  const rawTitle = params.title.trim() || params.handleLabel;
  const rawDescription = params.description.trim() || "Publisher on ClawHub.";
  const avatar = params.avatarDataUrl || params.markDataUrl;
  const watermark = params.watermarkDataUrl || params.markDataUrl;
  const avatarShape = params.avatarShape ?? "circle";
  const contentX = 430;
  const contentWidth = 650;
  const titleLines = wrapText(rawTitle, contentWidth, 72, 2);
  const titleFontSize = titleLines.length > 1 ? 62 : 72;
  const normalizedTitleLines = wrapText(rawTitle, contentWidth, titleFontSize, 2);
  const descriptionLines = wrapText(rawDescription, contentWidth, 30, 2);
  const titleTspans = normalizedTitleLines
    .map(
      (line, index) =>
        `<tspan x="${contentX}" dy="${index === 0 ? 0 : 70}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  const descriptionTspans = descriptionLines
    .map(
      (line, index) =>
        `<tspan x="${contentX}" dy="${index === 0 ? 0 : 40}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  const descriptionY = normalizedTitleLines.length > 1 ? 354 : 340;
  const statsY = descriptionY + descriptionLines.length * 40 + 34;
  const avatarFrame =
    avatarShape === "circle"
      ? `<circle cx="211" cy="305" r="139" fill="#FFFFFF" fill-opacity="0.055" stroke="#FFFFFF" stroke-opacity="0.16"/>
      <image href="${avatar}" x="49" y="143" width="324" height="324" clip-path="url(#publisherAvatarCircleClip)" preserveAspectRatio="xMidYMid slice"/>
      <circle cx="211" cy="305" r="139" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="1.5"/>`
      : `<rect x="71" y="165" width="280" height="280" rx="58" fill="#FFFFFF" fill-opacity="0.055" stroke="#FFFFFF" stroke-opacity="0.16"/>
      <image href="${avatar}" x="49" y="143" width="324" height="324" clip-path="url(#publisherAvatarRoundedClip)" preserveAspectRatio="xMidYMid slice"/>
      <rect x="71.75" y="165.75" width="278.5" height="278.5" rx="57.25" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="1.5"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgBase" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop stop-color="#12090A"/>
      <stop offset="0.46" stop-color="#08090A"/>
      <stop offset="1" stop-color="#07100E"/>
    </linearGradient>
    <radialGradient id="bgAccent" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1064 78) rotate(152) scale(520 260)">
      <stop stop-color="${OPENCLAW_RED}" stop-opacity="0.17"/>
      <stop offset="1" stop-color="${OPENCLAW_RED}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bgDepth" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(178 590) rotate(-18) scale(600 250)">
      <stop stop-color="#0D7A67" stop-opacity="0.13"/>
      <stop offset="1" stop-color="#0D7A67" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bgCorner" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(96 84) rotate(24) scale(440 240)">
      <stop stop-color="#7F1D2D" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#6C1B2B" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="publisherAvatarCircleClip">
      <circle cx="211" cy="305" r="139"/>
    </clipPath>
    <clipPath id="publisherAvatarRoundedClip">
      <rect x="71" y="165" width="280" height="280" rx="58"/>
    </clipPath>
  </defs>

  <rect width="1200" height="630" fill="url(#bgBase)"/>
  <rect width="1200" height="630" fill="url(#bgAccent)"/>
  <rect width="1200" height="630" fill="url(#bgDepth)"/>
  <rect width="1200" height="630" fill="url(#bgCorner)"/>
  <g>
    <image href="${watermark}" x="905" y="365" width="430" height="430" opacity="0.035" preserveAspectRatio="xMidYMid meet"/>
    <g>${avatarFrame}</g>

    <g>
      <image href="${params.markDataUrl}" x="958" y="34" width="44" height="44" opacity="0.92" preserveAspectRatio="xMidYMid meet"/>
      <text x="1016" y="66"
        fill="#F7F1EA"
        font-size="28"
        font-weight="800"
        font-family="${FONT_SANS}, sans-serif">ClawHub</text>
    </g>

    <text x="${contentX}" y="132"
      fill="${OPENCLAW_RED}"
      font-size="25"
      font-weight="800"
      font-family="${FONT_SANS}, sans-serif">${escapeXml(params.handleLabel)} / Publisher</text>

    <text x="${contentX}" y="${normalizedTitleLines.length > 1 ? 216 : 248}"
      fill="#F7F1EA"
      font-size="${titleFontSize}"
      font-weight="800"
      font-family="${FONT_SANS}, sans-serif">${titleTspans}</text>

    <text x="${contentX}" y="${descriptionY}"
      fill="#B9B0AA"
      font-size="30"
      font-weight="500"
      font-family="${FONT_SANS}, sans-serif">${descriptionTspans}</text>

    ${statBlock(params.stats, contentX, statsY)}
  </g>
</svg>`;
}
