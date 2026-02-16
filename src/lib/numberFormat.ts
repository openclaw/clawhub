export type SkillStatsTriplet = { label: string; value: string }

export function formatCompactStat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function formatSkillStatsTriplet(stats: {
  downloads?: number
  installs?: number
  stars?: number
}): SkillStatsTriplet[] {
  return [
    { label: 'Downloads', value: formatCompactStat(stats.downloads ?? 0) },
    { label: 'Installs', value: formatCompactStat(stats.installs ?? 0) },
    { label: 'Stars', value: formatCompactStat(stats.stars ?? 0) },
  ]
}
