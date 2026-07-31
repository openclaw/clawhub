export const PUBLIC_CATALOG_NAME_PREVIEW_LENGTH = 70;

// Scripts that do not separate words with spaces (Chinese, Japanese, Korean) often carry a
// single Latin space near the start of a summary. Backtracking to that space would drop
// nearly the whole preview, so only honour a word boundary that keeps most of the slice.
const WORD_BOUNDARY_MIN_KEPT_RATIO = 0.6;

export function truncateText(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  const truncated = normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  const wordBoundary = truncated.lastIndexOf(" ");
  const keepsMostOfSlice = wordBoundary >= truncated.length * WORD_BOUNDARY_MIN_KEPT_RATIO;
  const text = wordBoundary > 0 && keepsMostOfSlice ? truncated.slice(0, wordBoundary) : truncated;
  return `${text}…`;
}
