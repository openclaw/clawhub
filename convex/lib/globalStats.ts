import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

export const GLOBAL_STATS_KEY = 'default'
const GLOBAL_STATS_PAGE_SIZE = 500

type SkillVisibilityFields = Pick<
  Doc<'skills'>,
  'softDeletedAt' | 'moderationStatus' | 'moderationFlags'
>

export function isPublicSkillDoc(skill: SkillVisibilityFields | null | undefined) {
  if (!skill || skill.softDeletedAt) return false
  if (skill.moderationStatus && skill.moderationStatus !== 'active') return false
  if (skill.moderationFlags?.includes('blocked.malware')) return false
  return true
}

export function getPublicSkillVisibilityDelta(
  before: SkillVisibilityFields | null | undefined,
  after: SkillVisibilityFields | null | undefined,
) {
  const beforePublic = isPublicSkillDoc(before)
  const afterPublic = isPublicSkillDoc(after)
  if (beforePublic === afterPublic) return 0
  return afterPublic ? 1 : -1
}

export async function countPublicSkillsForGlobalStats(ctx: Pick<MutationCtx, 'db'>) {
  let count = 0
  let cursor: string | null = null

  while (true) {
    const { page, isDone, continueCursor } = await ctx.db
      .query('skills')
      .withIndex('by_active_updated', (q) => q.eq('softDeletedAt', undefined))
      .order('asc')
      .paginate({ cursor, numItems: GLOBAL_STATS_PAGE_SIZE })

    for (const skill of page) {
      if (isPublicSkillDoc(skill)) {
        count += 1
      }
    }

    if (isDone) break
    cursor = continueCursor
  }

  return count
}

export async function setGlobalPublicSkillsCount(
  ctx: Pick<MutationCtx, 'db'>,
  count: number,
  now = Date.now(),
) {
  const normalizedCount = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0))
  const existing = await ctx.db
    .query('globalStats')
    .withIndex('by_key', (q) => q.eq('key', GLOBAL_STATS_KEY))
    .unique()

  if (existing) {
    await ctx.db.patch(existing._id, { activeSkillsCount: normalizedCount, updatedAt: now })
  } else {
    await ctx.db.insert('globalStats', {
      key: GLOBAL_STATS_KEY,
      activeSkillsCount: normalizedCount,
      updatedAt: now,
    })
  }
}

export async function adjustGlobalPublicSkillsCount(
  ctx: Pick<MutationCtx, 'db'>,
  delta: number,
  now = Date.now(),
) {
  const normalizedDelta = Math.trunc(Number.isFinite(delta) ? delta : 0)
  if (normalizedDelta === 0) return

  const existing = await ctx.db
    .query('globalStats')
    .withIndex('by_key', (q) => q.eq('key', GLOBAL_STATS_KEY))
    .unique()

  if (!existing) {
    // No baseline yet (e.g. fresh deploy). Initialize via full recount once.
    const count = await countPublicSkillsForGlobalStats(ctx)
    await setGlobalPublicSkillsCount(ctx, count, now)
    return
  }

  const nextCount = Math.max(0, existing.activeSkillsCount + normalizedDelta)
  await ctx.db.patch(existing._id, { activeSkillsCount: nextCount, updatedAt: now })
}
