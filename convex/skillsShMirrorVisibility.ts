import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";
import {
  assertSkillsShPublicVisibilityMutationAllowed,
  isSkillsShMirrorSourceEligible,
  skillsShMirrorPublicationFlags,
} from "./lib/skillsShPublicVisibility";

const CONTROL_KEY = "global";
const MAX_BATCH_SIZE = 100;
const MAX_ROWS = 50_000;
// Convex actions time out before this lease. A later action may safely replace
// an abandoned token, while the old action can no longer finalize or release it.
const ACTIVATION_LOCK_LEASE_MS = 15 * 60_000;

const internalRefs = internal as unknown as {
  canonicalTrending: { getReadyNativeSnapshotInternal: unknown; materializeInternal: unknown };
  skillsShMirrorVisibility: {
    beginActivationInternal: unknown;
    beginDeactivationInternal: unknown;
    beginNativeTrendingInternal: unknown;
    finalizeActivationInternal: unknown;
    releaseActivationInternal: unknown;
    setPublicGateInternal: unknown;
  };
};

type EligibilityBatchResult = {
  continueCursor: string;
  isDone: boolean;
  scanned: number;
  changed: number;
  eligible: number;
  hiddenEligible: number;
  unsafePublished: number;
};

type MirrorRun = Doc<"skillsShMirrorRuns">;

function requireCompletedRun(run: MirrorRun | null, sourceView: "leaderboard" | "trending") {
  if (!run || run.status !== "completed" || (run.sourceView ?? "leaderboard") !== sourceView) {
    throw new Error(`latest skills.sh ${sourceView} run is not complete`);
  }
  if (run.counts.observed !== run.sourceTotal) {
    throw new Error(`skills.sh ${sourceView} source accounting is incomplete`);
  }
  if (run.counts.scansPlanned !== 0 || run.counts.scansAdmitted !== 0) {
    throw new Error(`skills.sh ${sourceView} run scheduled a ClawHub scan`);
  }
  return run;
}

function verifyLeaderboardRun(run: MirrorRun) {
  const accepted = run.counts.inserted + run.counts.updated + run.counts.unchanged;
  const rejected = run.counts.rejected;
  const quarantined = run.counts.quarantined ?? 0;
  const detailsAccounted =
    run.counts.detailsInserted +
    run.counts.detailsUpdated +
    run.counts.detailsUnchanged +
    run.counts.detailsMissing;
  if (accepted + rejected !== run.counts.observed) {
    throw new Error("skills.sh leaderboard accepted and rejected counts do not cover the source");
  }
  if (run.counts.conflicts !== rejected || quarantined !== rejected) {
    throw new Error("skills.sh leaderboard rejection and quarantine accounting differs");
  }
  if (detailsAccounted !== accepted) {
    throw new Error("skills.sh leaderboard detail accounting differs from accepted rows");
  }
  return { sourceTotal: run.sourceTotal, accepted, rejected };
}

function verifyTrendingRun(run: MirrorRun) {
  const joined = run.counts.trendingJoined ?? 0;
  const missing = run.counts.trendingMissing ?? 0;
  if (joined + missing !== run.counts.observed) {
    throw new Error("skills.sh Trending joined and missing counts do not cover the source");
  }
  return {
    sourceTotal: run.sourceTotal,
    joined,
    missing,
    updated: run.counts.trendingUpdated ?? 0,
    hydrated: run.counts.trendingHydrated ?? 0,
  };
}

export const getActivationPreflightInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [control, running, paused, reconciling, recentRuns] = await Promise.all([
      ctx.db
        .query("skillsShMirrorControls")
        .withIndex("by_key", (q) => q.eq("key", CONTROL_KEY))
        .unique(),
      ctx.db
        .query("skillsShMirrorRuns")
        .withIndex("by_status_and_updated_at", (q) => q.eq("status", "running"))
        .order("desc")
        .first(),
      ctx.db
        .query("skillsShMirrorRuns")
        .withIndex("by_status_and_updated_at", (q) => q.eq("status", "paused"))
        .order("desc")
        .first(),
      ctx.db
        .query("skillsShMirrorRuns")
        .withIndex("by_status_and_updated_at", (q) => q.eq("status", "reconciling"))
        .order("desc")
        .first(),
      ctx.db.query("skillsShMirrorRuns").withIndex("by_started_at").order("desc").take(50),
    ]);
    const leaderboard = control?.latestCompletedLeaderboardRunId
      ? await ctx.db.get(control.latestCompletedLeaderboardRunId)
      : null;
    const trending = recentRuns.find(
      (run) => run.status === "completed" && run.sourceView === "trending",
    );
    return {
      activeRun: running ?? paused ?? reconciling,
      leaderboard,
      trending: trending ?? null,
    };
  },
});

export const getConflictCountPageInternal = internalQuery({
  args: {
    runId: v.id("skillsShMirrorRuns"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("skillsShMirrorConflicts")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .paginate(args.paginationOpts);
    return {
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      count: page.page.length,
    };
  },
});

async function countRunConflicts(ctx: Pick<ActionCtx, "runQuery">, runId: MirrorRun["_id"]) {
  let cursor: string | null = null;
  let count = 0;
  while (true) {
    const page = (await ctx.runQuery(
      internal.skillsShMirrorVisibility.getConflictCountPageInternal,
      {
        runId,
        paginationOpts: { cursor, numItems: MAX_BATCH_SIZE },
      },
    )) as { continueCursor: string; isDone: boolean; count: number };
    count += page.count;
    if (count > MAX_ROWS) {
      throw new Error(`skills.sh conflict audit exceeded ${MAX_ROWS} rows`);
    }
    if (page.isDone) return count;
    cursor = page.continueCursor;
  }
}

export const reconcileEligibilityBatchInternal = internalMutation({
  args: {
    confirm: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args): Promise<EligibilityBatchResult> => {
    assertSkillsShPublicVisibilityMutationAllowed({
      activate: true,
      confirm: args.confirm,
    });
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > MAX_BATCH_SIZE) {
      throw new Error(`eligibility batch size must be between 1 and ${MAX_BATCH_SIZE}`);
    }

    const page = await ctx.db
      .query("skillsShMirrorDigests")
      .order("asc")
      .paginate(args.paginationOpts);
    let changed = 0;
    let eligible = 0;
    let hiddenEligible = 0;
    let unsafePublished = 0;
    for (const digest of page.page) {
      const expected = skillsShMirrorPublicationFlags(digest);
      if (expected.publicVisible) eligible += 1;
      if (expected.publicVisible && (!digest.publicVisible || !digest.installable)) {
        hiddenEligible += 1;
      }
      if (!expected.publicVisible && (digest.publicVisible || digest.installable)) {
        unsafePublished += 1;
      }
      if (
        digest.publicVisible === expected.publicVisible &&
        digest.installable === expected.installable
      ) {
        continue;
      }
      await ctx.db.patch(digest._id, expected);
      changed += 1;
    }

    return {
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      scanned: page.page.length,
      changed,
      eligible,
      hiddenEligible,
      unsafePublished,
    };
  },
});

async function reconcileEligibility(ctx: Pick<ActionCtx, "runMutation">, confirm: string) {
  const environment = assertSkillsShPublicVisibilityMutationAllowed({
    activate: true,
    confirm,
  });
  let cursor: string | null = null;
  let scanned = 0;
  let changed = 0;
  let eligible = 0;
  let hiddenEligible = 0;
  let unsafePublished = 0;
  let batches = 0;

  while (true) {
    const result: EligibilityBatchResult = await ctx.runMutation(
      internal.skillsShMirrorVisibility.reconcileEligibilityBatchInternal,
      {
        confirm,
        paginationOpts: { cursor, numItems: MAX_BATCH_SIZE },
      },
    );
    scanned += result.scanned;
    changed += result.changed;
    eligible += result.eligible;
    hiddenEligible += result.hiddenEligible;
    unsafePublished += result.unsafePublished;
    batches += 1;
    if (scanned > MAX_ROWS) {
      throw new Error(`skills.sh eligibility reconciliation exceeded ${MAX_ROWS} rows`);
    }
    if (result.isDone) break;
    cursor = result.continueCursor;
  }

  return {
    ok: true as const,
    environment,
    batches,
    scanned,
    changed,
    eligible,
    hiddenEligible,
    unsafePublished,
    scansPlanned: 0 as const,
    scansAdmitted: 0 as const,
  };
}

export const reconcileEligibilityInternal = internalAction({
  args: { confirm: v.string() },
  handler: async (ctx, args) => await reconcileEligibility(ctx, args.confirm),
});

function publicGateValue(args: { enabled: boolean; actor: string; reason: string; now: number }) {
  return {
    mode: "staging-live" as const,
    discoveryEnabled: true,
    writesEnabled: false,
    scanPlanningEnabled: false,
    scanAdmissionEnabled: false,
    publicVisibilityEnabled: false,
    mirrorPublicVisibilityEnabled: args.enabled,
    paused: false,
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
    realScanAllowlist: [],
    updatedBy: args.actor,
    reason: args.reason,
    updatedAt: args.now,
  };
}

function disabledMirrorControl(args: {
  actor: string;
  reason: string;
  now: number;
  lockToken: string;
}) {
  return {
    enabled: false,
    paused: true,
    maxRowsPerRun: 0,
    maxRowsPerBatch: 0,
    maxDetailBytes: 0,
    activationLockToken: args.lockToken,
    activationLockedAt: args.now,
    updatedBy: args.actor,
    reason: args.reason,
    updatedAt: args.now,
  };
}

async function writePublicGate(
  ctx: Pick<MutationCtx, "db">,
  args: { enabled: boolean; actor: string; reason: string; now: number },
) {
  const existing = await ctx.db
    .query("skillsShCatalogControls")
    .withIndex("by_key", (q) => q.eq("key", CONTROL_KEY))
    .unique();
  const next = publicGateValue(args);
  if (existing) {
    await ctx.db.patch(existing._id, {
      mirrorPublicVisibilityEnabled: args.enabled,
      updatedBy: args.actor,
      reason: args.reason,
      updatedAt: args.now,
    });
  } else {
    await ctx.db.insert("skillsShCatalogControls", { key: CONTROL_KEY, ...next });
  }
}

export const setPublicGateInternal = internalMutation({
  args: {
    enabled: v.boolean(),
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.enabled) {
      throw new Error("only the verified activation action can enable the skills.sh public gate");
    }
    const environment = assertSkillsShPublicVisibilityMutationAllowed({
      activate: false,
      confirm: args.confirm,
    });
    const actor = args.actor.trim();
    const reason = args.reason.trim();
    if (!actor || !reason) throw new Error("skills.sh public gate actor and reason are required");
    const now = Date.now();
    const mirrorControl = await ctx.db
      .query("skillsShMirrorControls")
      .withIndex("by_key", (q) => q.eq("key", CONTROL_KEY))
      .unique();
    if (mirrorControl) {
      await ctx.db.patch(mirrorControl._id, {
        activationLockToken: undefined,
        activationLockedAt: undefined,
        activationLeaderboardRunId: undefined,
        activationTrendingRunId: undefined,
        updatedBy: actor,
        reason,
        updatedAt: now,
      });
    }
    await writePublicGate(ctx, { enabled: false, actor, reason, now });
    return {
      ok: true as const,
      environment,
      enabled: false,
      updatedAt: now,
      scansPlanned: 0 as const,
      scansAdmitted: 0 as const,
    };
  },
});

export const beginDeactivationInternal = internalMutation({
  args: {
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
    lockToken: v.string(),
  },
  handler: async (ctx, args) => {
    const environment = assertSkillsShPublicVisibilityMutationAllowed({
      activate: false,
      confirm: args.confirm,
    });
    const actor = args.actor.trim();
    const reason = args.reason.trim();
    const lockToken = args.lockToken.trim();
    if (!actor || !reason || !lockToken) {
      throw new Error("skills.sh deactivation actor, reason, and lock token are required");
    }
    const now = Date.now();
    const mirrorControl = await ctx.db
      .query("skillsShMirrorControls")
      .withIndex("by_key", (q) => q.eq("key", CONTROL_KEY))
      .unique();
    await writePublicGate(ctx, { enabled: false, actor, reason, now });
    if (mirrorControl) {
      await ctx.db.patch(mirrorControl._id, {
        activationLockToken: lockToken,
        activationLockedAt: now,
        activationLeaderboardRunId: undefined,
        activationTrendingRunId: undefined,
        updatedBy: actor,
        reason,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("skillsShMirrorControls", {
        key: CONTROL_KEY,
        ...disabledMirrorControl({ actor, reason, now, lockToken }),
      });
    }
    return {
      ok: true as const,
      environment,
      enabled: false as const,
      updatedAt: now,
      scansPlanned: 0 as const,
      scansAdmitted: 0 as const,
    };
  },
});

export const beginNativeTrendingInternal = internalMutation({
  args: {
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
    lockToken: v.string(),
  },
  handler: async (ctx, args) => {
    const environment = assertSkillsShPublicVisibilityMutationAllowed({
      activate: false,
      confirm: args.confirm,
    });
    const actor = args.actor.trim();
    const reason = args.reason.trim();
    const lockToken = args.lockToken.trim();
    if (!actor || !reason || !lockToken) {
      throw new Error("skills.sh native Trending actor, reason, and lock token are required");
    }
    const now = Date.now();
    const [catalogControl, mirrorControl] = await Promise.all([
      ctx.db
        .query("skillsShCatalogControls")
        .withIndex("by_key", (q) => q.eq("key", CONTROL_KEY))
        .unique(),
      ctx.db
        .query("skillsShMirrorControls")
        .withIndex("by_key", (q) => q.eq("key", CONTROL_KEY))
        .unique(),
    ]);
    if (catalogControl?.mirrorPublicVisibilityEnabled === true) {
      throw new Error("skills.sh native Trending preflight requires a closed public gate");
    }
    if (
      mirrorControl?.activationLockToken &&
      mirrorControl.activationLockToken !== lockToken &&
      mirrorControl.activationLockedAt !== undefined &&
      mirrorControl.activationLockedAt > now - ACTIVATION_LOCK_LEASE_MS
    ) {
      throw new Error("another skills.sh public activation is in progress");
    }
    if (mirrorControl) {
      await ctx.db.patch(mirrorControl._id, {
        activationLockToken: lockToken,
        activationLockedAt: now,
        activationLeaderboardRunId: undefined,
        activationTrendingRunId: undefined,
        updatedBy: actor,
        reason,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("skillsShMirrorControls", {
        key: CONTROL_KEY,
        ...disabledMirrorControl({ actor, reason, now, lockToken }),
      });
    }
    return { environment, lockToken };
  },
});

async function materializeNativeTrending(
  ctx: Pick<ActionCtx, "runAction" | "runQuery">,
  lockToken: string,
) {
  const reusable = (await ctx.runQuery(
    internalRefs.canonicalTrending.getReadyNativeSnapshotInternal as never,
    { now: Date.now() } as never,
  )) as {
    status: "ready";
    snapshotId: string;
    sourceCounts: { clawhubTrending: number; clawhubRising: number; skillsShTrending: 0 };
    reused: true;
  } | null;
  // Native-only data is independent of skills.sh run chronology. The activation path
  // always materializes its mixed snapshot after verifying the exact imported runs.
  if (reusable) return reusable;
  const nativeTrending = (await ctx.runAction(
    internalRefs.canonicalTrending.materializeInternal as never,
    { activationLockToken: lockToken, skillsShMode: "native-only" } as never,
  )) as {
    status: "ready" | "unavailable";
    snapshotId?: string;
    sourceCounts?: { clawhubTrending: number; clawhubRising: number; skillsShTrending: number };
  };
  if (nativeTrending.status !== "ready" || nativeTrending.sourceCounts?.skillsShTrending !== 0) {
    throw new Error("native-only canonical Trending did not become ready");
  }
  return nativeTrending;
}

async function materializeNativeTrendingWithLock(
  ctx: Pick<ActionCtx, "runAction" | "runMutation" | "runQuery">,
  args: { actor: string; reason: string; confirm: string },
) {
  const lockToken = `skills-sh-native-trending:${crypto.randomUUID()}`;
  const locked = (await ctx.runMutation(
    internalRefs.skillsShMirrorVisibility.beginNativeTrendingInternal as never,
    { ...args, lockToken } as never,
  )) as { environment: "test" | "production" };
  try {
    return {
      environment: locked.environment,
      nativeTrending: await materializeNativeTrending(ctx, lockToken),
    };
  } finally {
    await ctx.runMutation(
      internalRefs.skillsShMirrorVisibility.releaseActivationInternal as never,
      { lockToken } as never,
    );
  }
}

export const prepareNativeTrendingInternal = internalAction({
  args: {
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
  },
  handler: async (ctx, args) => {
    const { environment, nativeTrending } = await materializeNativeTrendingWithLock(ctx, args);
    return {
      ok: true as const,
      environment,
      nativeTrending,
      scansPlanned: 0 as const,
      scansAdmitted: 0 as const,
    };
  },
});

export const deactivateAndMaterializeInternal = internalAction({
  args: {
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
  },
  handler: async (ctx, args) => {
    const lockToken = `skills-sh-native-trending:${crypto.randomUUID()}`;
    // Close the gate and replace any activation lock atomically so an
    // in-flight or newly starting activation cannot reopen the lane.
    const deactivation = (await ctx.runMutation(
      internalRefs.skillsShMirrorVisibility.beginDeactivationInternal as never,
      { ...args, lockToken } as never,
    )) as {
      ok: true;
      environment: "test" | "production";
      enabled: false;
      updatedAt: number;
      scansPlanned: 0;
      scansAdmitted: 0;
    };
    try {
      const nativeTrending = await materializeNativeTrending(ctx, lockToken);
      return { ...deactivation, nativeTrending };
    } finally {
      await ctx.runMutation(
        internalRefs.skillsShMirrorVisibility.releaseActivationInternal as never,
        { lockToken } as never,
      );
    }
  },
});

export const beginActivationInternal = internalMutation({
  args: {
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
    lockToken: v.string(),
  },
  handler: async (ctx, args) => {
    const environment = assertSkillsShPublicVisibilityMutationAllowed({
      activate: true,
      confirm: args.confirm,
    });
    const actor = args.actor.trim();
    const reason = args.reason.trim();
    const lockToken = args.lockToken.trim();
    if (!actor || !reason || !lockToken) {
      throw new Error("skills.sh activation actor, reason, and lock token are required");
    }
    const now = Date.now();
    const control = await ctx.db
      .query("skillsShMirrorControls")
      .withIndex("by_key", (q) => q.eq("key", CONTROL_KEY))
      .unique();
    if (!control || !control.enabled || control.paused) {
      throw new Error("skills.sh mirror control is not active");
    }
    if (control.activationLockToken) {
      if (
        control.activationLockToken !== lockToken &&
        control.activationLockedAt !== undefined &&
        control.activationLockedAt > now - ACTIVATION_LOCK_LEASE_MS
      ) {
        throw new Error("another skills.sh public activation is in progress");
      }
      if (control.activationLockToken === lockToken) {
        const [leaderboard, trending] = await Promise.all([
          control.activationLeaderboardRunId
            ? ctx.db.get(control.activationLeaderboardRunId)
            : null,
          control.activationTrendingRunId ? ctx.db.get(control.activationTrendingRunId) : null,
        ]);
        return { environment, leaderboard, trending };
      }
    }
    for (const status of ["running", "paused", "reconciling"] as const) {
      const active = await ctx.db
        .query("skillsShMirrorRuns")
        .withIndex("by_status_and_updated_at", (q) => q.eq("status", status))
        .first();
      if (active) throw new Error(`skills.sh mirror run ${active._id} is still active`);
    }
    const leaderboard = control.latestCompletedLeaderboardRunId
      ? await ctx.db.get(control.latestCompletedLeaderboardRunId)
      : null;
    const trending = await ctx.db
      .query("skillsShMirrorRuns")
      .withIndex("by_started_at")
      .order("desc")
      .filter((q) =>
        q.and(q.eq(q.field("sourceView"), "trending"), q.eq(q.field("status"), "completed")),
      )
      .first();
    requireCompletedRun(leaderboard, "leaderboard");
    requireCompletedRun(trending, "trending");
    if (trending!.startedAt < (leaderboard!.completedAt ?? leaderboard!.updatedAt)) {
      throw new Error("skills.sh trending run is older than the leaderboard run");
    }
    await ctx.db.patch(control._id, {
      activationLockToken: lockToken,
      activationLockedAt: now,
      activationLeaderboardRunId: leaderboard!._id,
      activationTrendingRunId: trending!._id,
      updatedBy: actor,
      reason,
      updatedAt: now,
    });
    return { environment, leaderboard, trending };
  },
});

export const releaseActivationInternal = internalMutation({
  args: { lockToken: v.string() },
  handler: async (ctx, args) => {
    const control = await ctx.db
      .query("skillsShMirrorControls")
      .withIndex("by_key", (q) => q.eq("key", CONTROL_KEY))
      .unique();
    if (!control || control.activationLockToken !== args.lockToken) return { released: false };
    await ctx.db.patch(control._id, {
      activationLockToken: undefined,
      activationLockedAt: undefined,
      activationLeaderboardRunId: undefined,
      activationTrendingRunId: undefined,
    });
    return { released: true };
  },
});

export const finalizeActivationInternal = internalMutation({
  args: {
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
    lockToken: v.string(),
    leaderboardRunId: v.id("skillsShMirrorRuns"),
    trendingRunId: v.id("skillsShMirrorRuns"),
    snapshotId: v.string(),
    expectedSkillsShTrending: v.number(),
  },
  handler: async (ctx, args) => {
    const environment = assertSkillsShPublicVisibilityMutationAllowed({
      activate: true,
      confirm: args.confirm,
    });
    const control = await ctx.db
      .query("skillsShMirrorControls")
      .withIndex("by_key", (q) => q.eq("key", CONTROL_KEY))
      .unique();
    if (
      !control ||
      control.activationLockToken !== args.lockToken ||
      control.activationLeaderboardRunId !== args.leaderboardRunId ||
      control.activationTrendingRunId !== args.trendingRunId ||
      control.latestCompletedLeaderboardRunId !== args.leaderboardRunId ||
      !control.enabled ||
      control.paused
    ) {
      throw new Error("skills.sh activation lock or source run changed before publication");
    }
    const snapshot = await ctx.db
      .query("canonicalTrendingSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .unique();
    const latestReady = await ctx.db
      .query("canonicalTrendingSnapshots")
      .withIndex("by_kind_and_status_and_expires_at", (q) =>
        q.eq("kind", "skills").eq("status", "ready").gt("expiresAt", Date.now()),
      )
      .order("desc")
      .first();
    if (
      !snapshot ||
      snapshot.status !== "ready" ||
      snapshot.snapshotId !== latestReady?.snapshotId ||
      snapshot.sourceCounts?.skillsShTrending !== args.expectedSkillsShTrending
    ) {
      throw new Error("verified skills.sh Trending snapshot is not the current ready snapshot");
    }
    const actor = args.actor.trim();
    const reason = args.reason.trim();
    if (!actor || !reason) throw new Error("skills.sh public gate actor and reason are required");
    const now = Date.now();
    await writePublicGate(ctx, { enabled: true, actor, reason, now });
    await ctx.db.patch("skillsShMirrorRuns", args.leaderboardRunId, {
      activatedTrendingRunId: args.trendingRunId,
      activationSnapshotId: args.snapshotId,
      activatedAt: now,
    });
    await ctx.db.patch(control._id, {
      activationLockToken: undefined,
      activationLockedAt: undefined,
      activationLeaderboardRunId: undefined,
      activationTrendingRunId: undefined,
      updatedBy: actor,
      reason,
      updatedAt: now,
    });
    return {
      ok: true as const,
      environment,
      enabled: true as const,
      leaderboardRunId: args.leaderboardRunId,
      trendingRunId: args.trendingRunId,
      snapshotId: args.snapshotId,
      activatedAt: now,
      updatedAt: now,
    };
  },
});

export const getAuditPageInternal = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    leaderboardRunId: v.optional(v.id("skillsShMirrorRuns")),
    trendingRunId: v.optional(v.id("skillsShMirrorRuns")),
  },
  handler: async (ctx, args) => {
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > MAX_BATCH_SIZE) {
      throw new Error(`audit batch size must be between 1 and ${MAX_BATCH_SIZE}`);
    }
    const page = await ctx.db
      .query("skillsShMirrorDigests")
      .order("asc")
      .paginate(args.paginationOpts);
    const counts = {
      total: page.page.length,
      active: 0,
      sourceEligible: 0,
      eligible: 0,
      claimExcluded: 0,
      claimFailed: 0,
      claimPromoted: 0,
      claimRetrying: 0,
      eligiblePublished: 0,
      hiddenEligible: 0,
      unsafePublished: 0,
      stale: 0,
      tombstoned: 0,
      activationRunAccepted: 0,
      activationRunTrendingEligible: 0,
    };
    for (const digest of page.page) {
      const sourceEligible = isSkillsShMirrorSourceEligible(digest);
      const publicationFlags = skillsShMirrorPublicationFlags(digest);
      const eligible = publicationFlags.publicVisible && publicationFlags.installable;
      const claimExcluded = sourceEligible && !eligible && digest.claimStatus !== undefined;
      const published = digest.publicVisible && digest.installable;
      if (digest.active) counts.active += 1;
      if (sourceEligible) counts.sourceEligible += 1;
      if (eligible) counts.eligible += 1;
      if (claimExcluded) counts.claimExcluded += 1;
      if (claimExcluded && digest.claimStatus === "failed") counts.claimFailed += 1;
      if (claimExcluded && digest.claimStatus === "promoted") counts.claimPromoted += 1;
      if (claimExcluded && digest.claimStatus === "pending") counts.claimRetrying += 1;
      if (eligible && published) counts.eligiblePublished += 1;
      if (eligible && !published) counts.hiddenEligible += 1;
      if (!eligible && (digest.publicVisible || digest.installable)) counts.unsafePublished += 1;
      if (digest.sourceFreshnessStatus === "stale") counts.stale += 1;
      if (digest.tombstonedAt !== undefined) counts.tombstoned += 1;
      // beginActivation selects the latest completed runs and its lock makes
      // startRunInternal reject new imports, so this provenance is stable for the audit.
      if (
        ((args.leaderboardRunId !== undefined &&
          digest.lastObservedRunId === args.leaderboardRunId) ||
          (args.trendingRunId !== undefined && digest.lastObservedRunId === args.trendingRunId)) &&
        digest.sourceFreshnessStatus === "observed-only"
      ) {
        counts.activationRunAccepted += 1;
      }
      if (
        args.trendingRunId !== undefined &&
        digest.trendingObservedRunId === args.trendingRunId &&
        publicationFlags.publicVisible &&
        publicationFlags.installable &&
        Number.isSafeInteger(digest.trendingRank) &&
        (digest.trendingRank ?? 0) >= 1
      ) {
        counts.activationRunTrendingEligible += 1;
      }
    }
    return { ...page, page: counts };
  },
});

async function audit(
  ctx: Pick<ActionCtx, "runQuery">,
  activationRuns?: {
    leaderboardRunId: Doc<"skillsShMirrorRuns">["_id"];
    trendingRunId: Doc<"skillsShMirrorRuns">["_id"];
  },
) {
  let cursor: string | null = null;
  let batches = 0;
  const counts = {
    total: 0,
    active: 0,
    sourceEligible: 0,
    eligible: 0,
    claimExcluded: 0,
    claimFailed: 0,
    claimPromoted: 0,
    claimRetrying: 0,
    eligiblePublished: 0,
    hiddenEligible: 0,
    unsafePublished: 0,
    stale: 0,
    tombstoned: 0,
    activationRunAccepted: 0,
    activationRunTrendingEligible: 0,
  };
  while (true) {
    const result = (await ctx.runQuery(internal.skillsShMirrorVisibility.getAuditPageInternal, {
      paginationOpts: { cursor, numItems: MAX_BATCH_SIZE },
      ...activationRuns,
    })) as {
      continueCursor: string;
      isDone: boolean;
      page: typeof counts;
    };
    for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
      counts[key] += result.page[key];
    }
    batches += 1;
    if (counts.total > MAX_ROWS) {
      throw new Error(`skills.sh visibility audit exceeded ${MAX_ROWS} rows`);
    }
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  return {
    ok: true as const,
    batches,
    counts,
    scansPlanned: 0 as const,
    scansAdmitted: 0 as const,
  };
}

export const auditInternal = internalAction({
  args: {},
  handler: async (ctx) => await audit(ctx),
});

export const verifyAndActivateInternal = internalAction({
  args: {
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
  },
  handler: async (ctx, args) => {
    const environment = assertSkillsShPublicVisibilityMutationAllowed({
      activate: true,
      confirm: args.confirm,
    });
    const lockToken = `skills-sh-activation:${crypto.randomUUID()}`;
    let locked = false;
    try {
      const preflight = (await ctx.runMutation(
        internalRefs.skillsShMirrorVisibility.beginActivationInternal as never,
        { ...args, lockToken } as never,
      )) as { leaderboard: MirrorRun; trending: MirrorRun };
      locked = true;
      const leaderboardRun = requireCompletedRun(preflight.leaderboard, "leaderboard");
      const trendingRun = requireCompletedRun(preflight.trending, "trending");
      const leaderboard = verifyLeaderboardRun(leaderboardRun);
      const trending = verifyTrendingRun(trendingRun);
      const storedConflicts = await countRunConflicts(ctx, leaderboardRun._id);
      if (storedConflicts !== leaderboard.rejected) {
        throw new Error("skills.sh stored conflict accounting differs from rejected rows");
      }
      await reconcileEligibility(ctx, args.confirm);
      const corpusAudit = await audit(ctx, {
        leaderboardRunId: leaderboardRun._id,
        trendingRunId: trendingRun._id,
      });
      if (corpusAudit.counts.activationRunAccepted !== leaderboard.accepted + trending.hydrated) {
        throw new Error("skills.sh stored corpus count differs from accepted rows");
      }
      if (
        corpusAudit.counts.sourceEligible !==
        corpusAudit.counts.eligible + corpusAudit.counts.claimExcluded
      ) {
        throw new Error("skills.sh eligible corpus partition is inconsistent");
      }
      if (
        corpusAudit.counts.hiddenEligible !== 0 ||
        corpusAudit.counts.unsafePublished !== 0 ||
        corpusAudit.counts.eligiblePublished !== corpusAudit.counts.eligible
      ) {
        throw new Error("skills.sh corpus eligibility reconciliation did not converge");
      }
      const trendingSnapshot = (await ctx.runAction(
        internalRefs.canonicalTrending.materializeInternal as never,
        { activationLockToken: lockToken } as never,
      )) as {
        status: "ready";
        snapshotId: string;
        sourceCounts: { skillsShTrending: number };
      };
      if (
        trendingSnapshot.status !== "ready" ||
        trendingSnapshot.sourceCounts.skillsShTrending !==
          corpusAudit.counts.activationRunTrendingEligible
      ) {
        throw new Error("skills.sh Trending activation snapshot failed source verification");
      }
      const publication = (await ctx.runMutation(
        internalRefs.skillsShMirrorVisibility.finalizeActivationInternal as never,
        {
          ...args,
          lockToken,
          leaderboardRunId: leaderboardRun._id,
          trendingRunId: trendingRun._id,
          snapshotId: trendingSnapshot.snapshotId,
          expectedSkillsShTrending: trendingSnapshot.sourceCounts.skillsShTrending,
        } as never,
      )) as {
        leaderboardRunId: MirrorRun["_id"];
        trendingRunId: MirrorRun["_id"];
        snapshotId: string;
        activatedAt: number;
      };
      locked = false;
      return {
        ok: true as const,
        environment,
        activated: true as const,
        leaderboard,
        trending,
        corpus: corpusAudit.counts,
        trendingSnapshot,
        leaderboardRunId: publication.leaderboardRunId,
        trendingRunId: publication.trendingRunId,
        snapshotId: publication.snapshotId,
        activatedAt: publication.activatedAt,
        scansPlanned: 0 as const,
        scansAdmitted: 0 as const,
      };
    } finally {
      if (locked) {
        await ctx.runMutation(
          internalRefs.skillsShMirrorVisibility.releaseActivationInternal as never,
          { lockToken } as never,
        );
      }
    }
  },
});

export const getVisibilityPageInternal = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_active_visible_installable_fresh_slug", (q) =>
        q
          .eq("active", true)
          .eq("publicVisible", true)
          .eq("installable", true)
          .eq("sourceFreshnessStatus", "observed-only"),
      )
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((digest) => ({
        externalId: digest.externalId,
        displayName: digest.displayName,
        sourceUrl: digest.sourceUrl,
        githubPath: digest.githubPath,
        githubCommit: digest.githubCommit,
        sourceContentHash: digest.sourceContentHash,
        publicVisible: digest.publicVisible,
        installable: digest.installable,
      })),
    };
  },
});
