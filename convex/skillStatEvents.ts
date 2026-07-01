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

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { toDayKey } from "./lib/leaderboards";
import { applySkillStatDeltas, bumpDailySkillStats } from "./lib/skillStats";
import { adjustUserSkillStatsForSkillChange } from "./lib/userSkillStats";

/**
 * Event types that affect skill stats:
 *
 * - download: User downloaded skill as zip (+1 downloads)
 * - star/unstar: legacy queued events; star rows now update counts synchronously
 * - comment/uncomment: retired comment events; retained as no-op compatibility for old rows
 * - install_new: First time this user installed this skill (+1 installsAllTime, +1 installsCurrent)
 * - install_reactivate: User re-added skill after removing it (+1 installsCurrent only)
 * - install_deactivate: User removed skill from all projects (-1 installsCurrent)
 * - install_clear: User cleared all telemetry data (custom delta for both allTime and current)
 */
export type StatEventKind =
  | "download"
  | "star"
  | "unstar"
  | "comment"
  | "uncomment"
  | "install_new"
  | "install_reactivate"
  | "install_deactivate"
  | "install_clear";

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
    skillId: Id<"skills">;
    kind: StatEventKind;
    occurredAt?: number;
    delta?: { allTime: number; current: number };
  },
) {
  await ctx.db.insert("skillStatEvents", {
    skillId: params.skillId,
    kind: params.kind,
    delta: params.delta,
    occurredAt: params.occurredAt ?? Date.now(),
    processedAt: undefined,
  });
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
  downloads: number;
  stars: number;
  installsAllTime: number;
  installsCurrent: number;
  /** Original timestamps for each download event (for daily stats bucketing) */
  downloadEvents: number[];
  /** Original timestamps for each new install event (for daily stats bucketing) */
  installNewEvents: number[];
};

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
function aggregateEvents(events: Doc<"skillStatEvents">[]): AggregatedDeltas {
  const result: AggregatedDeltas = {
    downloads: 0,
    stars: 0,
    installsAllTime: 0,
    installsCurrent: 0,
    downloadEvents: [],
    installNewEvents: [],
  };

  for (const event of events) {
    switch (event.kind) {
      case "download":
        result.downloads += 1;
        result.downloadEvents.push(event.occurredAt);
        break;
      case "star":
        // Star counts are updated synchronously from `stars` mutations now.
        // Historical queued star events are marked processed without changing stats.
        break;
      case "unstar":
        // See `star` above.
        break;
      case "comment":
      case "uncomment":
        // Skill comments are retired. Keep old rows schema-valid and mark
        // them processed without changing historical `stats.comments`.
        break;
      case "install_new":
        // New user installing for the first time: count toward both lifetime and current
        result.installsAllTime += 1;
        result.installsCurrent += 1;
        result.installNewEvents.push(event.occurredAt);
        break;
      case "install_reactivate":
        // User re-added skill after removing: only affects current count
        result.installsCurrent += 1;
        break;
      case "install_deactivate":
        // User removed skill from all projects: only affects current count
        result.installsCurrent -= 1;
        break;
      case "install_clear":
        // User cleared telemetry: uses custom delta values (typically negative)
        if (event.delta) {
          result.installsAllTime += event.delta.allTime;
          result.installsCurrent += event.delta.current;
        }
        break;
    }
  }

  return result;
}

const DOC_SYNC_LEASE_KEY = "skill_doc_stat_sync";
const DOC_SYNC_LEASE_MS = 2 * 60 * 1_000;
const DEFAULT_DOC_SYNC_BATCH_SIZE = 100;
const MAX_DOC_SYNC_BATCH_SIZE = 100;
const DEFAULT_DOC_SYNC_MAX_BATCHES = 5;
const MAX_DOC_SYNC_MAX_BATCHES = 5;
const MAX_DOC_SYNC_FAILURE_RETRIES = 3;
const DOC_SYNC_FAILURE_RETRY_BASE_MS = 30_000;
export const PROCESSED_SKILL_STAT_EVENT_PRUNE_CONFIRMATION_TOKEN =
  "PRUNE_PROCESSED_SKILL_STAT_EVENTS";
const DEFAULT_PROCESSED_EVENT_RETENTION_DAYS = 7;
const MIN_PROCESSED_EVENT_RETENTION_DAYS = 1;
const MAX_PROCESSED_EVENT_RETENTION_DAYS = 90;
const DEFAULT_PROCESSED_EVENT_PRUNE_BATCH_SIZE = 1_000;
const MAX_PROCESSED_EVENT_PRUNE_BATCH_SIZE = 3_000;
const DEFAULT_PROCESSED_EVENT_PRUNE_MAX_BATCHES = 20;
const MAX_PROCESSED_EVENT_PRUNE_MAX_BATCHES = 100;

type ClaimSkillStatDocSyncLeaseResult =
  | {
      acquired: true;
      leaseOwner: string;
      leaseExpiresAt: number;
      now: number;
    }
  | {
      acquired: false;
      leaseOwner: string;
      leaseExpiresAt: number;
      now: number;
    };

type SkillStatDocSyncBatchResult = {
  processed: number;
  skillsUpdated: number;
  hasMore: boolean;
  skipped?: "lease_lost";
};

type SkillStatDocSyncActionResult =
  | {
      acquired: false;
      processed: number;
      skillsUpdated: number;
      scheduledContinuation: false;
      leaseExpiresAt: number;
      now: number;
    }
  | {
      acquired: true;
      processed: number;
      skillsUpdated: number;
      batches: number;
      stoppedReason: "empty" | "max_batches" | "lease_lost" | "error";
      scheduledContinuation: boolean;
      error?: string;
    };

type ProcessedSkillStatEventPruneBatchResult = {
  cutoffProcessedAt: number;
  minProcessedAt: number | null;
  maxProcessedAt: number | null;
  dryRun: boolean;
  matched: number;
  deleted: number;
  hasMore: boolean;
};

type ProcessedSkillStatEventPruneResult = {
  cutoffProcessedAt: number;
  minProcessedAt: number | null;
  maxProcessedAt: number | null;
  retentionCutoffProcessedAt: number;
  dailyStatsCursorCreationTime: number | null;
  retentionDays: number;
  dryRun: boolean;
  batches: number;
  matched: number;
  deleted: number;
  stoppedReason: "empty" | "max_batches" | "cursor_not_ready";
  scheduledContinuation: boolean;
};

const DEFAULT_SKILL_STAT_EVENT_SURVIVOR_COUNT_PAGE_SIZE = 5_000;
const MAX_SKILL_STAT_EVENT_SURVIVOR_COUNT_PAGE_SIZE = 10_000;
const DEFAULT_SKILL_STAT_EVENT_SURVIVOR_COUNT_MAX_PAGES = 2_000;

type SkillStatEventSurvivorCountPage = {
  count: number;
  scanned: number;
  isDone: boolean;
  continueCursor: string | null;
};

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(Math.floor(value), max));
}

function normalizeDocSyncBatchSize(batchSize: number | undefined) {
  return clampInt(batchSize ?? DEFAULT_DOC_SYNC_BATCH_SIZE, 1, MAX_DOC_SYNC_BATCH_SIZE);
}

function normalizeDocSyncDrainBatchSize(batchSize: number | undefined) {
  return clampInt(batchSize ?? DEFAULT_DOC_SYNC_BATCH_SIZE, 1, MAX_DOC_SYNC_BATCH_SIZE);
}

function normalizeDocSyncMaxBatches(maxBatches: number | undefined) {
  return clampInt(maxBatches ?? DEFAULT_DOC_SYNC_MAX_BATCHES, 1, MAX_DOC_SYNC_MAX_BATCHES);
}

function normalizeDocSyncRetryCount(retryCount: number | undefined) {
  return clampInt(retryCount ?? 0, 0, MAX_DOC_SYNC_FAILURE_RETRIES);
}

function nextDocSyncRetryBatchSize(batchSize: number) {
  return Math.max(1, Math.floor(batchSize / 2));
}

function docSyncRetryDelayMs(retryCount: number) {
  return DOC_SYNC_FAILURE_RETRY_BASE_MS * 2 ** retryCount;
}

function formatDocSyncError(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function normalizeProcessedEventRetentionDays(retentionDays: number | undefined) {
  return clampInt(
    retentionDays ?? DEFAULT_PROCESSED_EVENT_RETENTION_DAYS,
    MIN_PROCESSED_EVENT_RETENTION_DAYS,
    MAX_PROCESSED_EVENT_RETENTION_DAYS,
  );
}

function normalizeProcessedEventPruneBatchSize(batchSize: number | undefined) {
  return clampInt(
    batchSize ?? DEFAULT_PROCESSED_EVENT_PRUNE_BATCH_SIZE,
    1,
    MAX_PROCESSED_EVENT_PRUNE_BATCH_SIZE,
  );
}

function normalizeProcessedEventPruneMaxBatches(maxBatches: number | undefined) {
  return clampInt(
    maxBatches ?? DEFAULT_PROCESSED_EVENT_PRUNE_MAX_BATCHES,
    1,
    MAX_PROCESSED_EVENT_PRUNE_MAX_BATCHES,
  );
}

function normalizeSkillStatEventSurvivorCountPageSize(pageSize: number | undefined) {
  return clampInt(
    pageSize ?? DEFAULT_SKILL_STAT_EVENT_SURVIVOR_COUNT_PAGE_SIZE,
    1,
    MAX_SKILL_STAT_EVENT_SURVIVOR_COUNT_PAGE_SIZE,
  );
}

function normalizeSkillStatEventSurvivorCountMaxPages(maxPages: number | undefined) {
  return Math.max(1, Math.floor(maxPages ?? DEFAULT_SKILL_STAT_EVENT_SURVIVOR_COUNT_MAX_PAGES));
}

export const claimSkillStatDocSyncLeaseInternal = internalMutation({
  args: { leaseMs: v.optional(v.number()) },
  handler: async (ctx, args): Promise<ClaimSkillStatDocSyncLeaseResult> => {
    const now = Date.now();
    const leaseMs = clampInt(args.leaseMs ?? DOC_SYNC_LEASE_MS, 30_000, 10 * 60 * 1_000);
    const existing = await ctx.db
      .query("skillStatDocSyncLeases")
      .withIndex("by_key", (q) => q.eq("key", DOC_SYNC_LEASE_KEY))
      .unique();

    if (existing && existing.leaseExpiresAt > now) {
      return {
        acquired: false as const,
        leaseOwner: existing.leaseOwner,
        leaseExpiresAt: existing.leaseExpiresAt,
        now,
      };
    }

    const leaseOwner = `${now}`;
    const patch = {
      leaseOwner,
      leaseExpiresAt: now + leaseMs,
      updatedAt: now,
      lastStartedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("skillStatDocSyncLeases", {
        key: DOC_SYNC_LEASE_KEY,
        ...patch,
      });
    }

    return {
      acquired: true as const,
      leaseOwner,
      leaseExpiresAt: now + leaseMs,
      now,
    };
  },
});

export const releaseSkillStatDocSyncLeaseInternal = internalMutation({
  args: {
    leaseOwner: v.string(),
    processed: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const lease = await ctx.db
      .query("skillStatDocSyncLeases")
      .withIndex("by_key", (q) => q.eq("key", DOC_SYNC_LEASE_KEY))
      .unique();

    if (!lease || lease.leaseOwner !== args.leaseOwner) {
      return { released: false as const };
    }

    const error = args.error?.slice(0, 2_000);
    await ctx.db.patch(lease._id, {
      leaseExpiresAt: now,
      updatedAt: now,
      lastFinishedAt: now,
      lastProcessedCount: args.processed ?? lease.lastProcessedCount,
      lastError: error,
      lastErrorAt: error ? now : undefined,
      lastErrorProcessedCount: error ? (args.processed ?? 0) : undefined,
    });

    return { released: true as const };
  },
});

/**
 * Process a batch of unprocessed stat events.
 *
 * Called by the leased action drain to sync stats to skill docs. Processes up to
 * batchSize events. The committed lease check keeps overlapping cron/manual
 * kicks from doing the same heavy work before Convex's OCC retry machinery
 * chooses a winner.
 *
 * Processing steps:
 * 1. Verify the committed lease owner
 * 2. Query unprocessed events (processedAt is undefined)
 * 3. Group events by skillId to minimize skill document fetches
 * 4. For each skill:
 *    a. Fetch the skill document once
 *    b. Aggregate all events for this skill into net deltas
 *    c. Apply deltas to skill stats (downloads, stars, installs)
 *    d. Mark all events as processed
 *
 * Aggregation levels:
 * - Level 1: Batch of 100 events from the queue
 * - Level 2: Group by skillId (e.g., 100 events → 30 unique skills)
 * - Level 3: Aggregate events per skill (e.g., 5 events → 1 skill update)
 */
export const processSkillStatEventBatchInternal = internalMutation({
  args: { batchSize: v.optional(v.number()), leaseOwner: v.string() },
  handler: async (ctx, args): Promise<SkillStatDocSyncBatchResult> => {
    const batchSize = normalizeDocSyncBatchSize(args.batchSize);
    const now = Date.now();
    const lease = await ctx.db
      .query("skillStatDocSyncLeases")
      .withIndex("by_key", (q) => q.eq("key", DOC_SYNC_LEASE_KEY))
      .unique();

    if (!lease || lease.leaseOwner !== args.leaseOwner || lease.leaseExpiresAt <= now) {
      return {
        processed: 0,
        skillsUpdated: 0,
        hasMore: false,
        skipped: "lease_lost" as const,
      };
    }

    // Level 1: Fetch a batch of unprocessed events
    const events = await ctx.db
      .query("skillStatEvents")
      .withIndex("by_unprocessed", (q) => q.eq("processedAt", undefined))
      .take(batchSize);

    if (events.length === 0) {
      return { processed: 0, skillsUpdated: 0, hasMore: false };
    }

    // Level 2: Group events by skillId to minimize database reads
    // Instead of fetching the same skill document multiple times,
    // we fetch it once and process all its events together
    const eventsBySkill = new Map<Id<"skills">, Doc<"skillStatEvents">[]>();
    for (const event of events) {
      const existing = eventsBySkill.get(event.skillId) ?? [];
      existing.push(event);
      eventsBySkill.set(event.skillId, existing);
    }

    // Process each skill's events
    let skillsUpdated = 0;
    for (const [skillId, skillEvents] of eventsBySkill) {
      const skill = await ctx.db.get(skillId);

      // Skill was deleted - just mark events as processed
      if (!skill) {
        for (const event of skillEvents) {
          await ctx.db.patch(event._id, { processedAt: now });
        }
        continue;
      }

      // Level 3: Aggregate all events for this skill into net deltas
      // e.g., 3 downloads + 2 stars - 1 unstar → { downloads: 3, stars: 1 }
      const deltas = aggregateEvents(skillEvents);

      // Apply aggregated deltas to skill stats (single update per skill)
      if (
        deltas.downloads !== 0 ||
        deltas.stars !== 0 ||
        deltas.installsAllTime !== 0 ||
        deltas.installsCurrent !== 0
      ) {
        const patch = applySkillStatDeltas(skill, {
          downloads: deltas.downloads,
          stars: deltas.stars,
          installsAllTime: deltas.installsAllTime,
          installsCurrent: deltas.installsCurrent,
        });
        // Don't update `updatedAt` — stat changes shouldn't move the
        // skill's position in the by_active_updated index.
        await ctx.db.patch(skill._id, patch);
        await adjustUserSkillStatsForSkillChange(ctx, skill, { ...skill, ...patch });
        skillsUpdated += 1;
      }

      // NOTE: Daily stats (skillDailyStats) are written by the 15-minute
      // action cron (processSkillStatEventsAction), not here.

      // Mark all events for this skill as processed
      for (const event of skillEvents) {
        await ctx.db.patch(event._id, { processedAt: now });
      }
    }

    await ctx.db.patch(lease._id, {
      leaseExpiresAt: now + DOC_SYNC_LEASE_MS,
      updatedAt: now,
      lastProcessedAt: now,
      lastProcessedCount: events.length,
    });

    return {
      processed: events.length,
      skillsUpdated,
      hasMore: events.length === batchSize,
    };
  },
});

/**
 * Leased skill-document stat sync drain.
 *
 * This action is the cron/manual entrypoint. It commits a lease before doing
 * batch work so concurrent scheduled runs skip quickly instead of processing
 * the same first unprocessed rows and relying on OCC to throw one away.
 */
export const processSkillStatEventsInternal: ReturnType<typeof internalAction> = internalAction({
  args: {
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SkillStatDocSyncActionResult> => {
    const batchSize = normalizeDocSyncDrainBatchSize(args.batchSize);
    const maxBatches = normalizeDocSyncMaxBatches(args.maxBatches);
    const retryCount = normalizeDocSyncRetryCount(args.retryCount);
    const claim: ClaimSkillStatDocSyncLeaseResult = await ctx.runMutation(
      internal.skillStatEvents.claimSkillStatDocSyncLeaseInternal,
      {
        leaseMs: DOC_SYNC_LEASE_MS,
      },
    );

    if (!claim.acquired) {
      return {
        acquired: false as const,
        processed: 0,
        skillsUpdated: 0,
        scheduledContinuation: false,
        leaseExpiresAt: claim.leaseExpiresAt,
        now: claim.now,
      };
    }

    let processed = 0;
    let skillsUpdated = 0;
    let batches = 0;
    let hasMore = false;
    let stoppedReason: "empty" | "max_batches" | "lease_lost" | "error" = "empty";

    try {
      for (let index = 0; index < maxBatches; index += 1) {
        const batch: SkillStatDocSyncBatchResult = await ctx.runMutation(
          internal.skillStatEvents.processSkillStatEventBatchInternal,
          {
            batchSize,
            leaseOwner: claim.leaseOwner,
          },
        );

        if (batch.skipped === "lease_lost") {
          stoppedReason = "lease_lost";
          hasMore = false;
          break;
        }

        batches += 1;
        processed += batch.processed;
        skillsUpdated += batch.skillsUpdated;
        hasMore = batch.hasMore;

        if (!batch.hasMore) {
          stoppedReason = "empty";
          break;
        }

        stoppedReason = "max_batches";
      }
    } catch (error) {
      const errorMessage = formatDocSyncError(error);
      stoppedReason = "error";
      await ctx.runMutation(internal.skillStatEvents.releaseSkillStatDocSyncLeaseInternal, {
        leaseOwner: claim.leaseOwner,
        processed,
        error: errorMessage,
      });

      const shouldRetry = retryCount < MAX_DOC_SYNC_FAILURE_RETRIES;
      if (shouldRetry) {
        await ctx.scheduler.runAfter(
          docSyncRetryDelayMs(retryCount),
          internal.skillStatEvents.processSkillStatEventsInternal,
          {
            batchSize: nextDocSyncRetryBatchSize(batchSize),
            maxBatches: 1,
            retryCount: retryCount + 1,
          },
        );
      }

      return {
        acquired: true as const,
        processed,
        skillsUpdated,
        batches,
        stoppedReason,
        scheduledContinuation: shouldRetry,
        error: errorMessage,
      };
    }

    await ctx.runMutation(internal.skillStatEvents.releaseSkillStatDocSyncLeaseInternal, {
      leaseOwner: claim.leaseOwner,
      processed,
    });

    if (hasMore && stoppedReason === "max_batches") {
      await ctx.scheduler.runAfter(0, internal.skillStatEvents.processSkillStatEventsInternal, {
        batchSize,
        maxBatches,
        retryCount: 0,
      });
    }

    return {
      acquired: true as const,
      processed,
      skillsUpdated,
      batches,
      stoppedReason,
      scheduledContinuation: hasMore && stoppedReason === "max_batches",
    };
  },
});

export const kickSkillStatDocSyncInternal = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = normalizeDocSyncDrainBatchSize(args.batchSize);
    const maxBatches = normalizeDocSyncMaxBatches(args.maxBatches);
    await ctx.scheduler.runAfter(0, internal.skillStatEvents.processSkillStatEventsInternal, {
      batchSize,
      maxBatches,
    });
    return { ok: true as const, batchSize, maxBatches };
  },
});

export const getSkillStatDocSyncStatusInternal = internalQuery({
  args: { sampleLimit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sampleLimit = clampInt(args.sampleLimit ?? 1_000, 1, 10_000);
    const events = await ctx.db
      .query("skillStatEvents")
      .withIndex("by_unprocessed", (q) => q.eq("processedAt", undefined))
      .take(sampleLimit);
    const lease = await ctx.db
      .query("skillStatDocSyncLeases")
      .withIndex("by_key", (q) => q.eq("key", DOC_SYNC_LEASE_KEY))
      .unique();

    return {
      hasPending: events.length > 0,
      samplePendingCount: events.length,
      sampleLimit,
      sampledToLimit: events.length === sampleLimit,
      oldestPendingAt: events[0]?.occurredAt,
      newestPendingAt: events[events.length - 1]?.occurredAt,
      lease: lease
        ? {
            active: lease.leaseExpiresAt > now,
            leaseExpiresAt: lease.leaseExpiresAt,
            lastStartedAt: lease.lastStartedAt,
            lastFinishedAt: lease.lastFinishedAt,
            lastProcessedAt: lease.lastProcessedAt,
            lastProcessedCount: lease.lastProcessedCount,
            lastError: lease.lastError,
            lastErrorAt: lease.lastErrorAt,
            lastErrorProcessedCount: lease.lastErrorProcessedCount,
          }
        : null,
      now,
    };
  },
});

export const countUnprocessedSkillStatEventSurvivorPageInternal = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SkillStatEventSurvivorCountPage> => {
    const page = await ctx.db
      .query("skillStatEvents")
      .withIndex("by_unprocessed", (q) => q.eq("processedAt", undefined))
      .paginate({
        cursor: args.cursor,
        numItems: normalizeSkillStatEventSurvivorCountPageSize(args.pageSize),
      });

    return {
      count: page.page.length,
      scanned: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const countProcessedRecentSkillStatEventSurvivorPageInternal = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    creationTimeLowerBound: v.number(),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SkillStatEventSurvivorCountPage> => {
    const page = await ctx.db
      .query("skillStatEvents")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", args.creationTimeLowerBound))
      .paginate({
        cursor: args.cursor,
        numItems: normalizeSkillStatEventSurvivorCountPageSize(args.pageSize),
      });
    const processedRecent = page.page.filter((event) => event.processedAt !== undefined);

    return {
      count: processedRecent.length,
      scanned: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const countSkillStatEventImportSurvivorsInternal: ReturnType<typeof internalAction> =
  internalAction({
    args: {
      pageSize: v.optional(v.number()),
      maxPages: v.optional(v.number()),
      recentWindowMs: v.optional(v.number()),
      unprocessedCursor: v.optional(v.union(v.string(), v.null())),
      processedRecentCursor: v.optional(v.union(v.string(), v.null())),
    },
    handler: async (ctx, args) => {
      const pageSize = normalizeSkillStatEventSurvivorCountPageSize(args.pageSize);
      const maxPages = normalizeSkillStatEventSurvivorCountMaxPages(args.maxPages);
      const dailyStatsCursorCreationTime = (await ctx.runQuery(
        internal.skillStatEvents.getStatEventCursor,
      )) as number | undefined;
      const recentCutoff =
        args.recentWindowMs === undefined
          ? Infinity
          : Date.now() - Math.max(0, args.recentWindowMs);
      const creationTimeLowerBound = Math.min(
        dailyStatsCursorCreationTime ?? Infinity,
        recentCutoff,
      );

      let pagesUsed = 0;
      let unprocessedCursor = args.unprocessedCursor ?? null;
      let processedRecentCursor = args.processedRecentCursor ?? null;
      let unprocessedCount = 0;
      let processedRecentCount = 0;
      let unprocessedScanned = 0;
      let processedRecentScanned = 0;
      let unprocessedDone = false;
      let processedRecentDone = creationTimeLowerBound === Infinity;

      while (pagesUsed < maxPages && !unprocessedDone) {
        const page = (await ctx.runQuery(
          internal.skillStatEvents.countUnprocessedSkillStatEventSurvivorPageInternal,
          { cursor: unprocessedCursor, pageSize },
        )) as SkillStatEventSurvivorCountPage;
        pagesUsed += 1;
        unprocessedCount += page.count;
        unprocessedScanned += page.scanned;
        unprocessedCursor = page.continueCursor;
        unprocessedDone = page.isDone;
      }

      while (pagesUsed < maxPages && !processedRecentDone) {
        const page = (await ctx.runQuery(
          internal.skillStatEvents.countProcessedRecentSkillStatEventSurvivorPageInternal,
          { cursor: processedRecentCursor, creationTimeLowerBound, pageSize },
        )) as SkillStatEventSurvivorCountPage;
        pagesUsed += 1;
        processedRecentCount += page.count;
        processedRecentScanned += page.scanned;
        processedRecentCursor = page.continueCursor;
        processedRecentDone = page.isDone;
      }

      return {
        survivorCount: unprocessedCount + processedRecentCount,
        unprocessedCount,
        processedRecentCount,
        unprocessedScanned,
        processedRecentScanned,
        dailyStatsCursorCreationTime: dailyStatsCursorCreationTime ?? null,
        creationTimeLowerBound: creationTimeLowerBound === Infinity ? null : creationTimeLowerBound,
        pageSize,
        pagesUsed,
        maxPages,
        isDone: unprocessedDone && processedRecentDone,
        unprocessedCursor: unprocessedDone ? null : unprocessedCursor,
        processedRecentCursor: processedRecentDone ? null : processedRecentCursor,
      };
    },
  });

export const pruneProcessedSkillStatEventBatchInternal = internalMutation({
  args: {
    cutoffProcessedAt: v.number(),
    dryRun: v.boolean(),
    batchSize: v.optional(v.number()),
    minProcessedAt: v.optional(v.number()),
    maxProcessedAt: v.optional(v.number()),
    confirmationToken: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ProcessedSkillStatEventPruneBatchResult> => {
    if (
      !args.dryRun &&
      args.confirmationToken !== PROCESSED_SKILL_STAT_EVENT_PRUNE_CONFIRMATION_TOKEN
    ) {
      throw new Error(
        `Apply requires confirmationToken=${PROCESSED_SKILL_STAT_EVENT_PRUNE_CONFIRMATION_TOKEN}`,
      );
    }

    const batchSize = normalizeProcessedEventPruneBatchSize(args.batchSize);
    const minProcessedAt = args.minProcessedAt;
    const cutoffProcessedAt = Math.min(args.cutoffProcessedAt, args.maxProcessedAt ?? Infinity);

    if (
      cutoffProcessedAt <= 0 ||
      (minProcessedAt !== undefined && cutoffProcessedAt <= minProcessedAt)
    ) {
      return {
        cutoffProcessedAt,
        minProcessedAt: minProcessedAt ?? null,
        maxProcessedAt: args.maxProcessedAt ?? null,
        dryRun: args.dryRun,
        matched: 0,
        deleted: 0,
        hasMore: false,
      };
    }

    const events = await ctx.db
      .query("skillStatEvents")
      .withIndex("by_unprocessed", (q) => {
        const lowerBound =
          minProcessedAt === undefined
            ? q.gt("processedAt", 0)
            : q.gte("processedAt", minProcessedAt);
        return lowerBound.lt("processedAt", cutoffProcessedAt);
      })
      .take(batchSize);

    if (!args.dryRun) {
      for (const event of events) {
        await ctx.db.delete(event._id);
      }
    }

    return {
      cutoffProcessedAt,
      minProcessedAt: minProcessedAt ?? null,
      maxProcessedAt: args.maxProcessedAt ?? null,
      dryRun: args.dryRun,
      matched: events.length,
      deleted: args.dryRun ? 0 : events.length,
      hasMore: events.length === batchSize,
    };
  },
});

export const pruneProcessedSkillStatEventsInternal: ReturnType<typeof internalAction> =
  internalAction({
    args: {
      dryRun: v.optional(v.boolean()),
      retentionDays: v.optional(v.number()),
      batchSize: v.optional(v.number()),
      maxBatches: v.optional(v.number()),
      minProcessedAt: v.optional(v.number()),
      maxProcessedAt: v.optional(v.number()),
      confirmationToken: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<ProcessedSkillStatEventPruneResult> => {
      const dryRun = args.dryRun ?? false;
      const retentionDays = normalizeProcessedEventRetentionDays(args.retentionDays);
      const batchSize = normalizeProcessedEventPruneBatchSize(args.batchSize);
      const maxBatches = normalizeProcessedEventPruneMaxBatches(args.maxBatches);
      const retentionCutoffProcessedAt = Date.now() - retentionDays * 24 * 60 * 60 * 1_000;
      const dailyStatsCursorCreationTime = (await ctx.runQuery(
        internal.skillStatEvents.getStatEventCursor,
      )) as number | undefined;
      const cutoffProcessedAt = Math.min(
        retentionCutoffProcessedAt,
        dailyStatsCursorCreationTime ?? 0,
        args.maxProcessedAt ?? Infinity,
      );

      if (cutoffProcessedAt <= 0) {
        return {
          cutoffProcessedAt,
          minProcessedAt: args.minProcessedAt ?? null,
          maxProcessedAt: args.maxProcessedAt ?? null,
          retentionCutoffProcessedAt,
          dailyStatsCursorCreationTime: dailyStatsCursorCreationTime ?? null,
          retentionDays,
          dryRun,
          batches: 0,
          matched: 0,
          deleted: 0,
          stoppedReason: "cursor_not_ready",
          scheduledContinuation: false,
        };
      }

      if (args.minProcessedAt !== undefined && cutoffProcessedAt <= args.minProcessedAt) {
        return {
          cutoffProcessedAt,
          minProcessedAt: args.minProcessedAt,
          maxProcessedAt: args.maxProcessedAt ?? null,
          retentionCutoffProcessedAt,
          dailyStatsCursorCreationTime: dailyStatsCursorCreationTime ?? null,
          retentionDays,
          dryRun,
          batches: 0,
          matched: 0,
          deleted: 0,
          stoppedReason: "empty",
          scheduledContinuation: false,
        };
      }

      let batches = 0;
      let matched = 0;
      let deleted = 0;
      let hasMore = false;
      let stoppedReason: "empty" | "max_batches" | "cursor_not_ready" = "empty";
      const batchLimit = dryRun ? 1 : maxBatches;

      for (let index = 0; index < batchLimit; index += 1) {
        const batch = (await ctx.runMutation(
          internal.skillStatEvents.pruneProcessedSkillStatEventBatchInternal,
          {
            cutoffProcessedAt,
            dryRun,
            batchSize,
            minProcessedAt: args.minProcessedAt,
            maxProcessedAt: args.maxProcessedAt,
            confirmationToken: args.confirmationToken,
          },
        )) as ProcessedSkillStatEventPruneBatchResult;

        batches += 1;
        matched += batch.matched;
        deleted += batch.deleted;
        hasMore = batch.hasMore;

        if (!batch.hasMore) {
          stoppedReason = "empty";
          break;
        }

        stoppedReason = "max_batches";
      }

      if (!dryRun && hasMore && stoppedReason === "max_batches") {
        await ctx.scheduler.runAfter(
          0,
          internal.skillStatEvents.pruneProcessedSkillStatEventsInternal,
          {
            dryRun,
            retentionDays,
            batchSize,
            maxBatches,
            minProcessedAt: args.minProcessedAt,
            maxProcessedAt: args.maxProcessedAt,
            confirmationToken: args.confirmationToken,
          },
        );
      }

      return {
        cutoffProcessedAt,
        minProcessedAt: args.minProcessedAt ?? null,
        maxProcessedAt: args.maxProcessedAt ?? null,
        retentionCutoffProcessedAt,
        dailyStatsCursorCreationTime: dailyStatsCursorCreationTime ?? null,
        retentionDays,
        dryRun,
        batches,
        matched,
        deleted,
        stoppedReason,
        scheduledContinuation: !dryRun && hasMore && stoppedReason === "max_batches",
      };
    },
  });

export const kickProcessedSkillStatEventPruneInternal = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    retentionDays: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    minProcessedAt: v.optional(v.number()),
    maxProcessedAt: v.optional(v.number()),
    confirmationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    if (!dryRun && args.confirmationToken !== PROCESSED_SKILL_STAT_EVENT_PRUNE_CONFIRMATION_TOKEN) {
      throw new Error(
        `Apply requires confirmationToken=${PROCESSED_SKILL_STAT_EVENT_PRUNE_CONFIRMATION_TOKEN}`,
      );
    }

    const retentionDays = normalizeProcessedEventRetentionDays(args.retentionDays);
    const batchSize = normalizeProcessedEventPruneBatchSize(args.batchSize);
    const maxBatches = normalizeProcessedEventPruneMaxBatches(args.maxBatches);
    await ctx.scheduler.runAfter(
      0,
      internal.skillStatEvents.pruneProcessedSkillStatEventsInternal,
      {
        dryRun,
        retentionDays,
        batchSize,
        maxBatches,
        minProcessedAt: args.minProcessedAt,
        maxProcessedAt: args.maxProcessedAt,
        confirmationToken: args.confirmationToken,
      },
    );
    return { ok: true as const, dryRun, retentionDays, batchSize, maxBatches };
  },
});

// ============================================================================
// Action-based processing (cursor-based, runs outside transaction window)
// ============================================================================

const CURSOR_KEY = "skill_stat_events";
const EVENT_BATCH_SIZE = 500;
const MAX_SKILLS_PER_RUN = 50;

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
    const limit = args.limit ?? EVENT_BATCH_SIZE;
    const cursor = args.cursorCreationTime;

    // Query events after the cursor using the built-in creation time index
    const events = await ctx.db
      .query("skillStatEvents")
      .withIndex("by_creation_time", (q) =>
        cursor !== undefined ? q.gt("_creationTime", cursor) : q,
      )
      .take(limit);
    return events;
  },
});

/**
 * Get the current cursor position from the cursors table.
 */
export const getStatEventCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cursor = await ctx.db
      .query("skillStatUpdateCursors")
      .withIndex("by_key", (q) => q.eq("key", CURSOR_KEY))
      .unique();
    return cursor?.cursorCreationTime;
  },
});

/**
 * Validator for skill deltas passed to the mutation.
 */
const skillDeltaValidator = v.object({
  skillId: v.id("skills"),
  downloads: v.number(),
  stars: v.number(),
  installsAllTime: v.number(),
  installsCurrent: v.number(),
  downloadEvents: v.array(v.number()),
  installNewEvents: v.array(v.number()),
});

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
    const now = Date.now();
    const dailyStats = new Map<
      string,
      { skillId: Id<"skills">; occurredAt: number; downloads: number; installs: number }
    >();

    for (const delta of args.skillDeltas) {
      for (const occurredAt of delta.downloadEvents) {
        const key = `${delta.skillId}:${toDayKey(occurredAt)}`;
        const current = dailyStats.get(key) ?? {
          skillId: delta.skillId,
          occurredAt,
          downloads: 0,
          installs: 0,
        };
        current.downloads += 1;
        dailyStats.set(key, current);
      }
      for (const occurredAt of delta.installNewEvents) {
        const key = `${delta.skillId}:${toDayKey(occurredAt)}`;
        const current = dailyStats.get(key) ?? {
          skillId: delta.skillId,
          occurredAt,
          downloads: 0,
          installs: 0,
        };
        current.installs += 1;
        dailyStats.set(key, current);
      }
    }

    for (const stat of dailyStats.values()) {
      await bumpDailySkillStats(ctx, {
        skillId: stat.skillId,
        now: stat.occurredAt,
        downloads: stat.downloads,
        installs: stat.installs,
      });
    }

    // Update cursor position (upsert)
    const existingCursor = await ctx.db
      .query("skillStatUpdateCursors")
      .withIndex("by_key", (q) => q.eq("key", CURSOR_KEY))
      .unique();

    if (existingCursor) {
      await ctx.db.patch(existingCursor._id, {
        cursorCreationTime: args.newCursor,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("skillStatUpdateCursors", {
        key: CURSOR_KEY,
        cursorCreationTime: args.newCursor,
        updatedAt: now,
      });
    }

    return { skillsUpdated: args.skillDeltas.length };
  },
});

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
    const cursorResult = await ctx.runQuery(internal.skillStatEvents.getStatEventCursor);
    let cursor: number | undefined = cursorResult ?? undefined;

    console.log(`[STAT-AGG] Starting aggregation, cursor=${cursor ?? "none"}`);

    // Aggregated deltas per skill
    const aggregatedBySkill = new Map<
      Id<"skills">,
      {
        downloads: number;
        stars: number;
        installsAllTime: number;
        installsCurrent: number;
        downloadEvents: number[];
        installNewEvents: number[];
      }
    >();

    let maxCreationTime: number | undefined = cursor;
    let exhausted = false;
    let totalEventsFetched = 0;

    // Fetch and aggregate until we have enough skills or run out of events
    while (aggregatedBySkill.size < MAX_SKILLS_PER_RUN) {
      const events = await ctx.runQuery(internal.skillStatEvents.getUnprocessedEventBatch, {
        cursorCreationTime: cursor,
        limit: EVENT_BATCH_SIZE,
      });

      if (events.length === 0) {
        exhausted = true;
        break;
      }

      totalEventsFetched += events.length;
      const skillsBefore = aggregatedBySkill.size;

      // Aggregate events into per-skill deltas
      for (const event of events) {
        let skillDelta = aggregatedBySkill.get(event.skillId);
        if (!skillDelta) {
          skillDelta = {
            downloads: 0,
            stars: 0,
            installsAllTime: 0,
            installsCurrent: 0,
            downloadEvents: [],
            installNewEvents: [],
          };
          aggregatedBySkill.set(event.skillId, skillDelta);
        }

        // Apply event to aggregated deltas
        switch (event.kind) {
          case "download":
            skillDelta.downloads += 1;
            skillDelta.downloadEvents.push(event.occurredAt);
            break;
          case "star":
            // Star counts are updated synchronously from `stars` mutations now.
            break;
          case "unstar":
            // Historical queued unstar events should not double-apply.
            break;
          case "comment":
          case "uncomment":
            // Skill comments are retired; old rows only advance the cursor.
            break;
          case "install_new":
            skillDelta.installsAllTime += 1;
            skillDelta.installsCurrent += 1;
            skillDelta.installNewEvents.push(event.occurredAt);
            break;
          case "install_reactivate":
            skillDelta.installsCurrent += 1;
            break;
          case "install_deactivate":
            skillDelta.installsCurrent -= 1;
            break;
          case "install_clear":
            if (event.delta) {
              skillDelta.installsAllTime += event.delta.allTime;
              skillDelta.installsCurrent += event.delta.current;
            }
            break;
        }

        // Track highest _creationTime seen
        if (maxCreationTime === undefined || event._creationTime > maxCreationTime) {
          maxCreationTime = event._creationTime;
        }
      }

      // Update cursor for next batch fetch
      cursor = events[events.length - 1]._creationTime;

      console.log(
        `[STAT-AGG] Fetched ${events.length} events, ${aggregatedBySkill.size - skillsBefore} new skills (${aggregatedBySkill.size} total)`,
      );

      // If we got fewer than requested, we've exhausted the events
      if (events.length < EVENT_BATCH_SIZE) {
        exhausted = true;
        break;
      }
    }

    // If we have nothing to process, we're done
    if (aggregatedBySkill.size === 0 || maxCreationTime === undefined) {
      console.log("[STAT-AGG] No events to process, done");
      return { processed: 0, skillsUpdated: 0, exhausted: true };
    }

    // Convert map to array for mutation
    const skillDeltas = Array.from(aggregatedBySkill.entries()).map(([skillId, delta]) => ({
      skillId,
      ...delta,
    }));

    console.log(
      `[STAT-AGG] Running mutation for ${skillDeltas.length} skills (${totalEventsFetched} total events)`,
    );

    // Apply all deltas and update cursor atomically
    await ctx.runMutation(internal.skillStatEvents.applyAggregatedStatsAndUpdateCursor, {
      skillDeltas,
      newCursor: maxCreationTime,
    });

    // Self-schedule if we stopped because of skill limit, not exhaustion
    if (!exhausted) {
      console.log("[STAT-AGG] More events remaining, self-scheduling");
      await ctx.scheduler.runAfter(0, internal.skillStatEvents.processSkillStatEventsAction, {});
    } else {
      console.log("[STAT-AGG] All events processed, done");
    }

    return {
      skillsUpdated: skillDeltas.length,
      exhausted,
    };
  },
});
