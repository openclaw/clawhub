const ASCII_WORD_RE = /[a-z0-9]+/g;

function normalize(value: string) {
  // Lowercase + strip combining marks (accents) so that "café" → "cafe",
  // "pokémon" → "pokemon", keeping accented Latin on the ASCII matching path.
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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
// Use `undefined` locale (runtime default) instead of a specific locale like "en",
// because a fixed locale applies language-specific word-break tailoring that may
// not correctly segment other scripts (CJK dictionary-based breaking under "en"
// is a V8/ICU implementation detail, not a spec guarantee).
const segmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

/**
 * Tokenize text with full Unicode support.
 * Uses Intl.Segmenter for word-level segmentation (handles CJK, Arabic, Thai, etc.)
 * and falls back to ASCII regex when Segmenter is unavailable.
 *
 * Post-processes Segmenter output in two ways:
 * 1. Accent normalization: "café" → "cafe", "pokémon" → "pokemon" via NFD +
 *    combining mark removal, keeping accented Latin on the ASCII matching path.
 * 2. ASCII re-split: tokens containing ASCII alphanumeric characters are run
 *    through the legacy /[a-z0-9]+/g regex to extract ASCII subparts. This
 *    handles both pure-ASCII connectors ("hello_world" → ["hello", "world"])
 *    and mixed-script tokens ("AI绘画" → extracts "ai" alongside "绘画").
 *    Non-ASCII content in mixed tokens is preserved as-is.
 */
export function tokenize(value: string): string[] {
  if (!value) return [];
  const normalized = normalize(value);
  if (!segmenter) return normalized.match(ASCII_WORD_RE) ?? [];
  const segments = [...segmenter.segment(normalized)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment);
  const result: string[] = [];
  for (const token of segments) {
    if (/^[\x20-\x7e]+$/.test(token)) {
      // Pure printable ASCII token — apply legacy regex to split on non-alnum chars
      const parts = token.match(ASCII_WORD_RE);
      if (parts) result.push(...parts);
    } else {
      // Non-ASCII or mixed-script token.
      // Extract any ASCII subparts (e.g., "AI" from "AI绘画" or "مرحباAI")
      const asciiParts = token.match(ASCII_WORD_RE);
      if (asciiParts) result.push(...asciiParts);
      // Also extract non-ASCII content by removing ASCII characters
      const nonAscii = token.replace(/[a-z0-9_\s.,-]+/g, "").trim();
      if (nonAscii) result.push(nonAscii);
    }
  }
  return result;
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
