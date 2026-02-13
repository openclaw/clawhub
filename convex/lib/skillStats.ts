import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { toDayKey } from './leaderboards'

type SkillStatDeltas = {
  downloads?: number
  stars?: number
  comments?: number
  installsCurrent?: number
  installsAllTime?: number
}

export function applySkillStatDeltas(skill: Doc<'skills'>, deltas: SkillStatDeltas) {
  const currentDownloads =
    typeof skill.statsDownloads === 'number' ? skill.statsDownloads : skill.stats.downloads
  const currentStars = typeof skill.statsStars === 'number' ? skill.statsStars : skill.stats.stars
  const currentInstallsCurrent =
    typeof skill.statsInstallsCurrent === 'number'
      ? skill.statsInstallsCurrent
      : (skill.stats.installsCurrent ?? 0)
  const currentInstallsAllTime =
    typeof skill.statsInstallsAllTime === 'number'
      ? skill.statsInstallsAllTime
      : (skill.stats.installsAllTime ?? 0)

  const currentComments = skill.stats.comments
  const nextDownloads = Math.max(0, currentDownloads + (deltas.downloads ?? 0))
  const nextStars = Math.max(0, currentStars + (deltas.stars ?? 0))
  const nextComments = Math.max(0, currentComments + (deltas.comments ?? 0))
  const nextInstallsCurrent = Math.max(0, currentInstallsCurrent + (deltas.installsCurrent ?? 0))
  const nextInstallsAllTime = Math.max(0, currentInstallsAllTime + (deltas.installsAllTime ?? 0))

  return {
    statsDownloads: nextDownloads,
    statsStars: nextStars,
    statsInstallsCurrent: nextInstallsCurrent,
    statsInstallsAllTime: nextInstallsAllTime,
    stats: {
      ...skill.stats,
      downloads: nextDownloads,
      stars: nextStars,
      comments: nextComments,
      installsCurrent: nextInstallsCurrent,
      installsAllTime: nextInstallsAllTime,
    },
  }
}

export async function bumpDailySkillStats(
  ctx: MutationCtx,
  params: {
    skillId: Id<'skills'>
    now: number
    downloads?: number
    installs?: number
  },
) {
  const downloads = params.downloads ?? 0
  const installs = params.installs ?? 0
  if (downloads === 0 && installs === 0) return

  const day = toDayKey(params.now)
  const existing = await ctx.db
    .query('skillDailyStats')
    .withIndex('by_skill_day', (q) => q.eq('skillId', params.skillId).eq('day', day))
    .unique()

  if (existing) {
    await ctx.db.patch(existing._id, {
      downloads: Math.max(0, existing.downloads + downloads),
      installs: Math.max(0, existing.installs + installs),
      updatedAt: params.now,
    })
    return
  }

  await ctx.db.insert('skillDailyStats', {
    skillId: params.skillId,
    day,
    downloads: Math.max(0, downloads),
    installs: Math.max(0, installs),
    updatedAt: params.now,
  })
}
