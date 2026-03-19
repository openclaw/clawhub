const ASCII_WORD_RE = /[a-z0-9]+/g;

function normalize(value: string) {
  return value.toLowerCase();
}

/**
 * Tokenize text using simple ASCII regex (original behavior).
 * Only extracts [a-z0-9]+ tokens — non-Latin characters are discarded.
 */
export function tokenizeAscii(value: string): string[] {
  if (!value) return [];
  return normalize(value).match(ASCII_WORD_RE) ?? [];
}

// Intl.Segmenter for multi-language word segmentation (CJK, Arabic, Thai, etc.).
// Falls back to ASCII-only tokenization when Intl.Segmenter is unavailable.
const segmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("en", { granularity: "word" })
    : null;

/**
 * Tokenize text with full Unicode support.
 * Uses Intl.Segmenter for word-level segmentation (handles CJK, Arabic, Thai, etc.)
 * and falls back to ASCII regex when Segmenter is unavailable.
 */
export function tokenize(value: string): string[] {
  if (!value) return [];
  const normalized = normalize(value);
  if (!segmenter) return normalized.match(ASCII_WORD_RE) ?? [];
  return [...segmenter.segment(normalized)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment);
}

/**
 * Check whether a token contains only ASCII alphanumeric characters.
 */
function isAsciiToken(token: string): boolean {
  return /^[a-z0-9]+$/.test(token);
}

/**
 * Split query tokens into ASCII and non-ASCII groups.
 * ASCII tokens use traditional prefix matching against skill metadata.
 * Non-ASCII tokens (CJK, Arabic, etc.) are handled separately via vector similarity gating.
 */
export function partitionQueryTokens(tokens: string[]): {
  ascii: string[];
  nonAscii: string[];
} {
  const ascii: string[] = [];
  const nonAscii: string[] = [];
  for (const t of tokens) {
    if (isAsciiToken(t)) ascii.push(t);
    else nonAscii.push(t);
  }
  return { ascii, nonAscii };
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

export const __test = { normalize, tokenize, tokenizeAscii, matchesExactTokens, isAsciiToken, partitionQueryTokens };
