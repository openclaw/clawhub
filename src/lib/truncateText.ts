export const PUBLIC_CATALOG_NAME_PREVIEW_LENGTH = 70;

// Scripts that do not separate words with spaces (Chinese, Japanese, Korean) often carry a
// single Latin space near the start of a summary. Backtracking to that space would drop
// nearly the whole preview, so only honour a word boundary that keeps most of the slice.
const WORD_BOUNDARY_MIN_KEPT_RATIO = 0.6;
// Same character class as the catalog search tokenizer in convex/lib/searchText.ts.
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3041-\u3096\u30a1-\u30fa\uac00-\ud7af]/;

export function truncateText(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  const truncated = normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  const wordBoundary = truncated.lastIndexOf(" ");
  // The ratio only guards non-spacing scripts. Space-separated text keeps its word boundary
  // however long the trailing word is.
  const discardsCJK = CJK_RE.test(truncated.slice(wordBoundary + 1));
  const keepsMostOfSlice = wordBoundary >= truncated.length * WORD_BOUNDARY_MIN_KEPT_RATIO;
  const honoursBoundary = wordBoundary > 0 && (keepsMostOfSlice || !discardsCJK);
  const text = honoursBoundary ? truncated.slice(0, wordBoundary) : truncated;
  return `${text}…`;
}
