/**
 * Skill Stat Events - Event-sourced stats processing for skills
 *
 * Instead of updating skill stats synchronously in the hot path (which can cause
 * contention when multiple users download/star/install the same skill), we insert
 * lightweight event records and process them in batches via cron jobs.
 *
 * Two processing paths run at different frequencies to balance freshness vs bandwidth:
 *
 * 1. **Daily stats (15-minute cron)** — `processSkillStatEventsAction`
 *    Writes to skillDailyStats for trending/leaderboards. Uses a cursor in
 *    skillStatUpdateCursors. Does NOT touch skill documents.
 *
 * 2. **Skill doc sync (6-hour cron)** — `processSkillStatEventsInternal`
 *    Patches skill documents with accumulated stat deltas. Uses processedAt
 *    field to track progress. Runs infrequently because patching skill docs
 *    invalidates reactive queries for all subscribers (thundering herd).
 */

import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { applySkillStatDeltas, bumpDailySkillStats } from './lib/skillStats'

/**
 * Event types that affect skill stats:
 *
 * - download: User downloaded skill as zip (+1 downloads)
 * - star: User starred the skill (+1 stars)
 * - unstar: User removed their star (-1 stars)
 * - install_new: First time this user installed this skill (+1 installsAllTime, +1 installsCurrent)
 * - install_reactivate: User re-added skill after removing it (+1 installsCurrent only)
 * - install_deactivate: User removed skill from all projects (-1 installsCurrent)
 * - install_clear: User cleared all telemetry data (custom delta for both allTime and current)
 */
export type StatEventKind =
  | 'download'
  | 'star'
  | 'unstar'
  | 'comment'
  | 'uncomment'
  | 'install_new'
  | 'install_reactivate'
  | 'install_deactivate'
  | 'install_clear'

/**
 * Insert a stat event to be processed later by the cron job.
 *
 * This is called from the hot path (downloads, stars, telemetry) instead of
 * directly updating skill stats. It's a single insert with no read-modify-write
 * cycle, so it's fast and doesn't contend with other operations on the same skill.
 *
 * @param ctx - Mutation context
 * @param params.skillId - The skill being affected
 * @param params.kind - Type of event (download, star, install_new, etc.)
 * @param params.occurredAt - When the event happened (defaults to now). Important for
 *                            daily stats bucketing - we want downloads at 11:55 PM Monday
 *                            to count toward Monday's stats even if processed on Tuesday.
 * @param params.delta - Only used for install_clear events, specifies exact delta amounts
 */
export async function insertStatEvent(
  ctx: MutationCtx,
  params: {
    skillId: Id<'skills'>
    kind: StatEventKind
    occurredAt?: number
    delta?: { allTime: number; current: number }
  },
) {
  await ctx.db.insert('skillStatEvents', {
    skillId: params.skillId,
    kind: params.kind,
    delta: params.delta,
    occurredAt: params.occurredAt ?? Date.now(),
    processedAt: undefined,
  })
}

/**
 * Aggregated deltas for a single skill after processing multiple events.
 *
 * When we process a batch of 100 events, many might be for the same skill.
 * Instead of updating the skill document once per event, we aggregate all
 * events for each skill and apply a single update.
 *
 * The downloadEvents and installNewEvents arrays store the original timestamps
 * so we can update daily stats with the correct day bucket for each event.
 */
type AggregatedDeltas = {
  downloads: number
  stars: number
  comments: number
  installsAllTime: number
  installsCurrent: number
  /** Original timestamps for each download event (for daily stats bucketing) */
  downloadEvents: number[]
  /** Original timestamps for each new install event (for daily stats bucketing) */
  installNewEvents: number[]
}

/**
 * Aggregate multiple events for a single skill into net deltas.
 *
 * Example: If a skill has these events in the batch:
 *   - download (Mon 11pm)
 *   - download (Tue 1am)
 *   - star
 *   - unstar
 *   - star
 *
 * The result would be:
 *   - downloads: 2
 *   - stars: 1 (net: +1 -1 +1 = +1)
 *   - downloadEvents: [<Mon 11pm timestamp>, <Tue 1am timestamp>]
 *
 * This aggregation reduces the number of database operations from N events
 * to 1 skill update + N daily stat updates (which themselves may coalesce
 * if multiple events fall on the same day).
 */
function aggregateEvents(events: Doc<'skillStatEvents'>[]): AggregatedDeltas {
  const result: AggregatedDeltas = {
    downloads: 0,
    stars: 0,
    comments: 0,
    installsAllTime: 0,
    installsCurrent: 0,
    downloadEvents: [],
    installNewEvents: [],
  }

  for (const event of events) {
    switch (event.kind) {
      case 'download':
        result.downloads += 1
        result.downloadEvents.push(event.occurredAt)
        break
      case 'star':
        result.stars += 1
        break
      case 'unstar':
        result.stars -= 1
        break
      case 'comment':
        result.comments += 1
        break
      case 'uncomment':
        result.comments -= 1
        break
      case 'install_new':
        // New user installing for the first time: count toward both lifetime and current
        result.installsAllTime += 1
        result.installsCurrent += 1
        result.installNewEvents.push(event.occurredAt)
        break
      case 'install_reactivate':
        // User re-added skill after removing: only affects current count
        result.installsCurrent += 1
        break
      case 'install_deactivate':
        // User removed skill from all projects: only affects current count
        result.installsCurrent -= 1
        break
      case 'install_clear':
        // User cleared telemetry: uses custom delta values (typically negative)
        if (event.delta) {
          result.installsAllTime += event.delta.allTime
          result.installsCurrent += event.delta.current
        }
        break
    }
  }

  return result
}

/**
 * Process a batch of unprocessed stat events.
 *
 * Called by the 6-hour cron to sync stats to skill docs. Processes up to batchSize events (default 500).
 * If the batch is full, schedules an immediate follow-up run to drain the queue.
 *
 * Processing steps:
 * 1. Query unprocessed events (processedAt is undefined)
 * 2. Group events by skillId to minimize skill document fetches
 * 3. For each skill:
 *    a. Fetch the skill document once
 *    b. Aggregate all events for this skill into net deltas
 *    c. Apply deltas to skill stats (downloads, stars, installs)
 *    d. Update daily stats for trending (using original event timestamps)
 *    e. Mark all events as processed
 * 4. If batch was full, schedule another run immediately
 *
 * Aggregation levels:
 * - Level 1: Batch of 100 events from the queue
 * - Level 2: Group by skillId (e.g., 100 events → 30 unique skills)
 * - Level 3: Aggregate events per skill (e.g., 5 events → 1 skill update)
 * - Level 4: Daily stats may coalesce (e.g., 3 downloads same day → 1 upsert)
 */
export const processSkillStatEventsInternal = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 500
    const now = Date.now()

    // Level 1: Fetch a batch of unprocessed events
    const events = await ctx.db
      .query('skillStatEvents')
      .withIndex('by_unprocessed', (q) => q.eq('processedAt', undefined))
      .take(batchSize)

    if (events.length === 0) {
      return { processed: 0 }
    }

    // Level 2: Group events by skillId to minimize database reads
    // Instead of fetching the same skill document multiple times,
    // we fetch it once and process all its events together
    const eventsBySkill = new Map<Id<'skills'>, Doc<'skillStatEvents'>[]>()
    for (const event of events) {
      const existing = eventsBySkill.get(event.skillId) ?? []
      existing.push(event)
      eventsBySkill.set(event.skillId, existing)
    }

    // Process each skill's events
    for (const [skillId, skillEvents] of eventsBySkill) {
      const skill = await ctx.db.get(skillId)

      // Skill was deleted - just mark events as processed
      if (!skill) {
        for (const event of skillEvents) {
          await ctx.db.patch(event._id, { processedAt: now })
        }
        continue
      }

      // Level 3: Aggregate all events for this skill into net deltas
      // e.g., 3 downloads + 2 stars - 1 unstar → { downloads: 3, stars: 1 }
      const deltas = aggregateEvents(skillEvents)

      // Apply aggregated deltas to skill stats (single update per skill)
      if (
        deltas.downloads !== 0 ||
        deltas.stars !== 0 ||
        deltas.comments !== 0 ||
        deltas.installsAllTime !== 0 ||
        deltas.installsCurrent !== 0
      ) {
        const patch = applySkillStatDeltas(skill, {
          downloads: deltas.downloads,
          stars: deltas.stars,
          comments: deltas.comments,
          installsAllTime: deltas.installsAllTime,
          installsCurrent: deltas.installsCurrent,
        })
        // Don't update `updatedAt` — stat changes shouldn't move the
        // skill's position in the by_active_updated index.
        await ctx.db.patch(skill._id, patch)
      }

      // NOTE: Daily stats (skillDailyStats) are written by the 15-minute
      // action cron (processSkillStatEventsAction), not here.

      // Mark all events for this skill as processed
      for (const event of skillEvents) {
        await ctx.db.patch(event._id, { processedAt: now })
      }
    }

    // If we hit the batch limit, there may be more events waiting.
    // Schedule an immediate follow-up run to drain the queue.
    // This ensures high-volume periods don't create a backlog.
    if (events.length === batchSize) {
      await ctx.scheduler.runAfter(0, internal.skillStatEvents.processSkillStatEventsInternal, {
        batchSize,
      })
    }

    return { processed: events.length }
  },
})

// ============================================================================
// Action-based processing (cursor-based, runs outside transaction window)
// ============================================================================

const CURSOR_KEY = 'skill_stat_events'
const EVENT_BATCH_SIZE = 500
const MAX_SKILLS_PER_RUN = 50

/**
 * Fetch a batch of events after the given cursor (by _creationTime).
 * Returns events sorted by _creationTime ascending.
 */
export const getUnprocessedEventBatch = internalQuery({
  args: {
    cursorCreationTime: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? EVENT_BATCH_SIZE
    const cursor = args.cursorCreationTime

    // Query events after the cursor using the built-in creation time index
    const events = await ctx.db
      .query('skillStatEvents')
      .withIndex('by_creation_time', (q) =>
        cursor !== undefined ? q.gt('_creationTime', cursor) : q,
      )
      .take(limit)
    return events
  },
})

/**
 * Get the current cursor position from the cursors table.
 */
export const getStatEventCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cursor = await ctx.db
      .query('skillStatUpdateCursors')
      .withIndex('by_key', (q) => q.eq('key', CURSOR_KEY))
      .unique()
    return cursor?.cursorCreationTime
  },
})

/**
 * Validator for skill deltas passed to the mutation.
 */
const skillDeltaValidator = v.object({
  skillId: v.id('skills'),
  downloads: v.number(),
  stars: v.number(),
  comments: v.number(),
  installsAllTime: v.number(),
  installsCurrent: v.number(),
  downloadEvents: v.array(v.number()),
  installNewEvents: v.array(v.number()),
})

/**
 * Write aggregated daily stats and advance the cursor.
 * This is a single atomic mutation that:
 * 1. Updates daily stats for trending/leaderboards (skillDailyStats)
 * 2. Advances the cursor to the new position
 * NOTE: Does NOT patch skill documents — that's handled by processSkillStatEventsInternal.
 */
export const applyAggregatedStatsAndUpdateCursor = internalMutation({
  args: {
    skillDeltas: v.array(skillDeltaValidator),
    newCursor: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    // Update daily stats for trending/leaderboards
    for (const delta of args.skillDeltas) {
      for (const occurredAt of delta.downloadEvents) {
        await bumpDailySkillStats(ctx, { skillId: delta.skillId, now: occurredAt, downloads: 1 })
      }
      for (const occurredAt of delta.installNewEvents) {
        await bumpDailySkillStats(ctx, { skillId: delta.skillId, now: occurredAt, installs: 1 })
      }
    }

    // Update cursor position (upsert)
    const existingCursor = await ctx.db
      .query('skillStatUpdateCursors')
      .withIndex('by_key', (q) => q.eq('key', CURSOR_KEY))
      .unique()

    if (existingCursor) {
      await ctx.db.patch(existingCursor._id, {
        cursorCreationTime: args.newCursor,
        updatedAt: now,
      })
    } else {
      await ctx.db.insert('skillStatUpdateCursors', {
        key: CURSOR_KEY,
        cursorCreationTime: args.newCursor,
        updatedAt: now,
      })
    }

    return { skillsUpdated: args.skillDeltas.length }
  },
})

/**
 * Action that processes skill stat events in batches outside the transaction window.
 *
 * Algorithm:
 * 1. Get current cursor position
 * 2. Fetch events in batches of 500, aggregating as we go
 * 3. Stop when we have >= 500 unique skills OR run out of events
 * 4. Call mutation to apply all deltas and update cursor atomically
 * 5. Self-schedule if we stopped due to skill limit (not exhaustion)
 */
export const processSkillStatEventsAction = internalAction({
  args: {},
  handler: async (ctx) => {
    // Get current cursor position (convert null to undefined for consistency)
    const cursorResult = await ctx.runQuery(internal.skillStatEvents.getStatEventCursor)
    let cursor: number | undefined = cursorResult ?? undefined

    console.log(`[STAT-AGG] Starting aggregation, cursor=${cursor ?? 'none'}`)

    // Aggregated deltas per skill
    const aggregatedBySkill = new Map<
      Id<'skills'>,
      {
        downloads: number
        stars: number
        comments: number
        installsAllTime: number
        installsCurrent: number
        downloadEvents: number[]
        installNewEvents: number[]
      }
    >()

    let maxCreationTime: number | undefined = cursor
    let exhausted = false
    let totalEventsFetched = 0

    // Fetch and aggregate until we have enough skills or run out of events
    while (aggregatedBySkill.size < MAX_SKILLS_PER_RUN) {
      const events = await ctx.runQuery(internal.skillStatEvents.getUnprocessedEventBatch, {
        cursorCreationTime: cursor,
        limit: EVENT_BATCH_SIZE,
      })

      if (events.length === 0) {
        exhausted = true
        break
      }

      totalEventsFetched += events.length
      const skillsBefore = aggregatedBySkill.size

      // Aggregate events into per-skill deltas
      for (const event of events) {
        let skillDelta = aggregatedBySkill.get(event.skillId)
        if (!skillDelta) {
          skillDelta = {
            downloads: 0,
            stars: 0,
            comments: 0,
            installsAllTime: 0,
            installsCurrent: 0,
            downloadEvents: [],
            installNewEvents: [],
          }
          aggregatedBySkill.set(event.skillId, skillDelta)
        }

        // Apply event to aggregated deltas
        switch (event.kind) {
          case 'download':
            skillDelta.downloads += 1
            skillDelta.downloadEvents.push(event.occurredAt)
            break
          case 'star':
            skillDelta.stars += 1
            break
          case 'unstar':
            skillDelta.stars -= 1
            break
          case 'comment':
            skillDelta.comments += 1
            break
          case 'uncomment':
            skillDelta.comments -= 1
            break
          case 'install_new':
            skillDelta.installsAllTime += 1
            skillDelta.installsCurrent += 1
            skillDelta.installNewEvents.push(event.occurredAt)
            break
          case 'install_reactivate':
            skillDelta.installsCurrent += 1
            break
          case 'install_deactivate':
            skillDelta.installsCurrent -= 1
            break
          case 'install_clear':
            if (event.delta) {
              skillDelta.installsAllTime += event.delta.allTime
              skillDelta.installsCurrent += event.delta.current
            }
            break
        }

        // Track highest _creationTime seen
        if (maxCreationTime === undefined || event._creationTime > maxCreationTime) {
          maxCreationTime = event._creationTime
        }
      }

      // Update cursor for next batch fetch
      cursor = events[events.length - 1]._creationTime

      console.log(
        `[STAT-AGG] Fetched ${events.length} events, ${aggregatedBySkill.size - skillsBefore} new skills (${aggregatedBySkill.size} total)`,
      )

      // If we got fewer than requested, we've exhausted the events
      if (events.length < EVENT_BATCH_SIZE) {
        exhausted = true
        break
      }
    }

    // If we have nothing to process, we're done
    if (aggregatedBySkill.size === 0 || maxCreationTime === undefined) {
      console.log('[STAT-AGG] No events to process, done')
      return { processed: 0, skillsUpdated: 0, exhausted: true }
    }

    // Convert map to array for mutation
    const skillDeltas = Array.from(aggregatedBySkill.entries()).map(([skillId, delta]) => ({
      skillId,
      ...delta,
    }))

    console.log(
      `[STAT-AGG] Running mutation for ${skillDeltas.length} skills (${totalEventsFetched} total events)`,
    )

    // Apply all deltas and update cursor atomically
    await ctx.runMutation(internal.skillStatEvents.applyAggregatedStatsAndUpdateCursor, {
      skillDeltas,
      newCursor: maxCreationTime,
    })

    // Self-schedule if we stopped because of skill limit, not exhaustion
    if (!exhausted) {
      console.log('[STAT-AGG] More events remaining, self-scheduling')
      await ctx.scheduler.runAfter(0, internal.skillStatEvents.processSkillStatEventsAction, {})
    } else {
      console.log('[STAT-AGG] All events processed, done')
    }

    return {
      skillsUpdated: skillDeltas.length,
      exhausted,
    }
  },
})
