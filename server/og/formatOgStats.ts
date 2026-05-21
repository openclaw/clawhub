export function formatOgStat(value: number | null | undefined) {
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const abs = Math.abs(numericValue);
  if (abs >= 1_000_000) return `${(numericValue / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`;
  if (abs >= 1_000) return `${(numericValue / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(numericValue);
}
