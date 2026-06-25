import { FONT_SANS } from "./ogAssets";
import { escapeXml, OPENCLAW_RED, type RegistryOgStat } from "./registryOgSvg";

export type PublisherOgSvgParams = {
  markDataUrl: string;
  watermarkDataUrl?: string | null;
  avatarDataUrl?: string | null;
  avatarShape?: "circle" | "rounded";
  official?: boolean;
  title: string;
  description: string;
  handleLabel: string;
  organizationLogos?: string[];
  stats?: RegistryOgStat[];
};

const OFFICIAL_BLUE = "#60A5FA";
const OFFICIAL_BADGE_SIZE = 42;
const OFFICIAL_BADGE_STROKE = 1.71;

function estimateTextWidth(value: string, fontSize: number) {
  return [...value].reduce((width, char) => {
    if (char === " ") return width + fontSize * 0.28;
    if (/[ilI.,:;|!'"`]/.test(char)) return width + fontSize * 0.28;
    if (/[mwMW@%&]/.test(char)) return width + fontSize * 0.9;
    if (/[A-Z]/.test(char)) return width + fontSize * 0.68;
    if (/[0-9]/.test(char)) return width + fontSize * 0.6;
    return width + fontSize * 0.56;
  }, 0);
}

function estimateBadgeX(
  value: string,
  x: number,
  fontSize: number,
  maxX: number,
  estimateScale: number,
) {
  const estimatedWidth = estimateTextWidth(value, fontSize) * estimateScale;
  return Math.min(maxX, Math.round(x + estimatedWidth + 19));
}

function officialBadge(x: number, y: number) {
  return `<svg x="${x}" y="${y}" width="${OFFICIAL_BADGE_SIZE}" height="${OFFICIAL_BADGE_SIZE}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" stroke="${OFFICIAL_BLUE}" stroke-width="${OFFICIAL_BADGE_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="m9 12 2 2 4-4" stroke="${OFFICIAL_BLUE}" stroke-width="${OFFICIAL_BADGE_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function wrapTextWithoutEllipsis(value: string, maxWidth: number, fontSize: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  function splitLongWord(word: string) {
    if (estimateTextWidth(word, fontSize) <= maxWidth) return [word];
    const parts: string[] = [];
    let chunk = "";
    for (const char of word) {
      const next = chunk + char;
      if (chunk && estimateTextWidth(next, fontSize) > maxWidth) {
        parts.push(chunk);
        chunk = char;
        continue;
      }
      chunk = next;
    }
    if (chunk) parts.push(chunk);
    return parts;
  }

  const tokens = words.flatMap((word, wordIndex) =>
    splitLongWord(word).map((part, partIndex) => ({
      text: part,
      needsLeadingSpace: wordIndex > 0 && partIndex === 0,
    })),
  );

  for (const token of tokens) {
    const separator = current && token.needsLeadingSpace ? " " : "";
    const next = current ? `${current}${separator}${token.text}` : token.text;
    if (estimateTextWidth(next, fontSize) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = token.text;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [value.trim()];
}

function fitMultilineText(
  value: string,
  maxWidth: number,
  maxLines: number,
  options: { maxFontSize: number; minFontSize: number },
) {
  for (let fontSize = options.maxFontSize; fontSize >= options.minFontSize; fontSize -= 2) {
    const lines = wrapTextWithoutEllipsis(value, maxWidth, fontSize);
    if (lines.length <= maxLines) {
      return { fontSize, lines };
    }
  }
  const fontSize = options.minFontSize;
  return { fontSize, lines: wrapTextWithoutEllipsis(value, maxWidth, fontSize) };
}

function fitMultilineTextWithDots(
  value: string,
  maxWidth: number,
  maxLines: number,
  fontSize: number,
) {
  const wrappedLines = wrapTextWithoutEllipsis(value, maxWidth, fontSize);
  if (wrappedLines.length <= maxLines) return { fontSize, lines: wrappedLines };
  const visibleLines = wrappedLines.slice(0, maxLines - 1);
  const hiddenText = wrappedLines.slice(maxLines - 1).join(" ");
  return {
    fontSize,
    lines: [...visibleLines, truncateWithDots(hiddenText, maxWidth, fontSize)],
  };
}

function fitSingleLineText(
  value: string,
  maxWidth: number,
  maxFontSize: number,
  minFontSize: number,
) {
  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 1) {
    if (estimateTextWidth(value, fontSize) <= maxWidth) return fontSize;
  }
  const estimatedAtMin = estimateTextWidth(value, minFontSize);
  if (estimatedAtMin <= maxWidth) return minFontSize;
  return Math.max(10, Math.floor((minFontSize * maxWidth) / Math.max(estimatedAtMin, 1)));
}

function truncateWithDots(value: string, maxWidth: number, fontSize: number) {
  if (estimateTextWidth(value, fontSize) <= maxWidth) return value;
  const dots = "...";
  const dotsWidth = estimateTextWidth(dots, fontSize);
  const chars = [...value];
  while (chars.length > 0 && estimateTextWidth(chars.join(""), fontSize) + dotsWidth > maxWidth) {
    chars.pop();
  }
  return `${chars.join("").trimEnd()}${dots}`;
}

function statColumn(
  label: string,
  value: string,
  x: number,
  y: number,
  valueMaxWidth: number,
  options?: { truncateWithDots?: boolean },
) {
  const valueFontSize = options?.truncateWithDots
    ? 46
    : fitSingleLineText(value, valueMaxWidth, 46, 18);
  const displayValue =
    options?.truncateWithDots && estimateTextWidth(value, valueFontSize) > valueMaxWidth
      ? truncateWithDots(value, valueMaxWidth, valueFontSize)
      : value;
  return `<g>
    <text x="${x}" y="${y}"
      fill="#9D9692"
      font-size="32"
      font-weight="700"
      font-family="${FONT_SANS}, sans-serif">${escapeXml(label)}</text>
    <text x="${x}" y="${y + 63}"
      fill="#F7F1EA"
      font-size="${valueFontSize}"
      font-weight="800"
      font-family="${FONT_SANS}, sans-serif">${escapeXml(displayValue)}</text>
  </g>`;
}

function orgLogoTiles(logos: string[], markDataUrl: string, x: number, yOffset: number) {
  const visibleLogos = logos.slice(0, 5);
  if (visibleLogos.length === 0) return "";
  const y = 459 + yOffset;
  const size = 48;
  const gap = 10;
  const tiles = visibleLogos
    .map((logo, index) => {
      const tileX = x + index * (size + gap);
      const clipId = `orgLogoClip${index}`;
      return `<g>
        <clipPath id="${clipId}">
          <rect x="${tileX}" y="${y}" width="${size}" height="${size}" rx="8"/>
        </clipPath>
        <image href="${logo || markDataUrl}" x="${tileX}" y="${y}" width="${size}" height="${size}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice"/>
      </g>`;
    })
    .join("");
  return `<g>
    <text x="${x}" y="${438 + yOffset}"
      fill="${OPENCLAW_RED}"
      font-size="32"
      font-weight="800"
      font-family="${FONT_SANS}, sans-serif">Organizations</text>
    ${tiles}
  </g>`;
}

export function buildPublisherOgSvg(params: PublisherOgSvgParams) {
  const rawTitle = params.title.trim() || params.handleLabel;
  const avatar = params.avatarDataUrl || params.markDataUrl;
  const avatarShape = params.avatarShape ?? "circle";
  const organizationLogos = params.organizationLogos?.filter(Boolean) ?? [];
  const hasOrganizations = organizationLogos.length > 0;
  const normalLayout = hasOrganizations
    ? {
        titleX: 509,
        subtitleX: 509,
        detailX: 509,
        downloadsX: 861,
        contentWidth: 610,
        creatorWidth: 320,
        downloadsWidth: 210,
      }
    : {
        titleX: 542,
        subtitleX: 542,
        detailX: 542,
        downloadsX: 913,
        contentWidth: 565,
        creatorWidth: 300,
        downloadsWidth: 190,
      };
  const normalTitleMaxWidth = params.official
    ? hasOrganizations
      ? normalLayout.contentWidth - 78
      : normalLayout.contentWidth
    : normalLayout.contentWidth;
  const titleNeedsOverflow = wrapTextWithoutEllipsis(rawTitle, normalTitleMaxWidth, 72).length > 1;
  const creatorNeedsOverflow =
    estimateTextWidth(params.handleLabel, 46) > normalLayout.creatorWidth;
  const usesLongLayout = titleNeedsOverflow || creatorNeedsOverflow;
  const contentYOffset = 0;
  const organizationExtraGap = usesLongLayout ? 41 : 0;
  const layout = usesLongLayout
    ? {
        titleX: 447,
        subtitleX: 447,
        detailX: 447,
        downloadsX: 447,
        contentWidth: 650,
        creatorWidth: 680,
        downloadsWidth: 210,
      }
    : normalLayout;
  const titleMaxWidth = params.official
    ? usesLongLayout
      ? layout.contentWidth
      : hasOrganizations
        ? layout.contentWidth - 78
        : layout.contentWidth
    : layout.contentWidth;
  const title = usesLongLayout
    ? fitMultilineTextWithDots(rawTitle, titleMaxWidth, 2, 66)
    : fitMultilineText(rawTitle, titleMaxWidth, 2, { maxFontSize: 72, minFontSize: 30 });
  const titleFontSize = title.fontSize;
  const titleLines = title.lines;
  const titleLineHeight = usesLongLayout ? 84 : Math.max(50, Math.round(titleFontSize * 0.98));
  const titleTspans = titleLines
    .map(
      (line, index) =>
        `<tspan x="${layout.titleX}" dy="${index === 0 ? 0 : titleLineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  const titleY = usesLongLayout
    ? 151
    : hasOrganizations
      ? titleLines.length > 1
        ? 138 + contentYOffset
        : 190 + contentYOffset
      : titleLines.length > 1
        ? 195 + contentYOffset
        : 243 + contentYOffset;
  const lastTitleLine = titleLines.at(-1) ?? rawTitle;
  const badgeX =
    params.official && !hasOrganizations && !usesLongLayout && titleLines.length === 1
      ? 1040
      : params.official && hasOrganizations && !usesLongLayout && titleLines.length === 1
        ? 1007
        : estimateBadgeX(
            lastTitleLine,
            layout.titleX,
            titleFontSize,
            usesLongLayout ? 1084 : layout.titleX + layout.contentWidth - OFFICIAL_BADGE_SIZE,
            titleLines.length > 1 ? 1 : 0.875,
          );
  const badgeY =
    params.official && !hasOrganizations && !usesLongLayout && titleLines.length === 1
      ? 198
      : params.official && hasOrganizations && !usesLongLayout && titleLines.length === 1
        ? 145
        : usesLongLayout
          ? 143
          : titleY + (titleLines.length - 1) * titleLineHeight - 45;
  const titleLastBaselineY = titleY + (titleLines.length - 1) * titleLineHeight;
  const taglineY = titleLastBaselineY + 60;
  const detailY = taglineY + 77;
  const downloadsStat = params.stats?.[0] ?? { label: "Downloads", value: "0" };
  const avatarCircle = hasOrganizations
    ? usesLongLayout
      ? { cx: 249, cy: 222, imageX: 87, imageY: 60 }
      : { cx: 308, cy: 262 + contentYOffset, imageX: 146, imageY: 100 + contentYOffset }
    : usesLongLayout
      ? { cx: 249, cy: 222, imageX: 87, imageY: 60 }
      : { cx: 276, cy: 315 + contentYOffset, imageX: 114, imageY: 153 + contentYOffset };
  const statsMarkup = usesLongLayout
    ? `${statColumn("Creator", params.handleLabel, layout.detailX, detailY, layout.creatorWidth, { truncateWithDots: true })}
    ${statColumn(downloadsStat.label, downloadsStat.value, layout.downloadsX, detailY + 112, layout.downloadsWidth)}`
    : `${statColumn("Creator", params.handleLabel, layout.detailX, detailY, layout.creatorWidth, { truncateWithDots: true })}
    ${statColumn(downloadsStat.label, downloadsStat.value, layout.downloadsX, detailY, layout.downloadsWidth)}`;
  const orgLogosX = usesLongLayout ? 110 : 169;
  const avatarFrame =
    avatarShape === "circle"
      ? `<circle cx="${avatarCircle.cx}" cy="${avatarCircle.cy}" r="139" fill="#FFFFFF" fill-opacity="0.055" stroke="#FFFFFF" stroke-opacity="0.16"/>
      <image href="${avatar}" x="${avatarCircle.imageX}" y="${avatarCircle.imageY}" width="324" height="324" clip-path="url(#publisherAvatarCircleClip)" preserveAspectRatio="xMidYMid slice"/>
      <circle cx="${avatarCircle.cx}" cy="${avatarCircle.cy}" r="139" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="1.5"/>`
      : `<rect x="${avatarCircle.cx - 139}" y="${avatarCircle.cy - 139}" width="278" height="278" rx="58" fill="#FFFFFF" fill-opacity="0.055" stroke="#FFFFFF" stroke-opacity="0.16"/>
      <image href="${avatar}" x="${avatarCircle.imageX}" y="${avatarCircle.imageY}" width="324" height="324" clip-path="url(#publisherAvatarRoundedClip)" preserveAspectRatio="xMidYMid slice"/>
      <rect x="${avatarCircle.cx - 138.25}" y="${avatarCircle.cy - 138.25}" width="276.5" height="276.5" rx="57.25" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="1.5"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgBase" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop stop-color="#12090A"/>
      <stop offset="0.46" stop-color="#08090A"/>
      <stop offset="1" stop-color="#050505"/>
    </linearGradient>
    <radialGradient id="bgAccent" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1064 78) rotate(152) scale(520 260)">
      <stop stop-color="${OPENCLAW_RED}" stop-opacity="0.17"/>
      <stop offset="1" stop-color="${OPENCLAW_RED}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bgDepth" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(178 590) rotate(-18) scale(600 250)">
      <stop stop-color="#12090A" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#12090A" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bgCorner" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(96 84) rotate(24) scale(440 240)">
      <stop stop-color="#7F1D2D" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#6C1B2B" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="publisherAvatarCircleClip">
      <circle cx="${avatarCircle.cx}" cy="${avatarCircle.cy}" r="139"/>
    </clipPath>
    <clipPath id="publisherAvatarRoundedClip">
      <rect x="${avatarCircle.cx - 139}" y="${avatarCircle.cy - 139}" width="278" height="278" rx="58"/>
    </clipPath>
  </defs>

  <rect width="1200" height="630" fill="url(#bgBase)"/>
  <rect width="1200" height="630" fill="url(#bgAccent)"/>
  <rect width="1200" height="630" fill="url(#bgDepth)"/>
  <rect width="1200" height="630" fill="url(#bgCorner)"/>
  <g>
    <g>${avatarFrame}</g>

    <g>
      <image href="${params.markDataUrl}" x="958" y="34" width="44" height="44" opacity="0.92" preserveAspectRatio="xMidYMid meet"/>
      <text x="1016" y="66"
        fill="#F7F1EA"
        font-size="28"
        font-weight="800"
        font-family="${FONT_SANS}, sans-serif">ClawHub</text>
    </g>

    <text x="${layout.titleX}" y="${titleY}"
      fill="#F7F1EA"
      font-size="${titleFontSize}"
      font-weight="800"
      font-family="${FONT_SANS}, sans-serif">${titleTspans}</text>
    ${params.official ? officialBadge(badgeX, badgeY) : ""}

    <text x="${layout.subtitleX}" y="${taglineY}"
      fill="${OPENCLAW_RED}"
      font-size="44"
      font-weight="800"
      font-family="${FONT_SANS}, sans-serif">on ClawHub</text>

    ${statsMarkup}
    ${orgLogoTiles(organizationLogos, params.markDataUrl, orgLogosX, contentYOffset + organizationExtraGap)}
  </g>
</svg>`;
}
