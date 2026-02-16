import { formatSkillStatsTriplet, type SkillStatsTriplet } from '../lib/numberFormat'

type SkillMetricsStats = SkillStatsTriplet & {
  versions: number
}

export function SkillStatsTripletLine({ stats }: { stats: SkillStatsTriplet }) {
  const formatted = formatSkillStatsTriplet(stats)
  return (
    <>
      ⭐ {formatted.stars} · ⤓ {formatted.downloads} · ⤒ {formatted.installsAllTime}
    </>
  )
}

export function SkillMetricsRow({ stats }: { stats: SkillMetricsStats }) {
  const formatted = formatSkillStatsTriplet(stats)
  return (
    <>
      <span>⤓ {formatted.downloads}</span>
      <span>⤒ {formatted.installsAllTime}</span>
      <span>★ {formatted.stars}</span>
      <span>{stats.versions} v</span>
    </>
  )
}
