import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import type { ActionCtx } from './_generated/server'
import { internalAction, internalMutation, internalQuery } from './_generated/server'

const DEFAULT_BATCH_SIZE = 200
const MAX_BATCH_SIZE = 1000
const DEFAULT_MAX_BATCHES = 5
const MAX_MAX_BATCHES = 50
const BACKFILL_STATE_KEY = 'default'

export const backfillSkillStatFieldsInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const { page, isDone, continueCursor } = await ctx.db
      .query('skills')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize })

    let patched = 0
    for (const skill of page) {
      const next = buildSkillStatPatch(skill)
      if (!next) continue
      await ctx.db.patch(skill._id, next)
      patched += 1
    }

    return {
      ok: true as const,
      scanned: page.length,
      patched,
      cursor: isDone ? null : continueCursor,
      isDone,
    }
  },
})

type BackfillState = {
  cursor: string | null
  doneAt?: number
}

type BackfillActionArgs = {
  batchSize?: number
  maxBatches?: number
  resetCursor?: boolean
}

type BackfillStats = {
  scanned: number
  patched: number
  batches: number
}

type BackfillActionResult = {
  ok: true
  isDone: boolean
  cursor: string | null
  stats: BackfillStats
}

export const getSkillStatBackfillStateInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<BackfillState> => {
    const state = await ctx.db
      .query('skillStatBackfillState')
      .withIndex('by_key', (q) => q.eq('key', BACKFILL_STATE_KEY))
      .unique()
    return { cursor: state?.cursor ?? null, doneAt: state?.doneAt }
  },
})

export const setSkillStatBackfillStateInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    doneAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const state = await ctx.db
      .query('skillStatBackfillState')
      .withIndex('by_key', (q) => q.eq('key', BACKFILL_STATE_KEY))
      .unique()

    if (!state) {
      await ctx.db.insert('skillStatBackfillState', {
        key: BACKFILL_STATE_KEY,
        cursor: args.cursor,
        doneAt: args.doneAt,
        updatedAt: now,
      })
      return { ok: true as const }
    }

    await ctx.db.patch(state._id, {
      cursor: args.cursor,
      doneAt: args.doneAt,
      updatedAt: now,
    })

    return { ok: true as const }
  },
})

async function runSkillStatBackfillInternalHandler(
  ctx: ActionCtx,
  args: BackfillActionArgs,
): Promise<BackfillActionResult> {
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES)

  if (args.resetCursor) {
    await ctx.runMutation(internal.statsMaintenance.setSkillStatBackfillStateInternal, {
      cursor: undefined,
      doneAt: undefined,
    })
  }

  const state = (await ctx.runQuery(
    internal.statsMaintenance.getSkillStatBackfillStateInternal,
    {},
  )) as BackfillState
  if (state.doneAt && !args.resetCursor) {
    return {
      ok: true,
      isDone: true,
      cursor: null,
      stats: { scanned: 0, patched: 0, batches: 0 },
    }
  }

  let cursor: string | null = state.cursor ?? null
  const stats: BackfillStats = { scanned: 0, patched: 0, batches: 0 }

  for (let i = 0; i < maxBatches; i += 1) {
    const result = (await ctx.runMutation(
      internal.statsMaintenance.backfillSkillStatFieldsInternal,
      {
        cursor: cursor ?? undefined,
        batchSize,
      },
    )) as { scanned: number; patched: number; cursor: string | null; isDone: boolean }
    stats.scanned += result.scanned
    stats.patched += result.patched
    stats.batches += 1
    cursor = result.cursor

    if (result.isDone) {
      await ctx.runMutation(internal.statsMaintenance.setSkillStatBackfillStateInternal, {
        cursor: undefined,
        doneAt: Date.now(),
      })
      return { ok: true, isDone: true, cursor: null, stats }
    }

    await ctx.runMutation(internal.statsMaintenance.setSkillStatBackfillStateInternal, {
      cursor: cursor ?? undefined,
      doneAt: undefined,
    })
  }

  return { ok: true, isDone: false, cursor, stats }
}

export const runSkillStatBackfillInternal: ReturnType<typeof internalAction> = internalAction({
  args: {
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    resetCursor: v.optional(v.boolean()),
  },
  handler: runSkillStatBackfillInternalHandler,
})

function buildSkillStatPatch(skill: Doc<'skills'>) {
  const stats = skill.stats
  const nextDownloads = stats.downloads
  const nextStars = stats.stars
  const nextInstallsCurrent = stats.installsCurrent ?? 0
  const nextInstallsAllTime = stats.installsAllTime ?? 0

  if (
    skill.statsDownloads === nextDownloads &&
    skill.statsStars === nextStars &&
    skill.statsInstallsCurrent === nextInstallsCurrent &&
    skill.statsInstallsAllTime === nextInstallsAllTime
  ) {
    return null
  }

  return {
    statsDownloads: nextDownloads,
    statsStars: nextStars,
    statsInstallsCurrent: nextInstallsCurrent,
    statsInstallsAllTime: nextInstallsAllTime,
  }
}

/**
 * Reconcile skill stats by counting actual records in source-of-truth tables.
 *
 * This fixes stats that got out of sync due to missed events, cursor issues,
 * or bugs in the event processing pipeline. It counts:
 * - stars: actual records in the `stars` table for each skill
 * - comments: actual records in the `comments` table for each skill
 *
 * Downloads and installs are event-sourced only (no separate table to count from),
 * so they cannot be reconciled this way.
 */
export const reconcileSkillStarCounts = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 50, 1, 200)
    const now = Date.now()

    const { page, isDone, continueCursor } = await ctx.db
      .query('skills')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize })

    let patched = 0
    for (const skill of page) {
      // Count actual star records for this skill
      const starRecords = await ctx.db
        .query('stars')
        .withIndex('by_skill_user', (q) => q.eq('skillId', skill._id))
        .collect()
      const actualStars = starRecords.length

      // Count actual comment records for this skill
      const commentRecords = await ctx.db
        .query('comments')
        .withIndex('by_skill', (q) => q.eq('skillId', skill._id))
        .collect()
      const actualComments = commentRecords.filter((c) => !c.softDeletedAt).length

      // Check if stats are out of sync
      if (skill.stats.stars !== actualStars || skill.stats.comments !== actualComments) {
        const updatedStats = {
          ...skill.stats,
          stars: actualStars,
          comments: actualComments,
        }
        await ctx.db.patch(skill._id, {
          statsStars: actualStars,
          stats: updatedStats,
          updatedAt: now,
        })
        patched += 1
      }
    }

    return {
      scanned: page.length,
      patched,
      cursor: isDone ? null : continueCursor,
      isDone,
    }
  },
})

export const runReconcileSkillStarCountsInternal = internalAction({
  args: {
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 50, 1, 200)
    const maxBatches = clampInt(args.maxBatches ?? 10, 1, 50)

    let cursor: string | undefined
    let totalScanned = 0
    let totalPatched = 0

    for (let i = 0; i < maxBatches; i++) {
      const result = (await ctx.runMutation(internal.statsMaintenance.reconcileSkillStarCounts, {
        cursor,
        batchSize,
      })) as { scanned: number; patched: number; cursor: string | null; isDone: boolean }

      totalScanned += result.scanned
      totalPatched += result.patched

      if (result.isDone) break
      cursor = result.cursor ?? undefined
    }

    return { scanned: totalScanned, patched: totalPatched }
  },
})

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
