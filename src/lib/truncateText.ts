export const PUBLIC_CATALOG_NAME_PREVIEW_LENGTH = 70;

export function truncateText(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  const truncated = normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  const wordBoundary = truncated.lastIndexOf(" ");
  const text = wordBoundary > 0 ? truncated.slice(0, wordBoundary) : truncated;
  return `${text}…`;
}
