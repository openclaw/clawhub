import { FONT_MONO, FONT_SANS } from "./ogAssets";

export const OPENCLAW_RED = "#D4453A";

export type RegistryOgStat = {
  value: string;
  label: string;
  icon?: "download";
};

export function buildOgDownloadsStat(value: string): RegistryOgStat {
  return { value, label: "downloads", icon: "download" };
}

function downloadIconMarkup(x: number, y: number, size = 20) {
  const stroke = "#9D9692";
  const strokeWidth = 2.2;
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 15V3" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="m7 10 5 5 5-5" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export function statLabelMarkup(
  x: number,
  y: number,
  label: string,
  options?: { icon?: "download"; fontSize?: number },
) {
  const fontSize = options?.fontSize ?? 21;
  if (options?.icon === "download") {
    const iconSize = fontSize + 2;
    return `<g>
      ${downloadIconMarkup(x, y - iconSize + 4, iconSize)}
      <text x="${x + iconSize + 8}" y="${y}"
        fill="#9D9692"
        font-size="${fontSize}"
        font-weight="700"
        font-family="${FONT_SANS}, sans-serif">${escapeXml(label)}</text>
    </g>`;
  }
  return `<text x="${x}" y="${y}"
    fill="#9D9692"
    font-size="${fontSize}"
    font-weight="700"
    font-family="${FONT_SANS}, sans-serif">${escapeXml(label)}</text>`;
}

export type RegistryOgCommand = {
  subject: string;
  action: string;
  target: string;
};

export type RegistryOgSvgParams = {
  markDataUrl: string;
  watermarkDataUrl?: string | null;
  avatarDataUrl?: string | null;
  avatarShape?: "circle" | "rounded";
  avatarFit?: "cover" | "contain";
  surfaceLabel: string;
  title: string;
  description: string;
  eyebrow?: string;
  installCommand?: RegistryOgCommand | null;
  stats?: RegistryOgStat[];
};

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FULL_WIDTH_GLYPH_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;

function glyphWidthFactor(char: string) {
  if (char === " ") return 0.28;
  if (char === "…") return 0.62;
  if (FULL_WIDTH_GLYPH_RE.test(char)) return 1;
  if (/[ilI.,:;|!'"`]/.test(char)) return 0.28;
  if (/[mwMW@%&]/.test(char)) return 0.9;
  if (/[A-Z]/.test(char)) return 0.68;
  if (/[0-9]/.test(char)) return 0.6;
  return 0.56;
}

function estimateTextWidth(value: string, fontSize: number) {
  let width = 0;
  for (const char of value) width += glyphWidthFactor(char) * fontSize;
  return width;
}

function truncateToWidth(value: string, maxWidth: number, fontSize: number) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (estimateTextWidth(trimmed, fontSize) <= maxWidth) return trimmed;

  return markTruncated(trimmed, maxWidth, fontSize);
}

function markTruncated(value: string, maxWidth: number, fontSize: number) {
  const ellipsis = "…";
  const ellipsisWidth = estimateTextWidth(ellipsis, fontSize);
  const chars = [...value.trim().replace(/[.。,;:!?]+$/g, "")];
  while (
    chars.length > 0 &&
    estimateTextWidth(chars.join(""), fontSize) + ellipsisWidth > maxWidth
  ) {
    chars.pop();
  }
  const out = chars
    .join("")
    .replace(/\s+$/g, "")
    .replace(/[.。,;:!?]+$/g, "");
  return `${out.replace(/\s+$/g, "").replace(/[.。,;:!?]+$/g, "")}${ellipsis}`;
}

export function wrapText(value: string, maxWidth: number, fontSize: number, maxLines: number) {
  if (maxLines <= 0) return [];
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

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    const separator = current && token.needsLeadingSpace ? " " : "";
    const next = current ? `${current}${separator}${token.text}` : token.text;
    if (estimateTextWidth(next, fontSize) <= maxWidth) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
      if (lines.length >= maxLines) {
        lines[lines.length - 1] = markTruncated(lines.at(-1) ?? "", maxWidth, fontSize);
        return lines;
      }
    }

    current = token.text;
  }

  if (current) {
    if (lines.length < maxLines) {
      lines.push(current);
    } else if (lines.length > 0) {
      lines[lines.length - 1] = markTruncated(lines.at(-1) ?? "", maxWidth, fontSize);
    }
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[lines.length - 1] = markTruncated(lines.at(-1) ?? "", maxWidth, fontSize);
  }
  return lines;
}

function statColumns(stats: RegistryOgStat[], contentX: number) {
  return stats
    .slice(0, 2)
    .map((stat, index) => {
      const x = contentX + index * 190;
      return `<g>
        ${statLabelMarkup(x, 424, stat.label, { icon: stat.icon })}
        <text x="${x}" y="464"
          fill="#F7F1EA"
          font-size="34"
          font-weight="800"
          font-family="${FONT_SANS}, sans-serif">${escapeXml(stat.value)}</text>
      </g>`;
    })
    .join("");
}

function installCommand(command: RegistryOgCommand | null | undefined, contentX: number) {
  if (!command) return "";
  const maxWidth = 780;
  const rightPadding = 34;
  const fontSize = 22;
  const textWidthFactor = 1.16;
  const subject = `${command.subject} `;
  const action = `${command.action} `;
  const prefixWidth =
    estimateTextWidth("openclaw ", fontSize) +
    estimateTextWidth(subject, fontSize) +
    estimateTextWidth(action, fontSize);
  const targetMaxWidth = Math.max(
    120,
    (maxWidth - rightPadding - prefixWidth * textWidthFactor) / textWidthFactor,
  );
  const target = truncateToWidth(command.target, targetMaxWidth, fontSize);
  return `<g>
    <text x="${contentX}" y="559"
      font-size="${fontSize}"
      font-weight="500"
      font-family="${FONT_MONO}, monospace">
      <tspan fill="#AFA8A2">openclaw </tspan>
      <tspan fill="${OPENCLAW_RED}">${escapeXml(subject)}</tspan>
      <tspan fill="#AFA8A2">${escapeXml(action)}</tspan>
      <tspan fill="#F7F1EA" font-weight="700">${escapeXml(target)}</tspan>
    </text>
  </g>`;
}

export function buildRegistryOgSvg(params: RegistryOgSvgParams) {
  const contentX = 72;
  const rawTitle = params.title.trim() || "ClawHub";
  const rawDescription = params.description.trim() || "Published on ClawHub.";
  const avatar = params.avatarDataUrl || params.markDataUrl;
  const watermark = params.watermarkDataUrl || params.markDataUrl;
  const avatarShape = params.avatarShape ?? "rounded";
  const avatarFit = params.avatarFit ?? "cover";
  const avatarImage =
    avatarFit === "contain" ? { x: 935, y: 56, size: 166 } : { x: 910, y: 31, size: 216 };
  const avatarFrame =
    avatarShape === "circle"
      ? `<circle cx="1018" cy="139" r="83" fill="#FFFFFF" fill-opacity="0.06" stroke="#FFFFFF" stroke-opacity="0.16"/>
      <image href="${avatar}" x="${avatarImage.x}" y="${avatarImage.y}" width="${avatarImage.size}" height="${avatarImage.size}" clip-path="url(#avatarCircleClip)" preserveAspectRatio="xMidYMid slice"/>
      <circle cx="1018" cy="139" r="83" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="1.5"/>`
      : `<rect x="935" y="56" width="166" height="166" rx="38" fill="#FFFFFF" fill-opacity="0.06" stroke="#FFFFFF" stroke-opacity="0.16"/>
      <image href="${avatar}" x="${avatarImage.x}" y="${avatarImage.y}" width="${avatarImage.size}" height="${avatarImage.size}" clip-path="url(#avatarRoundedClip)" preserveAspectRatio="xMidYMid slice"/>
      <rect x="935.75" y="56.75" width="164.5" height="164.5" rx="37.25" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="1.5"/>`;
  const titleMaxWidth = 810;
  const titleProbe = wrapText(rawTitle, titleMaxWidth, 68, 2);
  const titleFontSize = titleProbe.length > 1 ? 60 : 68;
  const titleLines = wrapText(rawTitle, titleMaxWidth, titleFontSize, 2);
  const descLines = wrapText(rawDescription, 760, 28, 2);
  const titleLineHeight = 66;
  const titleY = titleLines.length > 1 ? 174 : 184;
  const descY = titleLines.length > 1 ? 324 : 290;
  const eyebrow = [params.eyebrow, params.surfaceLabel].filter(Boolean).join(" / ");
  const stats =
    params.stats && params.stats.length > 0
      ? params.stats
      : [{ value: "ClawHub", label: "Registry" }];

  const titleTspans = titleLines
    .map(
      (line, index) =>
        `<tspan x="${contentX}" dy="${index === 0 ? 0 : titleLineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  const descTspans = descLines
    .map(
      (line, index) =>
        `<tspan x="${contentX}" dy="${index === 0 ? 0 : 38}">${escapeXml(line)}</tspan>`,
    )
    .join("");

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
    <clipPath id="avatarRoundedClip">
      <rect x="935" y="56" width="166" height="166" rx="38"/>
    </clipPath>
    <clipPath id="avatarCircleClip">
      <circle cx="1018" cy="139" r="83"/>
    </clipPath>
  </defs>

  <rect width="1200" height="630" fill="url(#bgBase)"/>
  <rect width="1200" height="630" fill="url(#bgAccent)"/>
  <rect width="1200" height="630" fill="url(#bgDepth)"/>
  <rect width="1200" height="630" fill="url(#bgCorner)"/>
  <g>
    <image href="${watermark}" x="940" y="402" width="360" height="360" opacity="0.05" preserveAspectRatio="xMidYMid meet"/>

    <g>${avatarFrame}</g>

    <image href="${params.markDataUrl}" x="${contentX}" y="64" width="46" height="46" opacity="0.92" preserveAspectRatio="xMidYMid meet"/>
    <text x="${contentX + 62}" y="96"
      fill="${OPENCLAW_RED}"
      font-size="25"
      font-weight="800"
      font-family="${FONT_MONO}, monospace">${escapeXml(eyebrow)}</text>

    <text x="${contentX}" y="${titleY}"
      fill="#F7F1EA"
      font-size="${titleFontSize}"
      font-weight="800"
      font-family="${FONT_SANS}, sans-serif">${titleTspans}</text>

    <text x="${contentX}" y="${descY}"
      fill="#B9B0AA"
      font-size="28"
      font-weight="500"
      font-family="${FONT_SANS}, sans-serif">${descTspans}</text>

    <g>${statColumns(stats, contentX)}</g>
    ${installCommand(params.installCommand, contentX)}

  </g>
</svg>`;
}
