import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./functions";
import {
  assertSkillsShCatalogControlMutationAllowed,
  assertSkillsShFixtureEnvironmentAllowed,
  getSkillsShFixtureEnvironmentPolicy,
} from "./lib/skillsShCatalogEnvironment";
import {
  getSkillsShCatalogFixture,
  type SkillsShCatalogFixtureRow,
} from "./lib/skillsShCatalogFixtures";

const CONTROL_KEY = "global";
const ENABLE_FIXTURE_CONFIRM = "enable-skills-sh-fixture-control";
const DISABLE_CATALOG_CONFIRM = "disable-skills-sh-catalog";
const STATUS_LIMIT = 50;

const fixtureIdValidator = v.union(v.literal("nvidia-small-v1"), v.literal("nvidia-small-v2"));
const scanVerdictValidator = v.union(
  v.literal("clean"),
  v.literal("suspicious"),
  v.literal("malicious"),
  v.literal("failed"),
);

const DEFAULT_CONTROL = {
  mode: "off" as const,
  writesEnabled: false,
  scanPlanningEnabled: false,
  publicVisibilityEnabled: false,
  paused: true,
  maxEntriesPerRun: 0,
  maxWritesPerBatch: 0,
  maxPlannedScans: 0,
  updatedBy: null,
  reason: null,
  updatedAt: null,
};

function normalizeIdentity(row: SkillsShCatalogFixtureRow) {
  const owner = row.owner.trim().toLowerCase();
  const repo = row.repo.trim().toLowerCase();
  const slug = row.slug.trim().toLowerCase();
  return {
    ...row,
    owner,
    repo,
    slug,
    externalId: `${owner}/${repo}/${slug}`,
  };
}

async function getControlDoc(ctx: Pick<QueryCtx | MutationCtx, "db">) {
  return await ctx.db
    .query("skillsShCatalogControls")
    .withIndex("by_key", (q) => q.eq("key", CONTROL_KEY))
    .unique();
}

function summarizeControl(control: Doc<"skillsShCatalogControls"> | null) {
  if (!control) return DEFAULT_CONTROL;
  return {
    mode: control.mode,
    writesEnabled: control.writesEnabled,
    scanPlanningEnabled: control.scanPlanningEnabled,
    publicVisibilityEnabled: control.publicVisibilityEnabled,
    paused: control.paused,
    maxEntriesPerRun: control.maxEntriesPerRun,
    maxWritesPerBatch: control.maxWritesPerBatch,
    maxPlannedScans: control.maxPlannedScans,
    updatedBy: control.updatedBy,
    reason: control.reason,
    updatedAt: control.updatedAt,
  };
}

function assertIntegerInRange(name: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConvexError(`${name} must be an integer between ${min} and ${max}`);
  }
}

function assertFixtureWritesEnabled(control: Doc<"skillsShCatalogControls"> | null) {
  if (!control || control.mode !== "fixture" || !control.writesEnabled) {
    throw new ConvexError("skills.sh catalog writes are disabled");
  }
  if (control.paused) throw new ConvexError("skills.sh catalog is paused");
  return control;
}

export const configureFixtureControlInternal = internalMutation({
  args: {
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
    writesEnabled: v.boolean(),
    scanPlanningEnabled: v.boolean(),
    maxEntriesPerRun: v.number(),
    maxWritesPerBatch: v.number(),
    maxPlannedScans: v.number(),
  },
  handler: async (ctx, args) => {
    const policy = assertSkillsShFixtureEnvironmentAllowed();
    if (args.confirm !== ENABLE_FIXTURE_CONFIRM) {
      throw new ConvexError(`Pass confirm="${ENABLE_FIXTURE_CONFIRM}" to enable fixture controls.`);
    }
    assertIntegerInRange("maxEntriesPerRun", args.maxEntriesPerRun, 1, 50);
    assertIntegerInRange("maxWritesPerBatch", args.maxWritesPerBatch, 2, 100);
    assertIntegerInRange("maxPlannedScans", args.maxPlannedScans, 0, 50);
    if (args.scanPlanningEnabled && args.maxPlannedScans === 0) {
      throw new ConvexError("scan planning requires maxPlannedScans greater than zero");
    }
    if (args.scanPlanningEnabled && args.maxWritesPerBatch < 3) {
      throw new ConvexError("scan planning requires maxWritesPerBatch of at least three");
    }

    const now = Date.now();
    const existing = await getControlDoc(ctx);
    const next = {
      mode: "fixture" as const,
      writesEnabled: args.writesEnabled,
      scanPlanningEnabled: args.scanPlanningEnabled,
      publicVisibilityEnabled: false,
      paused: false,
      maxEntriesPerRun: args.maxEntriesPerRun,
      maxWritesPerBatch: args.maxWritesPerBatch,
      maxPlannedScans: args.maxPlannedScans,
      updatedBy: args.actor.trim(),
      reason: args.reason.trim(),
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("skillsShCatalogControls", { key: CONTROL_KEY, ...next });
    return { ...next, environment: policy.environment };
  },
});

export const disableCatalogInternal = internalMutation({
  args: {
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
  },
  handler: async (ctx, args) => {
    assertSkillsShCatalogControlMutationAllowed();
    if (args.confirm !== DISABLE_CATALOG_CONFIRM) {
      throw new ConvexError(`Pass confirm="${DISABLE_CATALOG_CONFIRM}" to disable the catalog.`);
    }
    const now = Date.now();
    const existing = await getControlDoc(ctx);
    const next = {
      mode: "off" as const,
      writesEnabled: false,
      scanPlanningEnabled: false,
      publicVisibilityEnabled: false,
      paused: true,
      maxEntriesPerRun: existing?.maxEntriesPerRun ?? 0,
      maxWritesPerBatch: existing?.maxWritesPerBatch ?? 0,
      maxPlannedScans: existing?.maxPlannedScans ?? 0,
      updatedBy: args.actor.trim(),
      reason: args.reason.trim(),
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("skillsShCatalogControls", { key: CONTROL_KEY, ...next });
    return next;
  },
});

export const startFixtureRunInternal = internalMutation({
  args: {
    fixtureId: fixtureIdValidator,
    actor: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const control = assertFixtureWritesEnabled(await getControlDoc(ctx));
    const fixture = getSkillsShCatalogFixture(args.fixtureId);
    if (fixture.length > control.maxEntriesPerRun) {
      throw new ConvexError(
        `Fixture has ${fixture.length} rows, exceeding maxEntriesPerRun=${control.maxEntriesPerRun}`,
      );
    }
    const now = Date.now();
    const runId = await ctx.db.insert("skillsShCatalogRuns", {
      fixtureId: args.fixtureId,
      status: "running",
      cursor: 0,
      fixtureLength: fixture.length,
      counts: emptyCounts(),
      budgets: {
        maxEntriesPerRun: control.maxEntriesPerRun,
        maxWritesPerBatch: control.maxWritesPerBatch,
        maxPlannedScans: control.maxPlannedScans,
      },
      actor: args.actor.trim(),
      reason: args.reason.trim(),
      batchesProcessed: 0,
      lastBatchWrites: 0,
      startedAt: now,
      updatedAt: now,
    });
    return { runId };
  },
});

export const processFixtureBatchInternal = internalMutation({
  args: {
    runId: v.id("skillsShCatalogRuns"),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const control = assertFixtureWritesEnabled(await getControlDoc(ctx));
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError("skills.sh catalog run not found");
    if (run.status === "paused") throw new ConvexError("skills.sh catalog run is paused");
    if (run.status !== "running") return summarizeRun(run);

    const fixture = getSkillsShCatalogFixture(run.fixtureId);
    let cursor = run.cursor;
    let writesUsed = 0;
    const counts = { ...run.counts };
    const now = Date.now();

    while (cursor < fixture.length && counts.observed < run.budgets.maxEntriesPerRun) {
      const row = normalizeIdentity(fixture[cursor] as SkillsShCatalogFixtureRow);
      const existing = await ctx.db
        .query("skillsShCatalogEntries")
        .withIndex("by_external_id", (q) => q.eq("externalId", row.externalId))
        .unique();
      if (existing && fixtureObservationConflicts(existing, row)) {
        counts.observed += 1;
        counts.rejected += 1;
        cursor += 1;
        continue;
      }

      const observationUnchanged = existing ? sameFixtureObservation(existing, row) : false;
      const contentChanged = existing
        ? existing.githubContentHash !== row.githubContentHash
        : false;
      const existingAttempt =
        existing && control.scanPlanningEnabled
          ? await ctx.db
              .query("skillsShCatalogScanAttempts")
              .withIndex("by_entry_and_content_hash", (q) =>
                q.eq("entryId", existing._id).eq("contentHash", row.githubContentHash),
              )
              .order("desc")
              .first()
          : null;
      const shouldPlanScan =
        control.scanPlanningEnabled &&
        counts.scansPlanned < run.budgets.maxPlannedScans &&
        !existingAttempt;
      const requiredWrites = existing
        ? Number(!observationUnchanged || shouldPlanScan) + Number(shouldPlanScan)
        : 1 + Number(shouldPlanScan);
      if (writesUsed + requiredWrites + 1 > run.budgets.maxWritesPerBatch) break;

      counts.observed += 1;
      cursor += 1;
      if (existing) {
        if (observationUnchanged && !shouldPlanScan) {
          counts.unchanged += 1;
          continue;
        }
        await ctx.db.patch(existing._id, {
          displayName: row.displayName,
          sourceUrl: row.sourceUrl,
          githubPath: row.githubPath,
          githubCommit: row.githubCommit,
          githubContentHash: row.githubContentHash,
          githubCheckedAt: row.githubCheckedAt,
          publicVisible: false,
          scanStatus: shouldPlanScan
            ? "queued"
            : contentChanged
              ? "not-planned"
              : existing.scanStatus,
          lastObservedAt: now,
          updatedAt: now,
        });
        writesUsed += 1;
        if (observationUnchanged) counts.unchanged += 1;
        else counts.updated += 1;
        if (shouldPlanScan) {
          await insertFixtureScanAttempt(ctx, {
            entryId: existing._id,
            runId: run._id,
            externalId: row.externalId,
            contentHash: row.githubContentHash,
            now,
          });
          writesUsed += 1;
          counts.scansPlanned += 1;
        }
        continue;
      }

      const entryId = await ctx.db.insert("skillsShCatalogEntries", {
        externalId: row.externalId,
        sourceKind: "fixture",
        githubOwnerId: row.githubOwnerId,
        owner: row.owner,
        repo: row.repo,
        slug: row.slug,
        displayName: row.displayName,
        sourceUrl: row.sourceUrl,
        githubPath: row.githubPath,
        githubCommit: row.githubCommit,
        githubContentHash: row.githubContentHash,
        githubCheckedAt: row.githubCheckedAt,
        publicVisible: false,
        scanStatus: shouldPlanScan ? "queued" : "not-planned",
        firstObservedAt: now,
        lastObservedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      writesUsed += 1;
      counts.inserted += 1;
      if (shouldPlanScan) {
        await insertFixtureScanAttempt(ctx, {
          entryId,
          runId: run._id,
          externalId: row.externalId,
          contentHash: row.githubContentHash,
          now,
        });
        writesUsed += 1;
        counts.scansPlanned += 1;
      }
    }

    const completed = cursor >= fixture.length;
    const patch = {
      cursor,
      counts,
      status: completed ? ("completed" as const) : ("running" as const),
      completedAt: completed ? now : undefined,
      batchesProcessed: run.batchesProcessed + 1,
      lastBatchWrites: writesUsed + 1,
      updatedAt: now,
    };
    await ctx.db.patch(run._id, patch);
    return summarizeRun({ ...run, ...patch });
  },
});

export const setFixtureRunPausedInternal = internalMutation({
  args: {
    runId: v.id("skillsShCatalogRuns"),
    paused: v.boolean(),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError("skills.sh catalog run not found");
    if (run.status === "completed" || run.status === "failed" || run.status === "canceled") {
      throw new ConvexError(`Cannot change pause state for ${run.status} run`);
    }
    if (!args.paused) assertFixtureWritesEnabled(await getControlDoc(ctx));
    const status = args.paused ? ("paused" as const) : ("running" as const);
    await ctx.db.patch(run._id, { status, updatedAt: Date.now() });
    return { runId: run._id, status };
  },
});

export const recordFixtureScanResultInternal = internalMutation({
  args: {
    attemptId: v.id("skillsShCatalogScanAttempts"),
    contentHash: v.string(),
    verdict: scanVerdictValidator,
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new ConvexError("skills.sh fixture scan attempt not found");
    if (attempt.status !== "queued") return { applied: false, reason: "attempt-not-queued" };
    if (attempt.contentHash !== args.contentHash) {
      throw new ConvexError("skills.sh fixture scan content hash mismatch");
    }
    const entry = await ctx.db.get(attempt.entryId);
    if (!entry || entry.githubContentHash !== args.contentHash) {
      const now = Date.now();
      await ctx.db.patch(attempt._id, {
        status: "canceled",
        completedAt: now,
        updatedAt: now,
      });
      const run = await ctx.db.get(attempt.runId);
      if (run) {
        await ctx.db.patch(run._id, {
          counts: {
            ...run.counts,
            scansCanceled: run.counts.scansCanceled + 1,
          },
          updatedAt: now,
        });
      }
      return { applied: false, reason: "stale-attempt" };
    }

    const now = Date.now();
    const succeeded = args.verdict !== "failed";
    await ctx.db.patch(attempt._id, {
      status: succeeded ? "succeeded" : "failed",
      verdict: args.verdict,
      completedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(entry._id, {
      scanStatus: args.verdict,
      publicVisible: false,
      updatedAt: now,
    });
    const run = await ctx.db.get(attempt.runId);
    if (run) {
      await ctx.db.patch(run._id, {
        counts: {
          ...run.counts,
          scansCompleted: run.counts.scansCompleted + 1,
        },
        updatedAt: now,
      });
    }
    return { applied: true, publicVisible: false };
  },
});

export const cancelQueuedFixtureScansInternal = internalMutation({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    assertIntegerInRange("limit", args.limit, 1, 100);
    const queued = await ctx.db
      .query("skillsShCatalogScanAttempts")
      .withIndex("by_status_and_created_at", (q) => q.eq("status", "queued"))
      .order("asc")
      .take(args.limit);
    const now = Date.now();
    for (const attempt of queued) {
      await ctx.db.patch(attempt._id, {
        status: "canceled",
        completedAt: now,
        updatedAt: now,
      });
      const entry = await ctx.db.get(attempt.entryId);
      if (entry?.scanStatus === "queued" && entry.githubContentHash === attempt.contentHash) {
        await ctx.db.patch(entry._id, {
          scanStatus: "canceled",
          publicVisible: false,
          updatedAt: now,
        });
      }
      const run = await ctx.db.get(attempt.runId);
      if (run) {
        await ctx.db.patch(run._id, {
          counts: {
            ...run.counts,
            scansCanceled: run.counts.scansCanceled + 1,
          },
          updatedAt: now,
        });
      }
    }
    return { matched: queued.length, canceled: queued.length };
  },
});

export const getStatusInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [control, runs, entries, scanAttempts] = await Promise.all([
      getControlDoc(ctx),
      ctx.db.query("skillsShCatalogRuns").withIndex("by_started_at").order("desc").take(20),
      ctx.db.query("skillsShCatalogEntries").withIndex("by_external_id").take(STATUS_LIMIT),
      ctx.db
        .query("skillsShCatalogScanAttempts")
        .withIndex("by_created_at")
        .order("desc")
        .take(STATUS_LIMIT),
    ]);
    return {
      environment: getSkillsShFixtureEnvironmentPolicy(),
      control: summarizeControl(control),
      runs: runs.map(summarizeRun),
      entries: entries.map((entry) => ({
        ...entry,
        resolution: {
          externalRoute: `/skills-sh/${entry.externalId}`,
          installRef: `skills-sh:${entry.externalId}`,
          installable: false,
        },
      })),
      scanAttempts,
      limits: {
        runs: 20,
        entries: STATUS_LIMIT,
        scanAttempts: STATUS_LIMIT,
      },
    };
  },
});

function emptyCounts() {
  return {
    observed: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    scansPlanned: 0,
    scansCompleted: 0,
    scansCanceled: 0,
  };
}

function sameFixtureObservation(
  existing: Doc<"skillsShCatalogEntries">,
  row: ReturnType<typeof normalizeIdentity>,
) {
  return (
    existing.githubOwnerId === row.githubOwnerId &&
    existing.owner === row.owner &&
    existing.repo === row.repo &&
    existing.slug === row.slug &&
    existing.displayName === row.displayName &&
    existing.sourceUrl === row.sourceUrl &&
    existing.githubPath === row.githubPath &&
    existing.githubCommit === row.githubCommit &&
    existing.githubContentHash === row.githubContentHash &&
    existing.githubCheckedAt === row.githubCheckedAt
  );
}

function fixtureObservationConflicts(
  existing: Doc<"skillsShCatalogEntries">,
  row: ReturnType<typeof normalizeIdentity>,
) {
  if (existing.githubOwnerId !== row.githubOwnerId) return true;
  if (row.githubCheckedAt < existing.githubCheckedAt) return true;
  return row.githubCheckedAt === existing.githubCheckedAt && !sameFixtureObservation(existing, row);
}

async function insertFixtureScanAttempt(
  ctx: MutationCtx,
  args: {
    entryId: Id<"skillsShCatalogEntries">;
    runId: Id<"skillsShCatalogRuns">;
    externalId: string;
    contentHash: string;
    now: number;
  },
) {
  await ctx.db.insert("skillsShCatalogScanAttempts", {
    entryId: args.entryId,
    runId: args.runId,
    externalId: args.externalId,
    contentHash: args.contentHash,
    source: "skills-sh-catalog-fixture",
    priority: "low",
    status: "queued",
    createdAt: args.now,
    updatedAt: args.now,
  });
}

function summarizeRun(run: Doc<"skillsShCatalogRuns">) {
  return {
    _id: run._id,
    fixtureId: run.fixtureId,
    status: run.status,
    cursor: run.cursor,
    fixtureLength: run.fixtureLength,
    counts: run.counts,
    budgets: run.budgets,
    actor: run.actor,
    reason: run.reason,
    lastError: run.lastError,
    errors: run.lastError ? [run.lastError] : [],
    budgetConsumed: {
      entriesObserved: run.counts.observed,
      scansPlanned: run.counts.scansPlanned,
      batchesProcessed: run.batchesProcessed,
      lastBatchWrites: run.lastBatchWrites,
    },
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    updatedAt: run.updatedAt,
  };
}
