import { paginationOptsValidator } from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";
import {
  assertSkillsShCatalogControlMutationAllowed,
  assertSkillsShFixtureEnvironmentAllowed,
  getSkillsShFixtureEnvironmentPolicy,
} from "./lib/skillsShCatalogEnvironment";
import {
  getSkillsShCatalogFixture,
  type SkillsShCatalogFixtureRow,
} from "./lib/skillsShCatalogFixtures";
import { validateFilePath } from "./lib/skillZip";
import { enqueueSkillsShCatalogScanRequest } from "./securityScan";

const CONTROL_KEY = "global";
const ENABLE_FIXTURE_CONFIRM = "enable-skills-sh-fixture-control";
const DISABLE_CATALOG_CONFIRM = "disable-skills-sh-catalog";
const STATUS_LIMIT = 50;
const MAX_DISCOVERY_ROWS = 20_000;
const MAX_ENTRIES_PER_BATCH = 250;
const MAX_WRITES_PER_BATCH = 100;
const MAX_SCAN_ADMISSIONS_PER_BATCH = 100;
const MAX_SCAN_ADMISSIONS_PER_RUN = 500;
const MAX_REAL_TEST_ADMISSIONS = 10;
const MAX_DETERMINISTIC_COMPLETIONS_PER_BATCH = 50;

const fixtureIdValidator = v.union(
  v.literal("nvidia-small-v1"),
  v.literal("nvidia-small-v2"),
  v.literal("skills-sh-500-2026-07-21"),
  v.literal("skills-sh-500-2026-07-21-v2"),
  v.literal("synthetic-20000-v1"),
);
const scanVerdictValidator = v.union(
  v.literal("clean"),
  v.literal("suspicious"),
  v.literal("malicious"),
  v.literal("failed"),
);
const dispatchKindValidator = v.union(v.literal("deterministic"), v.literal("real"));
const stagingLiveRowValidator = v.object({
  externalId: v.string(),
  githubOwnerId: v.number(),
  owner: v.string(),
  repo: v.string(),
  slug: v.string(),
  displayName: v.string(),
  sourceUrl: v.string(),
  githubRepoUrl: v.string(),
  sourceContentHash: v.string(),
  installs: v.number(),
});
const scanRequestFileValidator = v.object({
  path: v.string(),
  size: v.number(),
  storageId: v.id("_storage"),
  sha256: v.string(),
  contentType: v.optional(v.string()),
});
const stagingLiveArtifactValidator = v.object({
  externalId: v.string(),
  artifactContentHash: v.string(),
  files: v.array(scanRequestFileValidator),
});
type StagingLiveArtifact = Infer<typeof stagingLiveArtifactValidator>;

const DEFAULT_CONTROL = {
  mode: "off" as const,
  discoveryEnabled: false,
  writesEnabled: false,
  scanPlanningEnabled: false,
  scanAdmissionEnabled: false,
  publicVisibilityEnabled: false,
  paused: true,
  maxEntriesPerRun: 0,
  maxEntriesPerBatch: 0,
  maxWritesPerBatch: 0,
  maxPlannedScans: 0,
  maxScanAdmissionsPerBatch: 0,
  maxScanAdmissionsPerRun: 0,
  maxScanAdmissionsPerDay: 0,
  maxCatalogQueued: 0,
  maxCatalogInFlight: 0,
  maxNativeQueued: 0,
  maxNativeInFlight: 0,
  realScanAllowlist: [] as string[],
  updatedBy: null,
  reason: null,
  updatedAt: null,
};

type OperationCounts = {
  functionCalls: number;
  dbReads: number;
  dbWrites: number;
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
    sourceContentHash: row.sourceContentHash.trim().toLowerCase(),
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
    discoveryEnabled: control.discoveryEnabled,
    writesEnabled: control.writesEnabled,
    scanPlanningEnabled: control.scanPlanningEnabled,
    scanAdmissionEnabled: control.scanAdmissionEnabled,
    publicVisibilityEnabled: control.publicVisibilityEnabled,
    paused: control.paused,
    maxEntriesPerRun: control.maxEntriesPerRun,
    maxEntriesPerBatch: control.maxEntriesPerBatch,
    maxWritesPerBatch: control.maxWritesPerBatch,
    maxPlannedScans: control.maxPlannedScans,
    maxScanAdmissionsPerBatch: control.maxScanAdmissionsPerBatch,
    maxScanAdmissionsPerRun: control.maxScanAdmissionsPerRun,
    maxScanAdmissionsPerDay: control.maxScanAdmissionsPerDay,
    maxCatalogQueued: control.maxCatalogQueued,
    maxCatalogInFlight: control.maxCatalogInFlight,
    maxNativeQueued: control.maxNativeQueued,
    maxNativeInFlight: control.maxNativeInFlight,
    realScanAllowlist: control.realScanAllowlist,
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

function assertCatalogActive(control: Doc<"skillsShCatalogControls"> | null) {
  if (!control || control.mode === "off") {
    throw new ConvexError("skills.sh catalog controls are disabled");
  }
  if (control.paused) throw new ConvexError("skills.sh catalog is paused");
  return control;
}

function assertDiscoveryEnabled(control: Doc<"skillsShCatalogControls"> | null) {
  const active = assertCatalogActive(control);
  if (!active.discoveryEnabled) {
    throw new ConvexError("skills.sh catalog discovery is disabled");
  }
  return active;
}

function assertWritesEnabled(control: Doc<"skillsShCatalogControls"> | null) {
  const active = assertCatalogActive(control);
  if (!active.writesEnabled) {
    throw new ConvexError("skills.sh catalog writes are disabled");
  }
  return active;
}

function assertScanAdmissionEnabled(control: Doc<"skillsShCatalogControls"> | null) {
  const active = assertCatalogActive(control);
  if (!active.scanAdmissionEnabled) {
    throw new ConvexError("skills.sh catalog scan admission is disabled");
  }
  return active;
}

function assertFixtureMode(control: Doc<"skillsShCatalogControls"> | null) {
  const active = assertCatalogActive(control);
  if (active.mode !== "fixture") {
    throw new ConvexError("skills.sh fixture work requires fixture controls");
  }
  return active;
}

function assertFixtureRun(run: Doc<"skillsShCatalogRuns">) {
  if (run.sourceKind === "staging-live" || run.fixtureId === "skills-sh-test-live-500") {
    throw new ConvexError("skills.sh fixture work requires a fixture run");
  }
}

export const configureFixtureControlInternal = internalMutation({
  args: {
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
    mode: v.optional(v.union(v.literal("fixture"), v.literal("staging-live"))),
    discoveryEnabled: v.boolean(),
    writesEnabled: v.boolean(),
    scanPlanningEnabled: v.boolean(),
    scanAdmissionEnabled: v.boolean(),
    maxEntriesPerRun: v.number(),
    maxEntriesPerBatch: v.number(),
    maxWritesPerBatch: v.number(),
    maxPlannedScans: v.number(),
    maxScanAdmissionsPerBatch: v.number(),
    maxScanAdmissionsPerRun: v.number(),
    maxScanAdmissionsPerDay: v.number(),
    maxCatalogQueued: v.number(),
    maxCatalogInFlight: v.number(),
    maxNativeQueued: v.number(),
    maxNativeInFlight: v.number(),
    realScanAllowlist: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const policy = assertSkillsShFixtureEnvironmentAllowed();
    if (args.confirm !== ENABLE_FIXTURE_CONFIRM) {
      throw new ConvexError(`Pass confirm="${ENABLE_FIXTURE_CONFIRM}" to enable fixture controls.`);
    }
    const mode = args.mode ?? "fixture";
    if (mode === "staging-live" && policy.environment !== "test") {
      throw new ConvexError(
        "skills.sh staging-live controls require the permanent Test environment",
      );
    }
    assertIntegerInRange("maxEntriesPerRun", args.maxEntriesPerRun, 1, MAX_DISCOVERY_ROWS);
    assertIntegerInRange("maxEntriesPerBatch", args.maxEntriesPerBatch, 1, MAX_ENTRIES_PER_BATCH);
    assertIntegerInRange("maxWritesPerBatch", args.maxWritesPerBatch, 1, MAX_WRITES_PER_BATCH);
    assertIntegerInRange("maxPlannedScans", args.maxPlannedScans, 0, MAX_DISCOVERY_ROWS);
    assertIntegerInRange(
      "maxScanAdmissionsPerBatch",
      args.maxScanAdmissionsPerBatch,
      0,
      MAX_SCAN_ADMISSIONS_PER_BATCH,
    );
    assertIntegerInRange(
      "maxScanAdmissionsPerRun",
      args.maxScanAdmissionsPerRun,
      0,
      MAX_SCAN_ADMISSIONS_PER_RUN,
    );
    assertIntegerInRange(
      "maxScanAdmissionsPerDay",
      args.maxScanAdmissionsPerDay,
      0,
      MAX_SCAN_ADMISSIONS_PER_RUN,
    );
    assertIntegerInRange("maxCatalogQueued", args.maxCatalogQueued, 0, MAX_SCAN_ADMISSIONS_PER_RUN);
    assertIntegerInRange(
      "maxCatalogInFlight",
      args.maxCatalogInFlight,
      0,
      MAX_SCAN_ADMISSIONS_PER_RUN,
    );
    assertIntegerInRange("maxNativeQueued", args.maxNativeQueued, 0, 10_000);
    assertIntegerInRange("maxNativeInFlight", args.maxNativeInFlight, 0, 1_000);
    if (args.scanPlanningEnabled && args.maxPlannedScans === 0) {
      throw new ConvexError("scan planning requires maxPlannedScans greater than zero");
    }
    if (args.writesEnabled && args.maxWritesPerBatch < 2) {
      throw new ConvexError("catalog writes require maxWritesPerBatch of at least two");
    }
    if (
      args.scanAdmissionEnabled &&
      (args.maxScanAdmissionsPerBatch === 0 ||
        args.maxScanAdmissionsPerRun === 0 ||
        args.maxScanAdmissionsPerDay === 0 ||
        args.maxCatalogQueued === 0)
    ) {
      throw new ConvexError("scan admission requires non-zero batch, run, day, and queue budgets");
    }
    const realScanAllowlist = Array.from(
      new Set(args.realScanAllowlist.map((externalId) => externalId.trim().toLowerCase())),
    ).filter(Boolean);
    if (realScanAllowlist.length > MAX_REAL_TEST_ADMISSIONS) {
      throw new ConvexError(`realScanAllowlist cannot exceed ${MAX_REAL_TEST_ADMISSIONS} skills`);
    }
    if (
      policy.environment === "test" &&
      (args.maxEntriesPerRun > 500 ||
        args.maxScanAdmissionsPerRun > MAX_REAL_TEST_ADMISSIONS ||
        args.maxScanAdmissionsPerDay > MAX_REAL_TEST_ADMISSIONS)
    ) {
      throw new ConvexError("skills.sh Test controls are capped at 500 discoveries and 10 scans");
    }

    const now = Date.now();
    const existing = await getControlDoc(ctx);
    const next = {
      mode,
      discoveryEnabled: args.discoveryEnabled,
      writesEnabled: args.writesEnabled,
      scanPlanningEnabled: args.scanPlanningEnabled,
      scanAdmissionEnabled: args.scanAdmissionEnabled,
      publicVisibilityEnabled: false,
      paused: false,
      maxEntriesPerRun: args.maxEntriesPerRun,
      maxEntriesPerBatch: args.maxEntriesPerBatch,
      maxWritesPerBatch: args.maxWritesPerBatch,
      maxPlannedScans: args.maxPlannedScans,
      maxScanAdmissionsPerBatch: args.maxScanAdmissionsPerBatch,
      maxScanAdmissionsPerRun: args.maxScanAdmissionsPerRun,
      maxScanAdmissionsPerDay: args.maxScanAdmissionsPerDay,
      maxCatalogQueued: args.maxCatalogQueued,
      maxCatalogInFlight: args.maxCatalogInFlight,
      maxNativeQueued: args.maxNativeQueued,
      maxNativeInFlight: args.maxNativeInFlight,
      realScanAllowlist,
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
      ...DEFAULT_CONTROL,
      maxEntriesPerRun: existing?.maxEntriesPerRun ?? 0,
      maxEntriesPerBatch: existing?.maxEntriesPerBatch ?? 0,
      maxWritesPerBatch: existing?.maxWritesPerBatch ?? 0,
      maxPlannedScans: existing?.maxPlannedScans ?? 0,
      maxScanAdmissionsPerBatch: existing?.maxScanAdmissionsPerBatch ?? 0,
      maxScanAdmissionsPerRun: existing?.maxScanAdmissionsPerRun ?? 0,
      maxScanAdmissionsPerDay: existing?.maxScanAdmissionsPerDay ?? 0,
      maxCatalogQueued: existing?.maxCatalogQueued ?? 0,
      maxCatalogInFlight: existing?.maxCatalogInFlight ?? 0,
      maxNativeQueued: existing?.maxNativeQueued ?? 0,
      maxNativeInFlight: existing?.maxNativeInFlight ?? 0,
      updatedBy: args.actor.trim(),
      reason: args.reason.trim(),
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else {
      await ctx.db.insert("skillsShCatalogControls", {
        key: CONTROL_KEY,
        ...next,
        updatedBy: args.actor.trim(),
        reason: args.reason.trim(),
        updatedAt: now,
      });
    }
    return next;
  },
});

export const startFixtureRunInternal = internalMutation({
  args: {
    fixtureId: fixtureIdValidator,
    actor: v.string(),
    reason: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const control = assertFixtureMode(assertDiscoveryEnabled(await getControlDoc(ctx)));
    const fixture = getSkillsShCatalogFixture(args.fixtureId);
    const now = Date.now();
    const runId = await ctx.db.insert("skillsShCatalogRuns", {
      fixtureId: args.fixtureId,
      snapshotId: fixture.snapshotId,
      sourceKind: fixture.sourceKind,
      ...(fixture.capturedAt ? { sourceCapturedAt: fixture.capturedAt } : {}),
      snapshotCaptureFetches: fixture.snapshotCaptureFetches,
      dryRun: args.dryRun ?? false,
      status: "running",
      cursor: 0,
      scanCursor: 0,
      fixtureLength: fixture.length,
      counts: emptyCounts(),
      budgets: {
        maxEntriesPerRun: control.maxEntriesPerRun,
        maxEntriesPerBatch: control.maxEntriesPerBatch,
        maxWritesPerBatch: control.maxWritesPerBatch,
        maxPlannedScans: control.maxPlannedScans,
        maxScanAdmissionsPerBatch: control.maxScanAdmissionsPerBatch,
        maxScanAdmissionsPerRun: control.maxScanAdmissionsPerRun,
        maxScanAdmissionsPerDay: control.maxScanAdmissionsPerDay,
      },
      operations: {
        functionCalls: 1,
        dbReads: 1,
        dbWrites: 1,
      },
      actor: args.actor.trim(),
      reason: args.reason.trim(),
      batchesProcessed: 0,
      scanAdmissionBatches: 0,
      lastBatchWrites: 1,
      lastBatchReads: 1,
      startedAt: now,
      updatedAt: now,
    });
    return { runId };
  },
});

export const startStagingLiveRunInternal = internalMutation({
  args: {
    actor: v.string(),
    reason: v.string(),
    snapshotId: v.string(),
    sourceCapturedAt: v.string(),
    snapshotCaptureFetches: v.number(),
    fixtureLength: v.number(),
  },
  handler: async (ctx, args) => {
    const environment = assertSkillsShFixtureEnvironmentAllowed();
    const control = assertDiscoveryEnabled(await getControlDoc(ctx));
    if (environment.environment !== "test" || control.mode !== "staging-live") {
      throw new ConvexError("skills.sh live runs require permanent Test staging-live controls");
    }
    if (args.fixtureLength !== 500) {
      throw new ConvexError("skills.sh live Test runs require exactly 500 rows");
    }
    assertIntegerInRange("snapshotCaptureFetches", args.snapshotCaptureFetches, 1, 2_000);
    const now = Date.now();
    const runId = await ctx.db.insert("skillsShCatalogRuns", {
      fixtureId: "skills-sh-test-live-500",
      snapshotId: args.snapshotId.trim(),
      sourceKind: "staging-live",
      sourceCapturedAt: args.sourceCapturedAt,
      snapshotCaptureFetches: args.snapshotCaptureFetches,
      dryRun: false,
      status: "running",
      cursor: 0,
      scanCursor: 0,
      fixtureLength: args.fixtureLength,
      counts: emptyCounts(),
      budgets: {
        maxEntriesPerRun: control.maxEntriesPerRun,
        maxEntriesPerBatch: control.maxEntriesPerBatch,
        maxWritesPerBatch: control.maxWritesPerBatch,
        maxPlannedScans: control.maxPlannedScans,
        maxScanAdmissionsPerBatch: control.maxScanAdmissionsPerBatch,
        maxScanAdmissionsPerRun: control.maxScanAdmissionsPerRun,
        maxScanAdmissionsPerDay: control.maxScanAdmissionsPerDay,
      },
      operations: {
        functionCalls: 1,
        dbReads: 1,
        dbWrites: 1,
      },
      actor: args.actor.trim(),
      reason: args.reason.trim(),
      batchesProcessed: 0,
      scanAdmissionBatches: 0,
      lastBatchWrites: 1,
      lastBatchReads: 1,
      startedAt: now,
      updatedAt: now,
    });
    return { runId };
  },
});

export const processStagingLiveBatchInternal = internalMutation({
  args: {
    runId: v.id("skillsShCatalogRuns"),
    cursor: v.number(),
    rows: v.array(stagingLiveRowValidator),
  },
  handler: async (ctx, args) => {
    const environment = assertSkillsShFixtureEnvironmentAllowed();
    const control = await getControlDoc(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError("skills.sh catalog run not found");
    if (
      environment.environment !== "test" ||
      control?.mode !== "staging-live" ||
      run.sourceKind !== "staging-live" ||
      run.fixtureId !== "skills-sh-test-live-500"
    ) {
      throw new ConvexError("skills.sh live batch requires permanent Test staging-live state");
    }
    assertDiscoveryEnabled(control);
    assertWritesEnabled(control);
    if (run.status === "paused") throw new ConvexError("skills.sh catalog run is paused");
    if (run.status !== "running") return summarizeRun(run);
    if (args.cursor !== run.cursor) {
      throw new ConvexError(`skills.sh live batch cursor mismatch: expected ${run.cursor}`);
    }
    assertIntegerInRange("rows.length", args.rows.length, 1, run.budgets.maxEntriesPerBatch);
    if (args.cursor + args.rows.length > run.fixtureLength) {
      throw new ConvexError("skills.sh live batch exceeds the declared 500-row snapshot");
    }

    let cursor = run.cursor;
    let writesUsed = 0;
    let readsUsed = 2;
    const counts = { ...run.counts };
    const now = Date.now();
    for (const inputRow of args.rows) {
      if (counts.observed >= run.budgets.maxEntriesPerRun) break;
      const row = normalizeIdentity(inputRow);
      if (row.externalId !== inputRow.externalId.trim().toLowerCase()) {
        throw new ConvexError(`skills.sh live row identity mismatch: ${inputRow.externalId}`);
      }
      const existing = await ctx.db
        .query("skillsShCatalogEntries")
        .withIndex("by_external_id", (q) => q.eq("externalId", row.externalId))
        .unique();
      readsUsed += 1;
      if (existing && fixtureObservationConflicts(existing, row, "staging-live")) {
        counts.observed += 1;
        counts.rejected += 1;
        cursor += 1;
        continue;
      }
      const observationUnchanged = existing ? sameFixtureObservation(existing, row) : false;
      const contentChanged = existing
        ? existing.sourceContentHash !== row.sourceContentHash
        : false;
      const existingAttempt =
        existing && control.scanPlanningEnabled
          ? await ctx.db
              .query("skillsShCatalogScanAttempts")
              .withIndex("by_entry_and_source_content_hash", (q) =>
                q.eq("entryId", existing._id).eq("sourceContentHash", row.sourceContentHash),
              )
              .filter((q) => q.neq(q.field("status"), "canceled"))
              .order("desc")
              .first()
          : null;
      if (existing && control.scanPlanningEnabled) readsUsed += 1;
      const shouldPlanScan =
        control.scanPlanningEnabled &&
        counts.scansPlanned < run.budgets.maxPlannedScans &&
        // Exact-hash terminal attempts are durable. Only canceled work is eligible
        // for automatic replanning; failed hashes require an explicit retry policy.
        !existingAttempt &&
        (!existing || contentChanged || existing.scanStatus !== "planned");
      if (writesUsed + 2 > run.budgets.maxWritesPerBatch) break;

      counts.observed += 1;
      cursor += 1;
      if (shouldPlanScan) counts.scansPlanned += 1;
      if (existing) {
        if (observationUnchanged) counts.unchanged += 1;
        else {
          counts.wouldUpdate += 1;
          counts.updated += 1;
        }
        await ctx.db.patch(existing._id, {
          sourceKind: "staging-live",
          githubOwnerId: row.githubOwnerId,
          owner: row.owner,
          repo: row.repo,
          slug: row.slug,
          displayName: row.displayName,
          sourceUrl: row.sourceUrl,
          githubRepoUrl: row.githubRepoUrl,
          sourceContentHash: row.sourceContentHash,
          installs: row.installs,
          sourceSnapshotId: run.snapshotId,
          publicVisible: false,
          scanStatus: shouldPlanScan
            ? "planned"
            : contentChanged && existingAttempt
              ? scanStatusFromAttempt(existingAttempt)
              : contentChanged
                ? "not-planned"
                : existing.scanStatus,
          lastObservedAt: now,
          updatedAt: now,
        });
      } else {
        counts.wouldInsert += 1;
        counts.inserted += 1;
        await ctx.db.insert("skillsShCatalogEntries", {
          externalId: row.externalId,
          sourceKind: "staging-live",
          githubOwnerId: row.githubOwnerId,
          owner: row.owner,
          repo: row.repo,
          slug: row.slug,
          displayName: row.displayName,
          sourceUrl: row.sourceUrl,
          githubRepoUrl: row.githubRepoUrl,
          sourceContentHash: row.sourceContentHash,
          installs: row.installs,
          sourceSnapshotId: run.snapshotId,
          publicVisible: false,
          scanStatus: shouldPlanScan ? "planned" : "not-planned",
          firstObservedAt: now,
          lastObservedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      writesUsed += 1;
    }

    if (cursor !== args.cursor + args.rows.length) {
      throw new ConvexError("skills.sh live batch exceeded its write or discovery budget");
    }
    const completed = cursor >= run.fixtureLength;
    const budgetExhausted = !completed && counts.observed >= run.budgets.maxEntriesPerRun;
    const terminal = completed || budgetExhausted;
    const patch = {
      cursor,
      counts,
      status: completed
        ? ("completed" as const)
        : budgetExhausted
          ? ("budget-exhausted" as const)
          : ("running" as const),
      completedAt: terminal ? now : undefined,
      batchesProcessed: run.batchesProcessed + 1,
      lastBatchWrites: writesUsed + 1,
      lastBatchReads: readsUsed,
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: readsUsed,
        dbWrites: writesUsed + 1,
      }),
      updatedAt: now,
    };
    await ctx.db.patch(run._id, patch);
    return summarizeRun({ ...run, ...patch });
  },
});

export const processFixtureBatchInternal = internalMutation({
  args: {
    runId: v.id("skillsShCatalogRuns"),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const control = await getControlDoc(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError("skills.sh catalog run not found");
    assertFixtureMode(control);
    assertFixtureRun(run);
    assertDiscoveryEnabled(control);
    if (!run.dryRun) assertWritesEnabled(control);
    if (run.status === "paused") throw new ConvexError("skills.sh catalog run is paused");
    if (run.status !== "running") return summarizeRun(run);

    if (run.fixtureId === "skills-sh-test-live-500") {
      throw new ConvexError("skills.sh fixture work requires a fixture run");
    }
    const fixture = getSkillsShCatalogFixture(run.fixtureId);
    let cursor = run.cursor;
    let writesUsed = 0;
    let readsUsed = 2;
    let entriesProcessed = 0;
    const counts = { ...run.counts };
    const now = Date.now();

    while (
      cursor < fixture.length &&
      counts.observed < run.budgets.maxEntriesPerRun &&
      entriesProcessed < run.budgets.maxEntriesPerBatch
    ) {
      const row = normalizeIdentity(fixture.rowAt(cursor));
      const existing = await ctx.db
        .query("skillsShCatalogEntries")
        .withIndex("by_external_id", (q) => q.eq("externalId", row.externalId))
        .unique();
      readsUsed += 1;
      if (existing && fixtureObservationConflicts(existing, row, fixture.sourceKind)) {
        counts.observed += 1;
        counts.rejected += 1;
        cursor += 1;
        entriesProcessed += 1;
        continue;
      }

      const observationUnchanged = existing ? sameFixtureObservation(existing, row) : false;
      const contentChanged = existing
        ? existing.sourceContentHash !== row.sourceContentHash
        : false;
      const existingAttempt =
        existing && control?.scanPlanningEnabled
          ? await ctx.db
              .query("skillsShCatalogScanAttempts")
              .withIndex("by_entry_and_source_content_hash", (q) =>
                q.eq("entryId", existing._id).eq("sourceContentHash", row.sourceContentHash),
              )
              .filter((q) => q.neq(q.field("status"), "canceled"))
              .order("desc")
              .first()
          : null;
      if (existing && control?.scanPlanningEnabled) readsUsed += 1;
      const shouldPlanScan =
        Boolean(control?.scanPlanningEnabled) &&
        counts.scansPlanned < run.budgets.maxPlannedScans &&
        // Exact-hash terminal attempts are durable. Only canceled work is eligible
        // for automatic replanning; failed hashes require an explicit retry policy.
        !existingAttempt &&
        (!existing || contentChanged || existing.scanStatus !== "planned");
      const entryWriteRequired = !run.dryRun;
      if (entryWriteRequired && writesUsed + 2 > run.budgets.maxWritesPerBatch) break;

      counts.observed += 1;
      cursor += 1;
      entriesProcessed += 1;
      if (shouldPlanScan) counts.scansPlanned += 1;
      if (existing) {
        if (observationUnchanged) counts.unchanged += 1;
        else {
          counts.wouldUpdate += 1;
          if (!run.dryRun) counts.updated += 1;
        }
        if (entryWriteRequired) {
          await ctx.db.patch(existing._id, {
            sourceKind: fixture.sourceKind,
            githubOwnerId: row.githubOwnerId,
            owner: row.owner,
            repo: row.repo,
            slug: row.slug,
            displayName: row.displayName,
            sourceUrl: row.sourceUrl,
            githubRepoUrl: row.githubRepoUrl,
            sourceContentHash: row.sourceContentHash,
            installs: row.installs,
            sourceSnapshotId: fixture.snapshotId,
            // This gate has no publication seam; every catalog write reasserts dark visibility.
            publicVisible: false,
            scanStatus: shouldPlanScan
              ? "planned"
              : contentChanged && existingAttempt
                ? scanStatusFromAttempt(existingAttempt)
                : contentChanged
                  ? "not-planned"
                  : existing.scanStatus,
            lastObservedAt: now,
            updatedAt: now,
          });
          writesUsed += 1;
        }
        continue;
      }

      counts.wouldInsert += 1;
      if (!run.dryRun) {
        await ctx.db.insert("skillsShCatalogEntries", {
          externalId: row.externalId,
          sourceKind: fixture.sourceKind,
          githubOwnerId: row.githubOwnerId,
          owner: row.owner,
          repo: row.repo,
          slug: row.slug,
          displayName: row.displayName,
          sourceUrl: row.sourceUrl,
          githubRepoUrl: row.githubRepoUrl,
          sourceContentHash: row.sourceContentHash,
          installs: row.installs,
          sourceSnapshotId: fixture.snapshotId,
          publicVisible: false,
          scanStatus: shouldPlanScan ? "planned" : "not-planned",
          firstObservedAt: now,
          lastObservedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        writesUsed += 1;
        counts.inserted += 1;
      }
    }

    const completed = cursor >= fixture.length;
    const budgetExhausted = !completed && counts.observed >= run.budgets.maxEntriesPerRun;
    const terminal = completed || budgetExhausted;
    const batchWrites = writesUsed + 1;
    const patch = {
      cursor,
      counts,
      status: completed
        ? ("completed" as const)
        : budgetExhausted
          ? ("budget-exhausted" as const)
          : ("running" as const),
      completedAt: terminal ? now : undefined,
      batchesProcessed: run.batchesProcessed + 1,
      lastBatchWrites: batchWrites,
      lastBatchReads: readsUsed,
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: readsUsed,
        dbWrites: batchWrites,
      }),
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
    if (
      run.status === "completed" ||
      run.status === "budget-exhausted" ||
      run.status === "failed" ||
      run.status === "canceling" ||
      run.status === "canceled"
    ) {
      throw new ConvexError(`Cannot change pause state for ${run.status} run`);
    }
    if (!args.paused) assertDiscoveryEnabled(await getControlDoc(ctx));
    const status = args.paused ? ("paused" as const) : ("running" as const);
    await ctx.db.patch(run._id, {
      status,
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: args.paused ? 1 : 2,
        dbWrites: 1,
      }),
      updatedAt: Date.now(),
    });
    return { runId: run._id, status };
  },
});

async function readQueueHealth(ctx: MutationCtx, control: Doc<"skillsShCatalogControls">) {
  const nativeSources = ["publish", "vt-update", "backfill", "bulk-rescan", "manual"] as const;
  const [nativeQueuedBySource, nativeRunningBySource, catalogQueued, catalogRunning] =
    await Promise.all([
      Promise.all(
        nativeSources.map(async (source) =>
          ctx.db
            .query("securityScanJobs")
            .withIndex("by_status_source_created_at", (q) =>
              q.eq("status", "queued").eq("source", source),
            )
            .take(control.maxNativeQueued + 1),
        ),
      ),
      Promise.all(
        nativeSources.map(async (source) =>
          ctx.db
            .query("securityScanJobs")
            .withIndex("by_status_source_created_at", (q) =>
              q.eq("status", "running").eq("source", source),
            )
            .take(control.maxNativeInFlight + 1),
        ),
      ),
      ctx.db
        .query("skillsShCatalogScanAttempts")
        .withIndex("by_status_and_created_at", (q) => q.eq("status", "queued"))
        .take(control.maxCatalogQueued + 1),
      ctx.db
        .query("skillsShCatalogScanAttempts")
        .withIndex("by_status_and_created_at", (q) => q.eq("status", "running"))
        .take(control.maxCatalogInFlight + 1),
    ]);
  const nativeQueued = Math.min(
    control.maxNativeQueued + 1,
    nativeQueuedBySource.reduce((count, jobs) => count + jobs.length, 0),
  );
  const nativeInFlight = Math.min(
    control.maxNativeInFlight + 1,
    nativeRunningBySource.reduce((count, jobs) => count + jobs.length, 0),
  );
  return {
    nativeQueued,
    nativeInFlight,
    catalogQueued: catalogQueued.length,
    catalogInFlight: catalogRunning.length,
    healthy:
      nativeQueued <= control.maxNativeQueued &&
      nativeInFlight <= control.maxNativeInFlight &&
      catalogQueued.length <= control.maxCatalogQueued &&
      catalogRunning.length <= control.maxCatalogInFlight,
  };
}

type AdmitScansArgs = {
  runId: Id<"skillsShCatalogRuns">;
  externalIds: string[];
  dispatchKind: "deterministic" | "real";
  actorUserId?: Id<"users">;
  artifacts?: StagingLiveArtifact[];
};

async function admitScans(ctx: MutationCtx, args: AdmitScansArgs) {
  const environment = assertSkillsShFixtureEnvironmentAllowed();
  const control = assertScanAdmissionEnabled(await getControlDoc(ctx));
  const run = await ctx.db.get(args.runId);
  if (!run) throw new ConvexError("skills.sh catalog run not found");
  if (
    run.status === "paused" ||
    run.status === "canceling" ||
    run.status === "canceled" ||
    run.status === "failed"
  ) {
    throw new ConvexError(`Cannot admit scans for ${run.status} run`);
  }
  const externalIds = Array.from(
    new Set(args.externalIds.map((externalId) => externalId.trim().toLowerCase())),
  ).filter(Boolean);
  const effectiveBatchAdmissionLimit = Math.min(
    run.budgets.maxScanAdmissionsPerBatch,
    control.maxScanAdmissionsPerBatch,
  );
  assertIntegerInRange("externalIds.length", externalIds.length, 1, effectiveBatchAdmissionLimit);
  if (args.dispatchKind === "deterministic") {
    assertFixtureMode(control);
    assertFixtureRun(run);
  } else {
    if (control.mode !== "staging-live") {
      throw new ConvexError("real skills.sh scan admission requires staging-live controls");
    }
    if (run.sourceKind !== "staging-live" || run.fixtureId !== "skills-sh-test-live-500") {
      throw new ConvexError("real skills.sh scan admission requires a staging-live run");
    }
    if (environment.environment !== "test") {
      throw new ConvexError(
        "real skills.sh scan admission requires the permanent Test environment",
      );
    }
    if (externalIds.length > MAX_REAL_TEST_ADMISSIONS) {
      throw new ConvexError(`real Test scan admission cannot exceed ${MAX_REAL_TEST_ADMISSIONS}`);
    }
    const allowlist = new Set(control.realScanAllowlist);
    const denied = externalIds.find((externalId) => !allowlist.has(externalId));
    if (denied) throw new ConvexError(`real Test scan admission is not allowlisted: ${denied}`);
    if (!args.actorUserId) {
      throw new ConvexError("real Test scan admission requires an authenticated operator");
    }
    const actor = await ctx.db.get(args.actorUserId);
    if (actor?.role !== "admin") {
      throw new ConvexError("real Test scan admission requires an admin operator");
    }
  }
  const artifactInputs = args.artifacts ?? [];
  const artifacts = new Map(
    artifactInputs.map((artifact) => [artifact.externalId.trim().toLowerCase(), artifact]),
  );
  if (
    args.dispatchKind === "real" &&
    (artifactInputs.length !== externalIds.length || artifacts.size !== externalIds.length)
  ) {
    throw new ConvexError("real Test scan admission requires exactly one artifact per skill");
  }

  const queueHealth = await readQueueHealth(ctx, control);
  if (!queueHealth.healthy) {
    throw new ConvexError("skills.sh catalog scan admission is blocked by queue health");
  }
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const effectiveDailyAdmissionLimit = Math.min(
    run.budgets.maxScanAdmissionsPerDay,
    control.maxScanAdmissionsPerDay,
  );
  const effectiveRunAdmissionLimit = Math.min(
    run.budgets.maxScanAdmissionsPerRun,
    control.maxScanAdmissionsPerRun,
  );
  const admittedToday = await ctx.db
    .query("skillsShCatalogScanAttempts")
    .withIndex("by_created_at", (q) => q.gte("createdAt", dayStart.getTime()))
    .take(effectiveDailyAdmissionLimit + 1);

  const fixture =
    run.fixtureId === "skills-sh-test-live-500" ? null : getSkillsShCatalogFixture(run.fixtureId);
  const now = Date.now();
  let admitted = 0;
  let skipped = 0;
  const admittedExternalIds: string[] = [];
  let readsUsed = args.dispatchKind === "real" ? 8 : 7;
  let writesUsed = 0;
  const runWriteCount = 1;
  for (const externalId of externalIds) {
    const fixtureRow = fixture?.findByExternalId(externalId);
    const sourceRow = fixtureRow ? normalizeIdentity(fixtureRow) : null;
    if (!sourceRow && run.sourceKind !== "staging-live") {
      skipped += 1;
      continue;
    }
    const entry = await ctx.db
      .query("skillsShCatalogEntries")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .unique();
    readsUsed += 1;
    if (
      !entry ||
      (sourceRow && entry.sourceContentHash !== sourceRow.sourceContentHash) ||
      (run.sourceKind === "staging-live" && entry.sourceSnapshotId !== run.snapshotId) ||
      entry.scanStatus !== "planned"
    ) {
      skipped += 1;
      continue;
    }
    const existingAttempt = await ctx.db
      .query("skillsShCatalogScanAttempts")
      .withIndex("by_entry_and_source_content_hash", (q) =>
        q.eq("entryId", entry._id).eq("sourceContentHash", entry.sourceContentHash),
      )
      .filter((q) => q.neq(q.field("status"), "canceled"))
      .order("desc")
      .first();
    readsUsed += 1;
    if (existingAttempt) {
      skipped += 1;
      continue;
    }
    if (run.counts.scansAdmitted + admitted >= effectiveRunAdmissionLimit) {
      throw new ConvexError("skills.sh catalog run scan-admission budget exceeded");
    }
    if (admittedToday.length + admitted >= effectiveDailyAdmissionLimit) {
      throw new ConvexError("skills.sh catalog daily scan-admission budget exceeded");
    }
    if (queueHealth.catalogQueued + admitted >= control.maxCatalogQueued) {
      throw new ConvexError("skills.sh catalog queued-scan budget exceeded");
    }
    const artifact = artifacts.get(externalId);
    if (args.dispatchKind === "real") {
      if (
        !artifact ||
        !/^[a-f0-9]{64}$/i.test(artifact.artifactContentHash) ||
        artifact.files.length === 0
      ) {
        throw new ConvexError(
          `real Test scan admission requires a fetched artifact: ${externalId}`,
        );
      }
    }
    // skillScanRequests embeds its validated file manifest in one document, so file count
    // does not change the six real-admission writes before the final run patch.
    const admissionWriteCost = args.dispatchKind === "real" ? 6 : 2;
    if (writesUsed + admissionWriteCost + runWriteCount > run.budgets.maxWritesPerBatch) {
      throw new ConvexError("skills.sh catalog scan-admission write budget exceeded");
    }
    const attemptId = await insertCatalogScanAttempt(ctx, {
      entryId: entry._id,
      runId: run._id,
      externalId,
      sourceContentHash: entry.sourceContentHash,
      dispatchKind: args.dispatchKind,
      artifactContentHash: artifact?.artifactContentHash.toLowerCase(),
      now,
    });
    if (args.dispatchKind === "real" && args.actorUserId && artifact) {
      const linked = await enqueueSkillsShCatalogScanRequest(ctx, {
        actorUserId: args.actorUserId,
        attemptId,
        slug: entry.slug,
        displayName: entry.displayName,
        artifactContentHash: artifact.artifactContentHash.toLowerCase(),
        files: artifact.files,
      });
      await ctx.db.patch(attemptId, {
        skillScanRequestId: linked.requestId,
        securityScanJobId: linked.jobId,
        updatedAt: now,
      });
      writesUsed += 4;
    }
    await ctx.db.patch(entry._id, {
      scanStatus: "queued",
      publicVisible: false,
      updatedAt: now,
    });
    writesUsed += 2;
    admitted += 1;
    admittedExternalIds.push(externalId);
  }
  const nextCounts = {
    ...run.counts,
    scansAdmitted: run.counts.scansAdmitted + admitted,
  };
  await ctx.db.patch(run._id, {
    counts: nextCounts,
    scanCursor: run.scanCursor + admitted,
    scanAdmissionBatches: run.scanAdmissionBatches + 1,
    operations: addOperations(run.operations, {
      functionCalls: 1,
      dbReads: readsUsed,
      dbWrites: writesUsed + runWriteCount,
    }),
    updatedAt: now,
  });
  return {
    requested: externalIds.length,
    admitted,
    skipped,
    admittedExternalIds,
    queueHealth,
    counts: nextCounts,
  };
}

export const admitFixtureScansInternal = internalMutation({
  args: {
    runId: v.id("skillsShCatalogRuns"),
    externalIds: v.array(v.string()),
    dispatchKind: dispatchKindValidator,
    actorUserId: v.optional(v.id("users")),
    artifacts: v.optional(v.array(stagingLiveArtifactValidator)),
  },
  handler: async (ctx, args) => {
    if (args.dispatchKind !== "deterministic") {
      throw new ConvexError("real skills.sh scan admission requires stored artifact validation");
    }
    return await admitScans(ctx, args);
  },
});

export const admitValidatedRealScansInternal = internalMutation({
  args: {
    runId: v.id("skillsShCatalogRuns"),
    externalIds: v.array(v.string()),
    actorUserId: v.id("users"),
    artifacts: v.array(stagingLiveArtifactValidator),
  },
  handler: async (ctx, args) => {
    return await admitScans(ctx, {
      ...args,
      dispatchKind: "real",
    });
  },
});

export const admitRealScansInternal: ReturnType<typeof internalAction> = internalAction({
  args: {
    runId: v.id("skillsShCatalogRuns"),
    externalIds: v.array(v.string()),
    actorUserId: v.id("users"),
    artifacts: v.array(stagingLiveArtifactValidator),
  },
  handler: async (ctx, args) => {
    const environment = assertSkillsShFixtureEnvironmentAllowed();
    if (environment.environment !== "test") {
      throw new ConvexError(
        "real skills.sh scan admission requires the permanent Test environment",
      );
    }
    const externalIds = Array.from(
      new Set(args.externalIds.map((externalId) => externalId.trim().toLowerCase())),
    ).filter(Boolean);
    assertIntegerInRange("externalIds.length", externalIds.length, 1, MAX_REAL_TEST_ADMISSIONS);
    const artifactInputs = args.artifacts;
    const artifacts = new Map(
      artifactInputs.map((artifact) => [artifact.externalId.trim().toLowerCase(), artifact]),
    );
    if (artifactInputs.length !== externalIds.length || artifacts.size !== externalIds.length) {
      throw new ConvexError("real Test scan admission requires exactly one artifact per skill");
    }
    const validatedArtifacts = await validateRealScanArtifacts(ctx, externalIds, artifacts);
    return await ctx.runMutation(internal.skillsShCatalog.admitValidatedRealScansInternal, {
      runId: args.runId,
      externalIds,
      actorUserId: args.actorUserId,
      artifacts: Array.from(validatedArtifacts.values()),
    });
  },
});

export const markScanAttemptRunningInternal = internalMutation({
  args: {
    attemptId: v.id("skillsShCatalogScanAttempts"),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const control = assertScanAdmissionEnabled(await getControlDoc(ctx));
    const queueHealth = await readQueueHealth(ctx, control);
    if (!queueHealth.healthy || queueHealth.catalogInFlight >= control.maxCatalogInFlight) {
      throw new ConvexError("skills.sh catalog scan start is blocked by queue health");
    }
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt || attempt.status !== "queued") {
      return { started: false };
    }
    const run = await ctx.db.get(attempt.runId);
    if (attempt.dispatchKind === "deterministic") {
      assertFixtureMode(control);
      if (!run) throw new ConvexError("skills.sh fixture scan run not found");
      assertFixtureRun(run);
    }
    if (
      run &&
      (run.status === "paused" ||
        run.status === "canceling" ||
        run.status === "canceled" ||
        run.status === "failed")
    ) {
      throw new ConvexError(`Cannot start scan for ${run.status} run`);
    }
    const now = Date.now();
    await ctx.db.patch(attempt._id, { status: "running", updatedAt: now });
    if (run) {
      await ctx.db.patch(run._id, {
        operations: addOperations(run.operations, {
          functionCalls: 1,
          dbReads: 7,
          dbWrites: 2,
        }),
        updatedAt: now,
      });
    }
    return { started: true };
  },
});

export const completeDeterministicScansInternal = internalMutation({
  args: {
    runId: v.id("skillsShCatalogRuns"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const control = assertScanAdmissionEnabled(await getControlDoc(ctx));
    assertIntegerInRange("limit", args.limit, 1, MAX_DETERMINISTIC_COMPLETIONS_PER_BATCH);
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError("skills.sh catalog run not found");
    assertFixtureMode(control);
    assertFixtureRun(run);
    if (
      run.status === "paused" ||
      run.status === "canceling" ||
      run.status === "canceled" ||
      run.status === "failed"
    ) {
      throw new ConvexError(`Cannot complete scans for ${run.status} run`);
    }
    const queueHealth = await readQueueHealth(ctx, control);
    if (!queueHealth.healthy) {
      throw new ConvexError("skills.sh deterministic scan completion is blocked by queue health");
    }
    const attempts = await ctx.db
      .query("skillsShCatalogScanAttempts")
      .withIndex("by_run_dispatch_kind_status_created_at", (q) =>
        q.eq("runId", run._id).eq("dispatchKind", "deterministic").eq("status", "queued"),
      )
      .order("asc")
      .take(args.limit);
    const now = Date.now();
    let completed = 0;
    let canceled = 0;
    let readsUsed = 7;
    let writesUsed = 0;
    for (const attempt of attempts) {
      const entry = await ctx.db.get(attempt.entryId);
      readsUsed += 1;
      if (!entry || entry.sourceContentHash !== attempt.sourceContentHash) {
        await ctx.db.patch(attempt._id, {
          status: "canceled",
          completedAt: now,
          updatedAt: now,
        });
        writesUsed += 1;
        canceled += 1;
        continue;
      }
      await ctx.db.patch(attempt._id, {
        status: "succeeded",
        verdict: "clean",
        completedAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(entry._id, {
        scanStatus: "clean",
        publicVisible: false,
        updatedAt: now,
      });
      writesUsed += 2;
      completed += 1;
    }
    const counts = {
      ...run.counts,
      scansCompleted: run.counts.scansCompleted + completed,
      scansCanceled: run.counts.scansCanceled + canceled,
    };
    await ctx.db.patch(run._id, {
      counts,
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: readsUsed,
        dbWrites: writesUsed + 1,
      }),
      updatedAt: now,
    });
    return {
      matched: attempts.length,
      completed,
      canceled,
      counts,
      queueHealth,
    };
  },
});

export const recordRealScanResultInternal = internalMutation({
  args: {
    attemptId: v.id("skillsShCatalogScanAttempts"),
    artifactContentHash: v.string(),
    verdict: scanVerdictValidator,
  },
  handler: async (ctx, args) => {
    const environment = assertSkillsShFixtureEnvironmentAllowed();
    if (environment.environment !== "test") {
      throw new ConvexError("real skills.sh scan results require the permanent Test environment");
    }
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new ConvexError("skills.sh real scan attempt not found");
    if (attempt.dispatchKind !== "real") {
      throw new ConvexError("skills.sh real scan callback requires a real attempt");
    }
    if (attempt.status !== "queued" && attempt.status !== "running") {
      return { applied: false, reason: "attempt-not-active" };
    }
    if (
      !attempt.artifactContentHash ||
      attempt.artifactContentHash !== args.artifactContentHash.toLowerCase()
    ) {
      throw new ConvexError("skills.sh real scan artifact hash mismatch");
    }
    const run = await ctx.db.get(attempt.runId);
    if (!run) throw new ConvexError("skills.sh real scan run not found");
    if (run.status === "canceling" || run.status === "canceled") {
      const now = Date.now();
      const canceledOperations = await cancelAttempt(ctx, attempt, now, {
        allowRunningRealJob: true,
      });
      const hasMore = await hasActiveScanAttemptsForRun(ctx, run._id);
      await ctx.db.patch(run._id, {
        status: hasMore ? "canceling" : "canceled",
        counts: {
          ...run.counts,
          scansCanceled: run.counts.scansCanceled + (canceledOperations.canceled ? 1 : 0),
        },
        operations: addOperations(run.operations, {
          functionCalls: 1,
          dbReads: 4 + canceledOperations.dbReads,
          dbWrites: 1 + canceledOperations.dbWrites,
        }),
        updatedAt: now,
      });
      return { applied: false, reason: "run-canceled" };
    }
    const entry = await ctx.db.get(attempt.entryId);
    if (!entry || entry.sourceContentHash !== attempt.sourceContentHash) {
      const now = Date.now();
      await ctx.db.patch(attempt._id, {
        status: "canceled",
        completedAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(run._id, {
        counts: {
          ...run.counts,
          scansCanceled: run.counts.scansCanceled + 1,
        },
        operations: addOperations(run.operations, {
          functionCalls: 1,
          dbReads: 3,
          dbWrites: 2,
        }),
        updatedAt: now,
      });
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
    await ctx.db.patch(run._id, {
      counts: {
        ...run.counts,
        scansCompleted: run.counts.scansCompleted + 1,
      },
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: 3,
        dbWrites: 3,
      }),
      updatedAt: now,
    });
    return { applied: true, publicVisible: false };
  },
});

export const recordFixtureScanResultInternal = internalMutation({
  args: {
    attemptId: v.id("skillsShCatalogScanAttempts"),
    sourceContentHash: v.string(),
    verdict: scanVerdictValidator,
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    assertFixtureMode(await getControlDoc(ctx));
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new ConvexError("skills.sh fixture scan attempt not found");
    if (attempt.status !== "queued" && attempt.status !== "running") {
      return { applied: false, reason: "attempt-not-active" };
    }
    if (attempt.dispatchKind !== "deterministic") {
      throw new ConvexError("real skills.sh scans require the external artifact-fetch integration");
    }
    if (attempt.sourceContentHash !== args.sourceContentHash) {
      throw new ConvexError("skills.sh fixture source observation hash mismatch");
    }
    const run = await ctx.db.get(attempt.runId);
    if (!run) throw new ConvexError("skills.sh fixture scan run not found");
    assertFixtureRun(run);
    if (run.status === "canceling" || run.status === "canceled") {
      const now = Date.now();
      const canceledOperations = await cancelAttempt(ctx, attempt, now);
      const hasMore = await hasActiveScanAttemptsForRun(ctx, run._id);
      await ctx.db.patch(run._id, {
        status: hasMore ? "canceling" : "canceled",
        counts: {
          ...run.counts,
          scansCanceled: run.counts.scansCanceled + (canceledOperations.canceled ? 1 : 0),
        },
        operations: addOperations(run.operations, {
          functionCalls: 1,
          dbReads: 4 + canceledOperations.dbReads,
          dbWrites: 1 + canceledOperations.dbWrites,
        }),
        updatedAt: now,
      });
      return { applied: false, reason: "run-canceled" };
    }
    const entry = await ctx.db.get(attempt.entryId);
    if (!entry || entry.sourceContentHash !== args.sourceContentHash) {
      const now = Date.now();
      await ctx.db.patch(attempt._id, {
        status: "canceled",
        completedAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(run._id, {
        counts: {
          ...run.counts,
          scansCanceled: run.counts.scansCanceled + 1,
        },
        operations: addOperations(run.operations, {
          functionCalls: 1,
          dbReads: 3,
          dbWrites: 2,
        }),
        updatedAt: now,
      });
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
    await ctx.db.patch(run._id, {
      counts: {
        ...run.counts,
        scansCompleted: run.counts.scansCompleted + 1,
      },
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: 3,
        dbWrites: 3,
      }),
      updatedAt: now,
    });
    return { applied: true, publicVisible: false };
  },
});

export const cancelCatalogRunInternal = internalMutation({
  args: {
    runId: v.id("skillsShCatalogRuns"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    assertIntegerInRange("limit", args.limit, 1, 100);
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError("skills.sh catalog run not found");
    const [queued, running] = await Promise.all([
      ctx.db
        .query("skillsShCatalogScanAttempts")
        .withIndex("by_run_and_status", (q) => q.eq("runId", run._id).eq("status", "queued"))
        .take(args.limit + 1),
      ctx.db
        .query("skillsShCatalogScanAttempts")
        .withIndex("by_run_and_status", (q) => q.eq("runId", run._id).eq("status", "running"))
        .take(args.limit + 1),
    ]);
    const active = [...queued, ...running].slice(0, args.limit);
    const now = Date.now();
    let attemptReads = 0;
    let attemptWrites = 0;
    let canceled = 0;
    let deferred = 0;
    for (const attempt of active) {
      const operations = await cancelAttempt(ctx, attempt, now);
      attemptReads += operations.dbReads;
      attemptWrites += operations.dbWrites;
      if (operations.canceled) canceled += 1;
      else deferred += 1;
    }
    const hasMore = queued.length + running.length > active.length || deferred > 0;
    const counts = {
      ...run.counts,
      scansCanceled: run.counts.scansCanceled + canceled,
    };
    await ctx.db.patch(run._id, {
      status: hasMore ? "canceling" : "canceled",
      counts,
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: 3 + attemptReads,
        dbWrites: 1 + attemptWrites,
      }),
      updatedAt: now,
    });
    return {
      canceled,
      hasMore,
      status: hasMore ? ("canceling" as const) : ("canceled" as const),
      counts,
    };
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
      .withIndex("by_dispatch_kind_and_status_and_created_at", (q) =>
        q.eq("dispatchKind", "deterministic").eq("status", "queued"),
      )
      .order("asc")
      .take(args.limit);
    const now = Date.now();
    let canceled = 0;
    for (const attempt of queued) {
      const result = await cancelAttempt(ctx, attempt, now);
      if (!result.canceled) continue;
      canceled += 1;
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
    return { matched: queued.length, canceled };
  },
});

export const listRealScanQueueInternal = internalQuery({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    assertIntegerInRange("limit", args.limit, 1, MAX_REAL_TEST_ADMISSIONS);
    const queued = await ctx.db
      .query("skillsShCatalogScanAttempts")
      .withIndex("by_dispatch_kind_and_status_and_created_at", (q) =>
        q.eq("dispatchKind", "real").eq("status", "queued"),
      )
      .order("asc")
      .take(args.limit);
    return queued.map((attempt) => ({
      ...attempt,
      requiresArtifactFetch: !attempt.artifactContentHash,
    }));
  },
});

export const listEntriesPageInternal = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("skillsShCatalogEntries")
      .withIndex("by_external_id")
      .paginate(args.paginationOpts);
  },
});

export const resolveKnownGitHubOwnersInternal = internalQuery({
  args: {
    owners: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const environment = assertSkillsShFixtureEnvironmentAllowed();
    if (environment.environment !== "test") {
      throw new ConvexError(
        "skills.sh stored owner resolution is available only in permanent Test",
      );
    }
    const owners = Array.from(
      new Set(
        args.owners.map((owner) => {
          const normalized = owner.trim().toLowerCase();
          if (!normalized) throw new ConvexError("GitHub owner must be a non-empty string");
          return normalized;
        }),
      ),
    ).sort();
    assertIntegerInRange("owners.length", owners.length, 1, 500);

    const resolved: Array<{ owner: string; login: string; id: number }> = [];
    const missingOwners: string[] = [];
    for (const owner of owners) {
      // Staging-live rows preserve the immutable GitHub identity established by
      // the authenticated first import. A mutable login must not silently
      // reassign existing catalog ownership during an identical refresh.
      const [first, last] = await Promise.all([
        ctx.db
          .query("skillsShCatalogEntries")
          .withIndex("by_owner_and_source_kind_and_github_owner_id", (q) =>
            q.eq("owner", owner).eq("sourceKind", "staging-live"),
          )
          .order("asc")
          .first(),
        ctx.db
          .query("skillsShCatalogEntries")
          .withIndex("by_owner_and_source_kind_and_github_owner_id", (q) =>
            q.eq("owner", owner).eq("sourceKind", "staging-live"),
          )
          .order("desc")
          .first(),
      ]);
      if (first?.githubOwnerId !== last?.githubOwnerId) {
        throw new ConvexError(`Conflicting authenticated GitHub owner ids for ${owner}`);
      }
      const id = first?.githubOwnerId;
      if (!id) {
        missingOwners.push(owner);
        continue;
      }
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new ConvexError(`Invalid authenticated GitHub owner id for ${owner}`);
      }
      resolved.push({ owner, login: owner, id });
    }
    return {
      provenance: "stored-authenticated-staging-live" as const,
      owners: resolved,
      missingOwners,
    };
  },
});

export const assertFreshGitHubOwnerAssignmentsInternal = internalQuery({
  args: {
    owners: v.array(
      v.object({
        owner: v.string(),
        id: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const environment = assertSkillsShFixtureEnvironmentAllowed();
    if (environment.environment !== "test") {
      throw new ConvexError(
        "skills.sh owner assignment validation is available only in permanent Test",
      );
    }
    assertIntegerInRange("owners.length", args.owners.length, 1, 500);

    const byOwner = new Map<string, number>();
    const byId = new Map<number, string>();
    for (const assignment of args.owners) {
      const owner = assignment.owner.trim().toLowerCase();
      if (!owner) throw new ConvexError("GitHub owner must be a non-empty string");
      if (!Number.isSafeInteger(assignment.id) || assignment.id <= 0) {
        throw new ConvexError(`Invalid authenticated GitHub owner id for ${owner}`);
      }
      const existingId = byOwner.get(owner);
      if (existingId !== undefined && existingId !== assignment.id) {
        throw new ConvexError(`Conflicting authenticated GitHub owner ids for ${owner}`);
      }
      const existingOwner = byId.get(assignment.id);
      if (existingOwner !== undefined && existingOwner !== owner) {
        throw new ConvexError(
          `Authenticated GitHub owner id ${assignment.id} is assigned to multiple owners`,
        );
      }
      byOwner.set(owner, assignment.id);
      byId.set(assignment.id, owner);
    }

    for (const [owner, id] of byOwner) {
      const [first, last] = await Promise.all([
        ctx.db
          .query("skillsShCatalogEntries")
          .withIndex("by_source_kind_and_github_owner_id_and_owner", (q) =>
            q.eq("sourceKind", "staging-live").eq("githubOwnerId", id),
          )
          .order("asc")
          .first(),
        ctx.db
          .query("skillsShCatalogEntries")
          .withIndex("by_source_kind_and_github_owner_id_and_owner", (q) =>
            q.eq("sourceKind", "staging-live").eq("githubOwnerId", id),
          )
          .order("desc")
          .first(),
      ]);
      if ((first !== null && first.owner !== owner) || (last !== null && last.owner !== owner)) {
        throw new ConvexError(
          `Authenticated GitHub owner id ${id} is already assigned to another owner`,
        );
      }
    }
    return {
      provenance: "stored-authenticated-staging-live-assignment-check" as const,
      checked: byOwner.size,
    };
  },
});

export const getRunInternal = internalQuery({
  args: {
    runId: v.id("skillsShCatalogRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    return run ? summarizeRun(run) : null;
  },
});

export const getStagingLiveControlInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const environment = assertSkillsShFixtureEnvironmentAllowed();
    if (environment.environment !== "test") {
      throw new ConvexError("skills.sh staging control is available only in permanent Test");
    }
    return {
      environment: environment.environment,
      deploymentName: process.env.CLAWHUB_DEPLOYMENT_NAME ?? null,
      buildSha: process.env.APP_BUILD_SHA ?? null,
      control: summarizeControl(await getControlDoc(ctx)),
    };
  },
});

export const listRunScanAttemptsPageInternal = internalQuery({
  args: {
    runId: v.id("skillsShCatalogRuns"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("skillsShCatalogScanAttempts")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .paginate(args.paginationOpts);
  },
});

export const listScanAttemptsPageInternal = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("skillsShCatalogScanAttempts")
      .withIndex("by_created_at")
      .paginate(args.paginationOpts);
  },
});

export const listNativeSkillsIsolationPageInternal = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db.query("skills").paginate(args.paginationOpts);
  },
});

export const listNativeScanJobsIsolationPageInternal = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db.query("securityScanJobs").paginate(args.paginationOpts);
  },
});

export const getIsolationDigestInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [skills, nativeQueued, nativeRunning, nativeSucceeded, nativeFailed] = await Promise.all([
      ctx.db.query("skills").take(1_001),
      ctx.db
        .query("securityScanJobs")
        .withIndex("by_status_and_next_run_at", (q) => q.eq("status", "queued"))
        .take(251),
      ctx.db
        .query("securityScanJobs")
        .withIndex("by_status_and_updated_at", (q) => q.eq("status", "running"))
        .take(251),
      ctx.db
        .query("securityScanJobs")
        .withIndex("by_status_and_updated_at", (q) => q.eq("status", "succeeded"))
        .take(251),
      ctx.db
        .query("securityScanJobs")
        .withIndex("by_status_and_updated_at", (q) => q.eq("status", "failed"))
        .take(251),
    ]);
    return {
      nativeSkills: {
        count: skills.length,
        isEstimate: skills.length > 1_000,
        updatedAtSum: skills.reduce((sum, skill) => sum + skill.updatedAt, 0),
      },
      nativeScanJobs: {
        queued: nativeQueued.length,
        running: nativeRunning.length,
        succeeded: nativeSucceeded.length,
        failed: nativeFailed.length,
      },
    };
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
    wouldInsert: 0,
    wouldUpdate: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    scansPlanned: 0,
    scansAdmitted: 0,
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
    existing.githubRepoUrl === row.githubRepoUrl &&
    existing.sourceContentHash === row.sourceContentHash &&
    existing.installs === row.installs
  );
}

function scanStatusFromAttempt(
  attempt: Doc<"skillsShCatalogScanAttempts">,
): Doc<"skillsShCatalogEntries">["scanStatus"] {
  if (attempt.status === "queued" || attempt.status === "running") return "queued";
  if (attempt.status === "canceled") return "canceled";
  return attempt.verdict ?? "failed";
}

function fixtureObservationConflicts(
  existing: Doc<"skillsShCatalogEntries">,
  row: ReturnType<typeof normalizeIdentity>,
  sourceKind: Doc<"skillsShCatalogEntries">["sourceKind"],
) {
  return existing.sourceKind !== sourceKind || existing.githubOwnerId !== row.githubOwnerId;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateRealScanArtifacts(
  ctx: ActionCtx,
  externalIds: string[],
  artifacts: Map<string, StagingLiveArtifact>,
) {
  const validated = new Map<string, StagingLiveArtifact>();
  for (const externalId of externalIds) {
    const artifact = artifacts.get(externalId);
    if (!artifact || !/^[a-f0-9]{64}$/i.test(artifact.artifactContentHash)) {
      throw new ConvexError(`real Test scan admission requires a fetched artifact: ${externalId}`);
    }
    const paths = new Set<string>();
    const files = [];
    for (const file of artifact.files) {
      if (file.path !== file.path.trim() || !validateFilePath(file.path) || paths.has(file.path)) {
        throw new ConvexError(
          `real Test scan artifact has an unsafe or duplicate path: ${file.path}`,
        );
      }
      paths.add(file.path);
      if (
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        !/^[a-f0-9]{64}$/i.test(file.sha256)
      ) {
        throw new ConvexError(`real Test scan artifact has invalid file metadata: ${file.path}`);
      }
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) {
        throw new ConvexError(`real Test scan artifact file is missing from storage: ${file.path}`);
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.byteLength !== file.size) {
        throw new ConvexError(`real Test scan artifact file size mismatch: ${file.path}`);
      }
      const sha256 = await sha256Hex(bytes);
      if (sha256 !== file.sha256.toLowerCase()) {
        throw new ConvexError(`real Test scan artifact file hash mismatch: ${file.path}`);
      }
      files.push({ ...file, sha256 });
    }
    if (files.length === 0) {
      throw new ConvexError(`real Test scan admission requires a fetched artifact: ${externalId}`);
    }
    files.sort((left, right) => left.path.localeCompare(right.path));
    const manifest = files.map((file) => `${file.path}\0${file.sha256}\n`).join("");
    const artifactContentHash = await sha256Hex(new TextEncoder().encode(manifest));
    if (artifactContentHash !== artifact.artifactContentHash.toLowerCase()) {
      throw new ConvexError(`real Test scan artifact manifest hash mismatch: ${externalId}`);
    }
    validated.set(externalId, {
      externalId,
      artifactContentHash,
      files,
    });
  }
  return validated;
}

async function insertCatalogScanAttempt(
  ctx: MutationCtx,
  args: {
    entryId: Id<"skillsShCatalogEntries">;
    runId: Id<"skillsShCatalogRuns">;
    externalId: string;
    sourceContentHash: string;
    dispatchKind: "deterministic" | "real";
    artifactContentHash?: string;
    now: number;
  },
) {
  return await ctx.db.insert("skillsShCatalogScanAttempts", {
    entryId: args.entryId,
    runId: args.runId,
    externalId: args.externalId,
    sourceContentHash: args.sourceContentHash,
    ...(args.artifactContentHash ? { artifactContentHash: args.artifactContentHash } : {}),
    source: args.dispatchKind === "real" ? "skills-sh-catalog-test" : "skills-sh-catalog-fixture",
    dispatchKind: args.dispatchKind,
    priority: "low",
    status: "queued",
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function cancelAttempt(
  ctx: MutationCtx,
  attempt: Doc<"skillsShCatalogScanAttempts">,
  now: number,
  options: {
    allowRunningRealJob?: boolean;
  } = {},
) {
  let dbReads = 1;
  let dbWrites = 0;
  if (attempt.securityScanJobId) {
    const job = await ctx.db.get(attempt.securityScanJobId);
    dbReads += 1;
    const activeRealJobLease =
      attempt.dispatchKind === "real" &&
      job?.source === "skills-sh-catalog-test" &&
      job.status === "running" &&
      typeof job.leaseExpiresAt === "number" &&
      job.leaseExpiresAt > now;
    if (activeRealJobLease && !options.allowRunningRealJob) {
      return { canceled: false, dbReads, dbWrites };
    }
    if (
      job?.source === "skills-sh-catalog-test" &&
      (job.status === "queued" || job.status === "running")
    ) {
      const cancellationError =
        job.status === "running" && !activeRealJobLease && !options.allowRunningRealJob
          ? "Catalog run canceled after scan lease expired"
          : "Catalog run canceled before scan completion";
      if (job.status === "queued") {
        await ctx.db.delete(job._id);
      } else {
        await ctx.db.patch(job._id, {
          status: "failed",
          lastError: cancellationError,
          completedAt: now,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          workerId: undefined,
          updatedAt: now,
        });
      }
      dbWrites += 1;
      if (attempt.skillScanRequestId) {
        const request = await ctx.db.get(attempt.skillScanRequestId);
        dbReads += 1;
        if (request) {
          await ctx.db.patch(request._id, {
            status: "failed",
            lastError:
              job.status === "queued"
                ? "Catalog run canceled before scan start"
                : cancellationError,
            completedAt: now,
            updatedAt: now,
          });
          dbWrites += 1;
        }
      }
    }
  }
  await ctx.db.patch(attempt._id, {
    status: "canceled",
    completedAt: now,
    updatedAt: now,
  });
  dbWrites += 1;
  const entry = await ctx.db.get(attempt.entryId);
  if (entry?.scanStatus === "queued" && entry.sourceContentHash === attempt.sourceContentHash) {
    await ctx.db.patch(entry._id, {
      scanStatus: "canceled",
      publicVisible: false,
      updatedAt: now,
    });
    return { canceled: true, dbReads, dbWrites: dbWrites + 1 };
  }
  return { canceled: true, dbReads, dbWrites };
}

async function hasActiveScanAttemptsForRun(ctx: MutationCtx, runId: Id<"skillsShCatalogRuns">) {
  const [queued, running] = await Promise.all([
    ctx.db
      .query("skillsShCatalogScanAttempts")
      .withIndex("by_run_and_status", (q) => q.eq("runId", runId).eq("status", "queued"))
      .first(),
    ctx.db
      .query("skillsShCatalogScanAttempts")
      .withIndex("by_run_and_status", (q) => q.eq("runId", runId).eq("status", "running"))
      .first(),
  ]);
  return Boolean(queued || running);
}

function addOperations(current: OperationCounts, added: OperationCounts) {
  return {
    functionCalls: current.functionCalls + added.functionCalls,
    dbReads: current.dbReads + added.dbReads,
    dbWrites: current.dbWrites + added.dbWrites,
  };
}

function summarizeRun(run: Doc<"skillsShCatalogRuns">) {
  return {
    _id: run._id,
    fixtureId: run.fixtureId,
    snapshotId: run.snapshotId,
    sourceKind: run.sourceKind,
    sourceCapturedAt: run.sourceCapturedAt,
    snapshotCaptureFetches: run.snapshotCaptureFetches,
    dryRun: run.dryRun,
    status: run.status,
    cursor: run.cursor,
    scanCursor: run.scanCursor,
    fixtureLength: run.fixtureLength,
    counts: run.counts,
    budgets: run.budgets,
    operations: run.operations,
    actor: run.actor,
    reason: run.reason,
    lastError: run.lastError,
    errors: run.lastError ? [run.lastError] : [],
    operationsAreEstimates: true,
    budgetConsumed: {
      entriesObserved: run.counts.observed,
      scansPlanned: run.counts.scansPlanned,
      scansAdmitted: run.counts.scansAdmitted,
      batchesProcessed: run.batchesProcessed,
      scanAdmissionBatches: run.scanAdmissionBatches,
      lastBatchWrites: run.lastBatchWrites,
      lastBatchReads: run.lastBatchReads,
    },
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    runtimeMs: (run.completedAt ?? run.updatedAt) - run.startedAt,
    updatedAt: run.updatedAt,
  };
}
