export type SkillStatsTriplet = {
  stars: number;
  downloads: number;
  installs?: number | null;
};

const THOUSAND = 1_000;
const MILLION = 1_000_000;

export function formatCompactStat(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);

  if (absolute < THOUSAND) {
    return `${Math.round(value)}`;
  }

  if (absolute < MILLION) {
    const { formatted, rounded } = formatUnit(absolute / THOUSAND);
    if (rounded >= THOUSAND) {
      return `${sign}1M`;
    }
    return `${sign}${formatted}k`;
  }

  return `${sign}${formatUnit(absolute / MILLION).formatted}M`;
}

export function formatSkillStatsTriplet(stats: SkillStatsTriplet) {
  return {
    stars: formatCompactStat(stats.stars),
    downloads: formatCompactStat(stats.downloads),
    installs: formatCompactStat(stats.installs ?? 0),
  };
}

function formatUnit(scaled: number): { formatted: string; rounded: number } {
  const decimals = scaled < 100 ? 1 : 0;
  const factor = 10 ** decimals;
  const rounded = Math.round(scaled * factor) / factor;
  return {
    formatted: stripTrailingZero(rounded.toFixed(decimals)),
    rounded,
  };
}

function stripTrailingZero(value: string): string {
  return value.replace(/\.0$/, "");
}
