import { FONT_MONO, FONT_SANS } from './ogAssets'

export type SkillOgSvgParams = {
  markDataUrl: string
  title: string
  description: string
  ownerLabel: string
  versionLabel: string
  footer: string
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function glyphWidthFactor(char: string) {
  if (char === ' ') return 0.28
  if (char === '…') return 0.62
  if (/[ilI.,:;|!'"`]/.test(char)) return 0.28
  if (/[mwMW@%&]/.test(char)) return 0.9
  if (/[A-Z]/.test(char)) return 0.68
  if (/[0-9]/.test(char)) return 0.6
  return 0.56
}

function estimateTextWidth(value: string, fontSize: number) {
  let width = 0
  for (const char of value) width += glyphWidthFactor(char) * fontSize
  return width
}

function truncateToWidth(value: string, maxWidth: number, fontSize: number) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (estimateTextWidth(trimmed, fontSize) <= maxWidth) return trimmed

  const ellipsis = '…'
  const ellipsisWidth = estimateTextWidth(ellipsis, fontSize)
  let out = ''
  for (const char of trimmed) {
    const next = out + char
    if (estimateTextWidth(next, fontSize) + ellipsisWidth > maxWidth) break
    out = next
  }
  return `${out.replace(/\s+$/g, '').replace(/[.。,;:!?]+$/g, '')}${ellipsis}`
}

function wrapText(value: string, maxWidth: number, fontSize: number, maxLines: number) {
  const words = value.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  function pushLine(line: string) {
    if (!line) return
    lines.push(line)
  }

  function splitLongWord(word: string) {
    if (estimateTextWidth(word, fontSize) <= maxWidth) return [word]
    const parts: string[] = []
    let remaining = word
    while (remaining && estimateTextWidth(remaining, fontSize) > maxWidth) {
      let chunk = ''
      for (const char of remaining) {
        const next = chunk + char
        if (estimateTextWidth(`${next}…`, fontSize) > maxWidth) break
        chunk = next
      }
      if (!chunk) break
      parts.push(`${chunk}…`)
      remaining = remaining.slice(chunk.length)
    }
    if (remaining) parts.push(remaining)
    return parts
  }

  for (const word of words) {
    if (estimateTextWidth(word, fontSize) > maxWidth) {
      if (current) {
        pushLine(current)
        current = ''
        if (lines.length >= maxLines - 1) break
      }
      const parts = splitLongWord(word)
      for (const part of parts) {
        pushLine(part)
        if (lines.length >= maxLines) break
      }
      current = ''
      if (lines.length >= maxLines - 1) break
      continue
    }

    const next = current ? `${current} ${word}` : word
    if (estimateTextWidth(next, fontSize) <= maxWidth) {
      current = next
      continue
    }
    pushLine(current)
    current = word
    if (lines.length >= maxLines - 1) break
  }
  if (lines.length < maxLines && current) pushLine(current)
  if (lines.length > maxLines) lines.length = maxLines

  const usedWords = lines.join(' ').split(/\s+/).filter(Boolean).length
  if (usedWords < words.length) {
    lines[lines.length - 1] = truncateToWidth(lines.at(-1) ?? '', maxWidth, fontSize)
  }
  return lines
}

export function buildSkillOgSvg(params: SkillOgSvgParams) {
  const rawTitle = params.title.trim() || 'ClawHub Skill'
  const rawDescription = params.description.trim() || 'Published on ClawHub.'

  const cardX = 72
  const cardY = 96
  const cardW = 640
  const cardH = 456
  const cardR = 34

  const contentX = 114
  const contentRightPadding = 28
  const contentMaxWidth = cardX + cardW - contentX - contentRightPadding

  const titleMaxLines = 2
  const descMaxLines = 3

  const titleProbeLines = wrapText(rawTitle, contentMaxWidth, 80, titleMaxLines)
  const titleFontSize = titleProbeLines.length > 1 ? 72 : 80
  const titleLines = wrapText(rawTitle, contentMaxWidth, titleFontSize, titleMaxLines)

  const descLines = wrapText(rawDescription, contentMaxWidth, 26, descMaxLines)
  const titleY = titleLines.length > 1 ? 258 : 280
  const titleLineHeight = 84

  const descY = titleLines.length > 1 ? 395 : 380
  const descLineHeight = 34

  const pillText = `${params.ownerLabel} • ${params.versionLabel}`
  const underlineY = cardY + cardH - 80
  const footerY = cardY + cardH - 18

  const titleTspans = titleLines
    .map((line, index) => {
      const dy = index === 0 ? 0 : titleLineHeight
      return `<tspan x="114" dy="${dy}">${escapeXml(line)}</tspan>`
    })
    .join('')

  const descTspans = descLines
    .map((line, index) => {
      const dy = index === 0 ? 0 : descLineHeight
      return `<tspan x="114" dy="${dy}">${escapeXml(line)}</tspan>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop stop-color="#14110F"/>
      <stop offset="0.55" stop-color="#1A1512"/>
      <stop offset="1" stop-color="#14110F"/>
    </linearGradient>

    <radialGradient id="glowOrange" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(260 60) rotate(120) scale(520 420)">
      <stop stop-color="#E86A47" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#E86A47" stop-opacity="0"/>
    </radialGradient>

    <radialGradient id="glowSea" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1050 120) rotate(140) scale(520 420)">
      <stop stop-color="#4AD8B7" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#4AD8B7" stop-opacity="0"/>
    </radialGradient>

    <filter id="softBlur" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="24"/>
    </filter>

    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="26" flood-color="#000000" flood-opacity="0.6"/>
    </filter>

    <linearGradient id="pill" x1="0" y1="0" x2="520" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="#E86A47" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#E86A47" stop-opacity="0.08"/>
    </linearGradient>

    <linearGradient id="stroke" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#FFFFFF" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0.06"/>
    </linearGradient>

    <clipPath id="cardClip">
      <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${cardR}"/>
    </clipPath>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="260" cy="60" r="520" fill="url(#glowOrange)" filter="url(#softBlur)"/>
  <circle cx="1050" cy="120" r="520" fill="url(#glowSea)" filter="url(#softBlur)"/>

  <g opacity="0.08">
    <path d="M0 84 C160 120 340 40 520 86 C700 132 820 210 1200 160" stroke="#FFFFFF" stroke-opacity="0.10" stroke-width="2"/>
    <path d="M0 188 C220 240 360 160 560 204 C760 248 900 330 1200 300" stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="2"/>
    <path d="M0 440 C240 380 420 520 620 470 C820 420 960 500 1200 460" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="2"/>
  </g>

  <g opacity="0.22" filter="url(#softBlur)">
    <image href="${params.markDataUrl}" x="740" y="70" width="560" height="560" preserveAspectRatio="xMidYMid meet"/>
  </g>

  <g filter="url(#cardShadow)">
    <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${cardR}" fill="#201B18" fill-opacity="0.92" stroke="url(#stroke)"/>
  </g>

  <g clip-path="url(#cardClip)">
    <image href="${params.markDataUrl}" x="108" y="134" width="46" height="46" preserveAspectRatio="xMidYMid meet"/>

    <g>
      <rect x="166" y="136" width="520" height="42" rx="21" fill="url(#pill)" stroke="#E86A47" stroke-opacity="0.28"/>
      <text x="186" y="163"
        fill="#F6EFE4"
        font-size="18"
        font-weight="600"
        font-family="${FONT_SANS}, sans-serif"
        opacity="0.92">${escapeXml(pillText)}</text>
    </g>

    <text x="114" y="${titleY}"
      fill="#F6EFE4"
      font-size="${titleFontSize}"
      font-weight="800"
      font-family="${FONT_SANS}, sans-serif">${titleTspans}</text>

    <text x="114" y="${descY}"
      fill="#C6B8A8"
      font-size="26"
      font-weight="500"
      font-family="${FONT_SANS}, sans-serif">${descTspans}</text>

    <rect x="114" y="${underlineY}" width="110" height="6" rx="3" fill="#E86A47"/>
    <text x="114" y="${footerY}"
      fill="#F6EFE4"
      font-size="20"
      font-weight="500"
      opacity="0.90"
      font-family="${FONT_MONO}, monospace">${escapeXml(params.footer)}</text>
  </g>
</svg>`
}
