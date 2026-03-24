import { FONT_MONO, FONT_SANS } from "./ogAssets";

export type SoulOgSvgParams = {
  markDataUrl: string;
  title: string;
  description: string;
  ownerLabel: string;
  versionLabel: string;
  footer: string;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapText(value: string, maxChars: number, maxLines: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  function pushLine(line: string) {
    if (!line) return;
    lines.push(line);
  }

  function splitLongWord(word: string) {
    if (word.length <= maxChars) return [word];
    const parts: string[] = [];
    let remaining = word;
    while (remaining.length > maxChars) {
      parts.push(`${remaining.slice(0, maxChars - 1)}…`);
      remaining = remaining.slice(maxChars - 1);
    }
    if (remaining) parts.push(remaining);
    return parts;
  }

  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        pushLine(current);
        current = "";
        if (lines.length >= maxLines - 1) break;
      }
      const parts = splitLongWord(word);
      for (const part of parts) {
        pushLine(part);
        if (lines.length >= maxLines) break;
      }
      current = "";
      if (lines.length >= maxLines - 1) break;
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    pushLine(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (lines.length < maxLines && current) pushLine(current);
  if (lines.length > maxLines) lines.length = maxLines;

  const usedWords = lines.join(" ").split(/\s+/).filter(Boolean).length;
  if (usedWords < words.length) {
    const last = lines.at(-1) ?? "";
    const trimmed = last.length > maxChars ? last.slice(0, maxChars) : last;
    lines[lines.length - 1] = `${trimmed.replace(/\s+$/g, "").replace(/[.。,;:!?]+$/g, "")}…`;
  }
  return lines;
}

export function buildSoulOgSvg(params: SoulOgSvgParams) {
  const rawTitle = params.title.trim() || "SoulHub";
  const rawDescription = params.description.trim() || "SOUL.md bundle on SoulHub.";

  const cardX = 72;
  const cardY = 96;
  const cardW = 640;
  const cardH = 456;
  const cardR = 34;

  const titleLines = wrapText(rawTitle, 22, 2);
  const descLines = wrapText(rawDescription, 42, 3);

  const titleFontSize = titleLines.length > 1 || rawTitle.length > 24 ? 72 : 80;
  const titleY = titleLines.length > 1 ? 258 : 280;
  const titleLineHeight = 84;

  const descY = titleLines.length > 1 ? 395 : 380;
  const descLineHeight = 34;

  const pillText = `${params.ownerLabel} • ${params.versionLabel}`;
  const footerY = cardY + cardH - 18;

  const titleTspans = titleLines
    .map((line, index) => {
      const dy = index === 0 ? 0 : titleLineHeight;
      return `<tspan x="114" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  const descTspans = descLines
    .map((line, index) => {
      const dy = index === 0 ? 0 : descLineHeight;
      return `<tspan x="114" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0E1314"/>
      <stop offset="0.55" stop-color="#142021"/>
      <stop offset="1" stop-color="#0E1314"/>
    </linearGradient>

    <radialGradient id="glowGold" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(300 80) rotate(120) scale(520 420)">
      <stop stop-color="#E7B96B" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#E7B96B" stop-opacity="0"/>
    </radialGradient>

    <radialGradient id="glowTeal" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1040 140) rotate(140) scale(520 420)">
      <stop stop-color="#6AD6C4" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#6AD6C4" stop-opacity="0"/>
    </radialGradient>

    <filter id="softBlur" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="24"/>
    </filter>

    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="26" flood-color="#000000" flood-opacity="0.6"/>
    </filter>

    <linearGradient id="pill" x1="0" y1="0" x2="520" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="#E7B96B" stop-opacity="0.26"/>
      <stop offset="1" stop-color="#E7B96B" stop-opacity="0.12"/>
    </linearGradient>

    <linearGradient id="stroke" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#FFFFFF" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0.08"/>
    </linearGradient>

    <clipPath id="cardClip">
      <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${cardR}"/>
    </clipPath>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="300" cy="80" r="520" fill="url(#glowGold)" filter="url(#softBlur)"/>
  <circle cx="1040" cy="140" r="520" fill="url(#glowTeal)" filter="url(#softBlur)"/>

  <g opacity="0.12">
    <path d="M0 90 C180 130 360 50 540 96 C720 142 840 220 1200 170" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="2"/>
    <path d="M0 190 C240 250 400 170 600 214 C800 258 960 330 1200 300" stroke="#FFFFFF" stroke-opacity="0.1" stroke-width="2"/>
    <path d="M0 450 C240 390 460 520 660 470 C860 420 1000 500 1200 460" stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="2"/>
  </g>

  <g opacity="0.24" filter="url(#softBlur)">
    <image href="${params.markDataUrl}" x="740" y="70" width="560" height="560" preserveAspectRatio="xMidYMid meet"/>
  </g>

  <g filter="url(#cardShadow)">
    <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${cardR}" fill="#1B201F" fill-opacity="0.92" stroke="url(#stroke)"/>
  </g>

  <g clip-path="url(#cardClip)">
    <image href="${params.markDataUrl}" x="108" y="134" width="46" height="46" preserveAspectRatio="xMidYMid meet"/>

    <g>
      <rect x="166" y="136" width="520" height="42" rx="21" fill="url(#pill)" stroke="#E7B96B" stroke-opacity="0.3"/>
      <text x="186" y="163"
        fill="#F7F1E8"
        font-size="18"
        font-weight="600"
        font-family="${FONT_SANS}, sans-serif"
        opacity="0.92">${escapeXml(pillText)}</text>
    </g>

    <text x="114" y="${titleY}"
      fill="#F7F1E8"
      font-size="${titleFontSize}"
      font-weight="800"
      font-family="${FONT_SANS}, sans-serif">${titleTspans}</text>

    <text x="114" y="${descY}"
      fill="#C7BFB5"
      font-size="26"
      font-weight="500"
      font-family="${FONT_SANS}, sans-serif">${descTspans}</text>

    <text x="114" y="${footerY}"
      fill="#B7B0A6"
      font-size="18"
      font-family="${FONT_MONO}, monospace">${escapeXml(params.footer)}</text>
  </g>
</svg>`;
}
