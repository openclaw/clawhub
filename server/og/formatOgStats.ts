import { formatCompactStat } from "../../src/lib/numberFormat";

function cleanQueryString(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function readOgDownloadsQuery(query: { downloads?: unknown; installs?: unknown }) {
  const downloads = cleanQueryString(query.downloads);
  if (downloads) return downloads;
  return cleanQueryString(query.installs);
}

export function formatOgStat(value: number | null | undefined) {
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return formatCompactStat(numericValue);
}

function parseRawOgStatValue(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^-?\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const compact = /^(-?\d+(?:\.\d+)?)([kKmM])$/.exec(trimmed);
  if (!compact) return null;
  const base = Number.parseFloat(compact[1]);
  if (!Number.isFinite(base)) return null;
  return compact[2].toLowerCase() === "k" ? Math.round(base * 1_000) : Math.round(base * 1_000_000);
}

export function resolveOgDownloadsDisplay(
  query: { downloads?: unknown; installs?: unknown },
  fallback?: number | null,
) {
  const raw = readOgDownloadsQuery(query);
  if (raw) {
    const numeric = parseRawOgStatValue(raw);
    if (numeric !== null) return formatOgStat(numeric);
    return raw;
  }
  return formatOgStat(fallback);
}
