const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3041-\u3096\u30a1-\u30fa\uac00-\ud7af]/;

const hasSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl;

let zhSegmenter: Intl.Segmenter | null = null;
let jaSegmenter: Intl.Segmenter | null = null;
let koSegmenter: Intl.Segmenter | null = null;

function getZhSegmenter(): Intl.Segmenter {
  if (!zhSegmenter) {
    zhSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  }
  return zhSegmenter;
}

function getJaSegmenter(): Intl.Segmenter {
  if (!jaSegmenter) {
    jaSegmenter = new Intl.Segmenter("ja", { granularity: "word" });
  }
  return jaSegmenter;
}

function getKoSegmenter(): Intl.Segmenter {
  if (!koSegmenter) {
    koSegmenter = new Intl.Segmenter("ko", { granularity: "word" });
  }
  return koSegmenter;
}

/**
 * Fallback: split CJK text into individual characters.
 * Used when Intl.Segmenter is unavailable (e.g. stripped V8 runtime).
 */
function segmentCJKByChar(text: string): string[] {
  const tokens: string[] = [];
  for (const ch of text) {
    if (CJK_RE.test(ch)) {
      tokens.push(ch);
    }
  }
  return tokens;
}

function normalize(value: string) {
  return value.toLowerCase();
}

/**
 * Detect the primary CJK language in a text
 * Returns 'zh' for Chinese, 'ja' for Japanese, 'ko' for Korean, or null
 */
function detectCJKLanguage(text: string): "zh" | "ja" | "ko" | null {
  const chineseCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const hiraganaCount = (text.match(/[\u3040-\u309f]/g) || []).length;
  const katakanaCount = (text.match(/[\u30a0-\u30ff]/g) || []).length;
  const hangulCount = (text.match(/[\uac00-\ud7af]/g) || []).length;
  if (hiraganaCount + katakanaCount > 0) {
    return "ja";
  }
  if (hangulCount > 0) {
    return "ko";
  }
  if (chineseCount > 0) {
    return "zh";
  }
  return null;
}

/**
 * Segment CJK text using Intl.Segmenter, falling back to character-level
 * tokenization when the API is unavailable.
 */
function segmentCJK(text: string): string[] {
  if (!hasSegmenter) return segmentCJKByChar(text);

  const lang = detectCJKLanguage(text);
  if (!lang) return [];

  let segmenter: Intl.Segmenter;
  switch (lang) {
    case "ja":
      segmenter = getJaSegmenter();
      break;
    case "ko":
      segmenter = getKoSegmenter();
      break;
    default:
      segmenter = getZhSegmenter();
  }

  const segments: string[] = [];
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    const trimmed = segment.trim();
    if (trimmed && isWordLike) {
      segments.push(trimmed);
    }
  }
  return segments;
}

/**
 * Tokenize text for search, supporting both English and CJK languages
 *
 * For English: uses word boundaries (whitespace, punctuation)
 * For CJK: uses Intl.Segmenter for proper word segmentation
 */
export function tokenize(value: string): string[] {
  if (!value) return [];

  const normalized = normalize(value);

  if (!CJK_RE.test(normalized)) {
    return normalized.match(/[a-z0-9]+/g) ?? [];
  }

  const tokens: string[] = [];

  const parts = normalized.split(/([^\u4e00-\u9fff\u3400-\u4dbf\u3041-\u3096\u30a1-\u30fa\uac00-\ud7af]+)/g);

  for (const part of parts) {
    if (!part.trim()) continue;

    if (CJK_RE.test(part)) {
      const cjkTokens = segmentCJK(part);
      tokens.push(...cjkTokens);
    } else {
      const asciiTokens = part.match(/[a-z0-9]+/g) ?? [];
      tokens.push(...asciiTokens);
    }
  }

  return tokens;
}

export function matchesExactTokens(
  queryTokens: string[],
  parts: Array<string | null | undefined>,
): boolean {
  if (queryTokens.length === 0) return false;
  const text = parts.filter((part) => Boolean(part?.trim())).join(" ");
  if (!text) return false;
  const textTokens = tokenize(text);
  if (textTokens.length === 0) return false;
  // Require at least one token to prefix-match, allowing vector similarity to determine relevance
  return queryTokens.some((queryToken) =>
    textTokens.some((textToken) => textToken.startsWith(queryToken)),
  );
}

export const __test = {
  normalize,
  detectCJKLanguage,
  segmentCJKByChar,
};
