import { formatSoulStatsTriplet, type SoulStatsTriplet } from '../lib/numberFormat'

export function SoulStatsTripletLine({
  stats,
  versionSuffix = 'v',
}: {
  stats: SoulStatsTriplet
  versionSuffix?: 'v' | 'versions'
}) {
  const formatted = formatSoulStatsTriplet(stats)
  return (
    <>
      ⭐ {formatted.stars} · ⤓ {formatted.downloads} · {formatted.versions} {versionSuffix}
    </>
  )
}

export function SoulMetricsRow({ stats }: { stats: SoulStatsTriplet }) {
  const formatted = formatSoulStatsTriplet(stats)
  return (
    <>
      <span>⤓ {formatted.downloads}</span>
      <span>★ {formatted.stars}</span>
      <span>{formatted.versions} v</span>
    </>
  )
}
