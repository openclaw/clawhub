import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation } from "./functions";
import { assertAdmin, requireUser } from "./lib/access";
import { runPackageDryRunFilesystemScan } from "./lib/packageDryRunFilesystemScan";
import { normalizePackageName } from "./lib/packageRegistry";

const MAX_CREATE_RELEASES = 200;
const MAX_LATEST_ACTIVE_LIMIT = 200;
const MAX_SAMPLE_CANDIDATES = 1_000;
const MAX_SAMPLE_SEED_CHARS = 128;
const MAX_SELECTOR_SCAN_PAGES = 10;
const MAX_PROCESS_BATCH_SIZE = 25;
const SCANNER_PROFILE = "filesystem-safety-v1";
const RUNNING_LEASE_MS = 10 * 60_000;
const STALLED_JOB_RECHECK_MS = RUNNING_LEASE_MS + 1_000;
const JOB_RETENTION_MS = 14 * 24 * 60 * 60_000;
const PRUNE_JOB_BATCH_SIZE = 100;
const PRUNE_RESULT_BATCH_SIZE = 1_000;
const MAX_PERSISTED_ERROR_CHARS = 1_024;
const TRUNCATED_ERROR_SUFFIX = "...";
const TERMINAL_JOB_STATUSES = ["completed", "failed"] as const;

const selectorValidator = v.union(
  v.object({
    kind: v.literal("releaseIds"),
    releaseIds: v.array(v.id("packageReleases")),
  }),
  v.object({
    kind: v.literal("packageNames"),
    packageNames: v.array(v.string()),
  }),
  v.object({
    kind: v.literal("latestActive"),
    limit: v.number(),
  }),
  v.object({
    kind: v.literal("allActive"),
  }),
  v.object({
    kind: v.literal("seededSample"),
    limit: v.number(),
    seed: v.string(),
    maxCandidates: v.number(),
  }),
);

const filesystemFindingValidator = v.object({
  code: v.string(),
  severity: v.string(),
  file: v.string(),
  line: v.number(),
  message: v.string(),
  evidence: v.string(),
  evidenceTruncated: v.boolean(),
});

const filesystemBucketValidator = v.object({
  reasonCode: v.string(),
  totalCount: v.number(),
  returnedCount: v.number(),
  omittedCount: v.number(),
  truncatedEvidenceCount: v.number(),
  evidence: v.array(filesystemFindingValidator),
});

const filesystemEvidenceValidator = v.object({
  rawFsUsage: filesystemBucketValidator,
  fsSafeUsage: filesystemBucketValidator,
});

const internalRefs = internal as unknown as {
  packageDryRunScans: {
    claimPackageDryRunScanResultsInternal: unknown;
    completePackageDryRunScanResultInternal: unknown;
    enqueuePackageDryRunScanJobTargetsInternal: unknown;
    skipPackageDryRunScanResultInternal: unknown;
    failPackageDryRunScanResultInternal: unknown;
    failPackageDryRunScanJobInternal: unknown;
    finalizePackageDryRunScanJobInternal: unknown;
    getPackageDryRunScanInputInternal: unknown;
    processPackageDryRunScanJobBatchInternal: unknown;
    prunePackageDryRunScansInternal: unknown;
  };
};

type DbReadCtx = Pick<QueryCtx | MutationCtx, "db">;
type DryRunSelector =
  | { kind: "releaseIds"; releaseIds: Array<Id<"packageReleases">> }
  | { kind: "packageNames"; packageNames: string[] }
  | { kind: "latestActive"; limit: number }
  | { kind: "allActive" }
  | { kind: "seededSample"; limit: number; seed: string; maxCandidates: number };
type DryRunTarget = {
  releaseId: Id<"packageReleases">;
  packageId: Id<"packages">;
  packageName: string;
  packageDisplayName: string;
  version: string;
  createdAt: number;
};
type DryRunTargetSelection = {
  targets: DryRunTarget[];
  candidateLimitReached?: boolean;
  targetLimitReached?: boolean;
  selectionScanLimitReached?: boolean;
};
type ClaimedItem = Omit<DryRunTarget, "createdAt"> & {
  itemId: Id<"packageDryRunScanResults">;
  claimToken: string;
};
type ScanInput =
  | {
      kind: "scan";
      files: Doc<"packageReleases">["files"];
    }
  | {
      kind: "skip";
      reason:
        | "missing_release"
        | "missing_package"
        | "soft_deleted_release"
        | "soft_deleted_package"
        | "unsupported_family";
    };

async function runQueryRef<T>(
  ctx: { runQuery: (ref: never, args: never) => Promise<unknown> },
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

async function runMutationRef<T>(
  ctx: { runMutation: (ref: never, args: never) => Promise<unknown> },
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

function normalizePositiveLimit(value: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new ConvexError(`${label} must be a positive integer`);
  }
  if (value > max) {
    throw new ConvexError(`${label} must be at most ${max}`);
  }
  return value;
}

function uniqueReleaseIds(releaseIds: Array<Id<"packageReleases">>) {
  const seen = new Set<Id<"packageReleases">>();
  const unique: Array<Id<"packageReleases">> = [];
  for (const releaseId of releaseIds) {
    if (seen.has(releaseId)) continue;
    seen.add(releaseId);
    unique.push(releaseId);
  }
  return unique;
}

function formatUnresolvedSelectorValues(values: readonly string[]) {
  const visible = values.slice(0, 5).join(", ");
  const omitted = values.length > 5 ? ` and ${values.length - 5} more` : "";
  return `${visible}${omitted}`;
}

async function resolveDryRunTarget(
  ctx: DbReadCtx,
  releaseId: Id<"packageReleases">,
): Promise<DryRunTarget | null> {
  const release = await ctx.db.get(releaseId);
  if (!release) return null;
  return await resolveDryRunTargetFromRelease(ctx, release);
}

async function resolveDryRunTargetFromRelease(
  ctx: DbReadCtx,
  release: Doc<"packageReleases">,
  options: { requireLatestRelease?: boolean } = {},
): Promise<DryRunTarget | null> {
  if (release.softDeletedAt) return null;
  const pkg = await ctx.db.get(release.packageId);
  if (!pkg || pkg.softDeletedAt || pkg.family === "skill") return null;
  if (options.requireLatestRelease && pkg.latestReleaseId !== release._id) return null;

  return {
    releaseId: release._id,
    packageId: pkg._id,
    packageName: pkg.name,
    packageDisplayName: pkg.displayName,
    version: release.version,
    createdAt: release.createdAt,
  };
}

async function selectExplicitReleaseTargets(
  ctx: DbReadCtx,
  releaseIds: Array<Id<"packageReleases">>,
): Promise<DryRunTargetSelection> {
  if (releaseIds.length === 0) throw new ConvexError("releaseIds must not be empty");
  if (releaseIds.length > MAX_CREATE_RELEASES) {
    throw new ConvexError(`releaseIds is limited to ${MAX_CREATE_RELEASES} releases`);
  }

  const targets: DryRunTarget[] = [];
  const unresolvedReleaseIds: string[] = [];
  for (const releaseId of uniqueReleaseIds(releaseIds)) {
    const target = await resolveDryRunTarget(ctx, releaseId);
    if (target) {
      targets.push(target);
    } else {
      unresolvedReleaseIds.push(releaseId);
    }
  }
  if (unresolvedReleaseIds.length > 0) {
    throw new ConvexError(
      `Dry-run scan selector could not resolve releaseIds: ${formatUnresolvedSelectorValues(unresolvedReleaseIds)}`,
    );
  }
  return { targets };
}

async function selectPackageNameTargets(
  ctx: DbReadCtx,
  packageNames: string[],
): Promise<DryRunTargetSelection> {
  if (packageNames.length === 0) throw new ConvexError("packageNames must not be empty");
  if (packageNames.length > MAX_CREATE_RELEASES) {
    throw new ConvexError(`packageNames is limited to ${MAX_CREATE_RELEASES} packages`);
  }

  const normalizedNames = [...new Set(packageNames.map((name) => normalizePackageName(name)))];
  const targets: DryRunTarget[] = [];
  const seenReleases = new Set<Id<"packageReleases">>();
  const unresolvedPackageNames: string[] = [];
  for (const normalizedName of normalizedNames) {
    const pkg = await ctx.db
      .query("packages")
      .withIndex("by_name", (q) => q.eq("normalizedName", normalizedName))
      .unique();
    if (!pkg || pkg.softDeletedAt || pkg.family === "skill" || !pkg.latestReleaseId) {
      unresolvedPackageNames.push(normalizedName);
      continue;
    }
    if (seenReleases.has(pkg.latestReleaseId)) continue;

    const target = await resolveDryRunTarget(ctx, pkg.latestReleaseId);
    if (!target) {
      unresolvedPackageNames.push(normalizedName);
      continue;
    }
    seenReleases.add(target.releaseId);
    targets.push(target);
  }
  if (unresolvedPackageNames.length > 0) {
    throw new ConvexError(
      `Dry-run scan selector could not resolve packageNames: ${formatUnresolvedSelectorValues(unresolvedPackageNames)}`,
    );
  }
  return { targets };
}

async function selectLatestActiveTargets(
  ctx: DbReadCtx,
  limit: number,
  max: number = MAX_LATEST_ACTIVE_LIMIT,
  options: { detectLimitReached?: boolean } = {},
): Promise<DryRunTargetSelection> {
  const boundedLimit = normalizePositiveLimit(limit, max, "limit");
  const collectLimit = options.detectLimitReached ? boundedLimit + 1 : boundedLimit;
  const selectorScanPages = options.detectLimitReached
    ? Math.max(MAX_SELECTOR_SCAN_PAGES, Math.ceil(collectLimit / 100))
    : MAX_SELECTOR_SCAN_PAGES;

  const targets: DryRunTarget[] = [];
  const seenReleases = new Set<Id<"packageReleases">>();
  let cursor: string | null = null;
  let done = false;
  let pagesScanned = 0;
  let unresolvedBoundary = false;
  let boundaryResolved = false;
  while (!done && pagesScanned < selectorScanPages) {
    const page = await ctx.db
      .query("packageReleases")
      .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
      .order("desc")
      .paginate({ cursor, numItems: 100 });
    pagesScanned += 1;
    let oldestPageCreatedAt: number | null = null;
    for (const release of page.page) {
      oldestPageCreatedAt =
        oldestPageCreatedAt === null
          ? release.createdAt
          : Math.min(oldestPageCreatedAt, release.createdAt);
      if (seenReleases.has(release._id)) continue;
      const target = await resolveDryRunTargetFromRelease(ctx, release, {
        requireLatestRelease: true,
      });
      if (!target) continue;
      seenReleases.add(target.releaseId);
      targets.push(target);
    }
    targets.sort(
      (left, right) =>
        right.createdAt - left.createdAt || left.releaseId.localeCompare(right.releaseId),
    );
    done = page.isDone;
    cursor = page.continueCursor;
    const boundaryCreatedAt =
      targets.length >= collectLimit ? targets[collectLimit - 1]?.createdAt : undefined;
    if (
      boundaryCreatedAt !== undefined &&
      (done || (oldestPageCreatedAt !== null && oldestPageCreatedAt < boundaryCreatedAt))
    ) {
      boundaryResolved = true;
      break;
    }
    if (!cursor && !done) break;
  }
  const hitUnresolvedScanLimit = !done && pagesScanned >= selectorScanPages && !boundaryResolved;
  if (hitUnresolvedScanLimit) {
    const boundaryCreatedAt =
      targets.length >= collectLimit ? targets[collectLimit - 1]?.createdAt : undefined;
    const oldestCollectedCreatedAt = targets.at(-1)?.createdAt;
    unresolvedBoundary =
      options.detectLimitReached ||
      (boundaryCreatedAt !== undefined && oldestCollectedCreatedAt === boundaryCreatedAt);
  }
  return {
    targets: targets.slice(0, boundedLimit),
    targetLimitReached: targets.length > boundedLimit || hitUnresolvedScanLimit,
    selectionScanLimitReached: unresolvedBoundary,
  };
}

async function selectSeededSampleTargets(
  ctx: DbReadCtx,
  selector: { limit: number; seed: string; maxCandidates: number },
): Promise<DryRunTargetSelection> {
  const boundedLimit = normalizePositiveLimit(selector.limit, MAX_LATEST_ACTIVE_LIMIT, "limit");
  const seed = normalizeSeededSampleSeed(selector.seed);
  const maxCandidates = normalizePositiveLimit(
    selector.maxCandidates,
    MAX_SAMPLE_CANDIDATES,
    "maxCandidates",
  );
  if (maxCandidates < boundedLimit) {
    throw new ConvexError("maxCandidates must be greater than or equal to limit");
  }
  const candidateSelection = await selectLatestActiveTargets(
    ctx,
    maxCandidates,
    MAX_SAMPLE_CANDIDATES,
    { detectLimitReached: true },
  );
  const targets = candidateSelection.targets
    .map((target) => ({
      target,
      score: deterministicSampleScore(`${seed}:${target.releaseId}`),
    }))
    .sort(
      (left, right) =>
        left.score - right.score || left.target.releaseId.localeCompare(right.target.releaseId),
    )
    .slice(0, boundedLimit)
    .map(({ target }) => target);
  return {
    targets,
    candidateLimitReached: candidateSelection.targetLimitReached,
    targetLimitReached: candidateSelection.targetLimitReached,
    selectionScanLimitReached: candidateSelection.selectionScanLimitReached,
  };
}

async function selectDryRunTargets(
  ctx: DbReadCtx,
  selector: Exclude<DryRunSelector, { kind: "allActive" }>,
): Promise<DryRunTargetSelection> {
  if (selector.kind === "releaseIds") {
    return await selectExplicitReleaseTargets(ctx, selector.releaseIds);
  }
  if (selector.kind === "packageNames") {
    return await selectPackageNameTargets(ctx, selector.packageNames);
  }
  if (selector.kind === "latestActive") {
    return await selectLatestActiveTargets(ctx, selector.limit);
  }
  return await selectSeededSampleTargets(ctx, selector);
}

function requireActiveAdminUser(actor: Doc<"users"> | null) {
  if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
  assertAdmin(actor);
}

function errorMessage(error: unknown) {
  return truncateDryRunErrorMessage(error instanceof Error ? error.message : String(error));
}

function truncateDryRunErrorMessage(message: string) {
  if (message.length <= MAX_PERSISTED_ERROR_CHARS) return message;
  return `${message.slice(0, MAX_PERSISTED_ERROR_CHARS - TRUNCATED_ERROR_SUFFIX.length)}${TRUNCATED_ERROR_SUFFIX}`;
}

function deterministicSampleScore(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function normalizeSeededSampleSeed(seed: string) {
  const trimmed = seed.trim();
  if (!trimmed) throw new ConvexError("seed must be a non-empty string");
  if (trimmed.length > MAX_SAMPLE_SEED_CHARS) {
    throw new ConvexError(`seed must be at most ${MAX_SAMPLE_SEED_CHARS} characters`);
  }
  return trimmed;
}

function normalizeDryRunSelector(selector: DryRunSelector): DryRunSelector {
  if (selector.kind !== "seededSample") return selector;
  return {
    ...selector,
    seed: normalizeSeededSampleSeed(selector.seed),
  };
}

function filesystemMatched(result: {
  rawFsUsage: { totalCount: number };
  fsSafeUsage: { totalCount: number };
}) {
  return result.rawFsUsage.totalCount > 0 || result.fsSafeUsage.totalCount > 0 ? 1 : 0;
}

function isTerminalDryRunJobStatus(status: string) {
  return status === "completed" || status === "failed";
}

async function schedulePackageDryRunScanJob(
  ctx: Pick<MutationCtx, "scheduler">,
  jobId: Id<"packageDryRunScanJobs">,
) {
  await ctx.scheduler.runAfter(
    0,
    internalRefs.packageDryRunScans.processPackageDryRunScanJobBatchInternal as never,
    { jobId } as never,
  );
}

async function insertPackageDryRunScanJob(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  requestedByUserId: Id<"users">,
  selector: DryRunSelector,
) {
  const normalizedSelector = normalizeDryRunSelector(selector);
  const selection =
    normalizedSelector.kind === "allActive"
      ? { targets: [] }
      : await selectDryRunTargets(ctx, normalizedSelector);
  const requestedTargetCount =
    normalizedSelector.kind === "latestActive" || normalizedSelector.kind === "seededSample"
      ? normalizedSelector.limit
      : null;
  if (
    selection.selectionScanLimitReached ||
    (requestedTargetCount !== null &&
      selection.targetLimitReached &&
      selection.targets.length < requestedTargetCount)
  ) {
    throw new ConvexError(
      selection.selectionScanLimitReached
        ? "Dry-run scan selector reached selection scan limit before resolving release ordering"
        : "Dry-run scan selector reached selection scan limit before collecting requested releases",
    );
  }
  if (normalizedSelector.kind !== "allActive" && selection.targets.length === 0) {
    throw new ConvexError("No active package releases matched the dry-run scan selector");
  }

  const now = Date.now();
  const jobId = await ctx.db.insert("packageDryRunScanJobs", {
    scanner: SCANNER_PROFILE,
    selector: normalizedSelector,
    status: "queued",
    requestedByUserId,
    totalItems: selection.targets.length,
    queuedItems: selection.targets.length,
    runningItems: 0,
    completedItems: 0,
    failedItems: 0,
    skippedItems: 0,
    matchedItems: 0,
    cursor: null,
    targetSelectionDone: normalizedSelector.kind !== "allActive",
    candidateLimitReached: selection.candidateLimitReached,
    expiresAt: now + JOB_RETENTION_MS,
    createdAt: now,
    updatedAt: now,
  });

  for (const target of selection.targets) {
    await ctx.db.insert("packageDryRunScanResults", {
      jobId,
      releaseId: target.releaseId,
      packageId: target.packageId,
      packageName: target.packageName,
      packageDisplayName: target.packageDisplayName,
      version: target.version,
      status: "queued",
      rawFsUsageCount: 0,
      fsSafeUsageCount: 0,
      findings: [],
      errors: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  await schedulePackageDryRunScanJob(ctx, jobId);

  return {
    jobId,
    status: "queued" as const,
    totalItems: selection.targets.length,
    targetSelectionDone: selector.kind !== "allActive",
    candidateLimitReached: selection.candidateLimitReached,
  };
}

export const createPackageDryRunScanJob = mutation({
  args: {
    selector: selectorValidator,
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);
    assertAdmin(user);

    return await insertPackageDryRunScanJob(ctx, userId, args.selector);
  },
});

export const createPackageDryRunScanJobForUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    selector: selectorValidator,
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    requireActiveAdminUser(actor);
    return await insertPackageDryRunScanJob(ctx, args.actorUserId, args.selector);
  },
});

export const getPackageDryRunScanJobForUserInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    jobId: v.id("packageDryRunScanJobs"),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    requireActiveAdminUser(actor);

    const job = await ctx.db.get(args.jobId);
    if (!job) throw new ConvexError("Package dry-run scan job not found");
    const outstandingItems = job.status === "failed" ? job.queuedItems + job.runningItems : 0;
    return {
      jobId: job._id,
      scanner: job.scanner,
      selector: job.selector,
      status: job.status,
      totalItems: job.totalItems,
      queuedItems: job.status === "failed" ? 0 : job.queuedItems,
      runningItems: job.status === "failed" ? 0 : job.runningItems,
      completedItems: job.completedItems,
      failedItems: job.failedItems + outstandingItems,
      skippedItems: job.skippedItems,
      matchedItems: job.matchedItems,
      targetSelectionDone: job.targetSelectionDone !== false,
      candidateLimitReached: job.candidateLimitReached,
      expiresAt: job.expiresAt,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  },
});

export const listPackageDryRunScanResultsForUserInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    jobId: v.id("packageDryRunScanJobs"),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    requireActiveAdminUser(actor);

    const job = await ctx.db.get(args.jobId);
    if (!job) throw new ConvexError("Package dry-run scan job not found");

    const page = await ctx.db
      .query("packageDryRunScanResults")
      .withIndex("by_job_created", (q) => q.eq("jobId", args.jobId))
      .paginate({
        cursor: args.cursor,
        numItems: normalizePositiveLimit(args.limit, 500, "limit"),
      });

    const jobDone = isTerminalDryRunJobStatus(job.status);
    const partial = !jobDone || !job.targetSelectionDone;

    return {
      jobStatus: job.status,
      jobDone,
      partial,
      items: page.page.map((item) => {
        const terminalFailed =
          job.status === "failed" && (item.status === "queued" || item.status === "running");
        return {
          itemId: item._id,
          jobId: item.jobId,
          releaseId: item.releaseId,
          packageId: item.packageId,
          packageName: item.packageName,
          packageDisplayName: item.packageDisplayName,
          version: item.version,
          status: terminalFailed ? "failed" : item.status,
          rawFsUsageCount: item.rawFsUsageCount,
          fsSafeUsageCount: item.fsSafeUsageCount,
          findings: item.findings,
          errors: terminalFailed ? [job.error ?? "Dry-run scan job failed"] : item.errors,
          createdAt: item.createdAt,
          updatedAt: terminalFailed ? job.updatedAt : item.updatedAt,
          startedAt: item.startedAt,
          completedAt: terminalFailed ? job.completedAt : item.completedAt,
        };
      }),
      nextCursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});

export const enqueuePackageDryRunScanJobTargetsInternal = internalMutation({
  args: {
    jobId: v.id("packageDryRunScanJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === "completed" || job.status === "failed") {
      return { enqueued: 0, done: true as const, advanced: false };
    }
    if (job.selector.kind !== "allActive" || job.targetSelectionDone) {
      return { enqueued: 0, done: true as const, advanced: false };
    }

    const page = await ctx.db
      .query("packageReleases")
      .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
      .order("desc")
      .paginate({ cursor: job.cursor ?? null, numItems: MAX_PROCESS_BATCH_SIZE });

    const now = Date.now();
    let enqueued = 0;
    for (const release of page.page) {
      const target = await resolveDryRunTargetFromRelease(ctx, release);
      if (!target) continue;
      const existing = await ctx.db
        .query("packageDryRunScanResults")
        .withIndex("by_job_release", (q) =>
          q.eq("jobId", args.jobId).eq("releaseId", target.releaseId),
        )
        .unique();
      if (existing) continue;
      await ctx.db.insert("packageDryRunScanResults", {
        jobId: args.jobId,
        releaseId: target.releaseId,
        packageId: target.packageId,
        packageName: target.packageName,
        packageDisplayName: target.packageDisplayName,
        version: target.version,
        status: "queued",
        rawFsUsageCount: 0,
        fsSafeUsageCount: 0,
        findings: [],
        errors: [],
        createdAt: now,
        updatedAt: now,
      });
      enqueued += 1;
    }

    await ctx.db.patch(args.jobId, {
      totalItems: job.totalItems + enqueued,
      queuedItems: job.queuedItems + enqueued,
      cursor: page.continueCursor,
      targetSelectionDone: page.isDone,
      updatedAt: now,
    });

    return { enqueued, done: page.isDone, advanced: page.page.length > 0 };
  },
});

export const claimPackageDryRunScanResultsInternal = internalMutation({
  args: {
    jobId: v.id("packageDryRunScanJobs"),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ClaimedItem[]> => {
    let job = await ctx.db.get(args.jobId);
    if (!job || job.status === "completed" || job.status === "failed") return [];
    const now = Date.now();
    const requeued = await requeueStaleRunningResults(ctx, args.jobId, now);
    if (requeued > 0) {
      job = await ctx.db.get(args.jobId);
      if (!job || job.status === "completed" || job.status === "failed") return [];
    }

    const batchSize = normalizePositiveLimit(
      args.batchSize ?? MAX_PROCESS_BATCH_SIZE,
      MAX_PROCESS_BATCH_SIZE,
      "batchSize",
    );
    const queuedItems = await ctx.db
      .query("packageDryRunScanResults")
      .withIndex("by_job_status_created", (q) => q.eq("jobId", args.jobId).eq("status", "queued"))
      .order("asc")
      .take(batchSize);
    if (queuedItems.length === 0) return [];

    const leaseExpiresAt = now + RUNNING_LEASE_MS;
    const claimedItems: ClaimedItem[] = [];
    for (const item of queuedItems) {
      const claimToken = `${now}:${item._id}:${item.updatedAt}`;
      await ctx.db.patch(item._id, {
        status: "running",
        startedAt: now,
        claimToken,
        leaseExpiresAt,
        updatedAt: now,
      });
      claimedItems.push({
        itemId: item._id,
        releaseId: item.releaseId,
        packageId: item.packageId,
        packageName: item.packageName,
        packageDisplayName: item.packageDisplayName,
        version: item.version,
        claimToken,
      });
    }

    const staleRecheckAt = now + STALLED_JOB_RECHECK_MS;
    const shouldScheduleStaleRecheck = (job.staleRecheckAt ?? 0) < leaseExpiresAt;
    await ctx.db.patch(args.jobId, {
      status: "running",
      startedAt: job.startedAt ?? now,
      queuedItems: Math.max(0, job.queuedItems - queuedItems.length),
      runningItems: job.runningItems + queuedItems.length,
      ...(shouldScheduleStaleRecheck ? { staleRecheckAt } : {}),
      updatedAt: now,
    });
    if (shouldScheduleStaleRecheck) {
      await ctx.scheduler.runAfter(
        STALLED_JOB_RECHECK_MS,
        internalRefs.packageDryRunScans.processPackageDryRunScanJobBatchInternal as never,
        { jobId: args.jobId } as never,
      );
    }

    return claimedItems;
  },
});

export const getPackageDryRunScanInputInternal = internalQuery({
  args: {
    releaseId: v.id("packageReleases"),
  },
  handler: async (ctx, args): Promise<ScanInput> => {
    const release = await ctx.db.get(args.releaseId);
    if (!release) return { kind: "skip", reason: "missing_release" };
    if (release.softDeletedAt) return { kind: "skip", reason: "soft_deleted_release" };

    const pkg = await ctx.db.get(release.packageId);
    if (!pkg) return { kind: "skip", reason: "missing_package" };
    if (pkg.softDeletedAt) return { kind: "skip", reason: "soft_deleted_package" };
    if (pkg.family === "skill") return { kind: "skip", reason: "unsupported_family" };

    return {
      kind: "scan",
      files: release.files,
    };
  },
});

export const completePackageDryRunScanResultInternal = internalMutation({
  args: {
    itemId: v.id("packageDryRunScanResults"),
    claimToken: v.string(),
    result: filesystemEvidenceValidator,
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.status !== "running" || item.claimToken !== args.claimToken) return;
    const job = await ctx.db.get(item.jobId);
    if (!job) return;
    if (isTerminalDryRunJobStatus(job.status)) return;

    const now = Date.now();
    const wasRunning = item.status === "running";
    await ctx.db.patch(args.itemId, {
      status: "completed",
      rawFsUsageCount: args.result.rawFsUsage.totalCount,
      fsSafeUsageCount: args.result.fsSafeUsage.totalCount,
      findings: [...args.result.rawFsUsage.evidence, ...args.result.fsSafeUsage.evidence],
      claimToken: undefined,
      leaseExpiresAt: undefined,
      completedAt: now,
      updatedAt: now,
    });

    const matchedItems = filesystemMatched(args.result);
    await ctx.db.patch(item.jobId, {
      runningItems: Math.max(0, job.runningItems - (wasRunning ? 1 : 0)),
      completedItems: job.completedItems + 1,
      matchedItems: job.matchedItems + matchedItems,
      updatedAt: now,
    });
  },
});

export const skipPackageDryRunScanResultInternal = internalMutation({
  args: {
    itemId: v.id("packageDryRunScanResults"),
    claimToken: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.status !== "running" || item.claimToken !== args.claimToken) return;
    const job = await ctx.db.get(item.jobId);
    if (!job) return;
    if (isTerminalDryRunJobStatus(job.status)) return;

    const now = Date.now();
    const wasRunning = item.status === "running";
    await ctx.db.patch(args.itemId, {
      status: "skipped",
      errors: [truncateDryRunErrorMessage(args.reason)],
      claimToken: undefined,
      leaseExpiresAt: undefined,
      completedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(item.jobId, {
      runningItems: Math.max(0, job.runningItems - (wasRunning ? 1 : 0)),
      skippedItems: job.skippedItems + 1,
      updatedAt: now,
    });
  },
});

export const failPackageDryRunScanResultInternal = internalMutation({
  args: {
    itemId: v.id("packageDryRunScanResults"),
    claimToken: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.status !== "running" || item.claimToken !== args.claimToken) return;
    const job = await ctx.db.get(item.jobId);
    if (!job) return;
    if (isTerminalDryRunJobStatus(job.status)) return;

    const now = Date.now();
    const wasRunning = item.status === "running";
    const error = truncateDryRunErrorMessage(args.error);
    await ctx.db.patch(args.itemId, {
      status: "failed",
      errors: [error],
      claimToken: undefined,
      leaseExpiresAt: undefined,
      completedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(item.jobId, {
      runningItems: Math.max(0, job.runningItems - (wasRunning ? 1 : 0)),
      failedItems: job.failedItems + 1,
      updatedAt: now,
    });
  },
});

export const prunePackageDryRunScansInternal = internalMutation({
  args: {
    jobBatchSize: v.optional(v.number()),
    resultBatchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const jobBatchSize = normalizePositiveLimit(
      args.jobBatchSize ?? PRUNE_JOB_BATCH_SIZE,
      PRUNE_JOB_BATCH_SIZE,
      "jobBatchSize",
    );
    const resultBatchSize = normalizePositiveLimit(
      args.resultBatchSize ?? PRUNE_RESULT_BATCH_SIZE,
      PRUNE_RESULT_BATCH_SIZE,
      "resultBatchSize",
    );
    const candidates: Array<Doc<"packageDryRunScanJobs">> = [];
    for (const status of TERMINAL_JOB_STATUSES) {
      const expiredJobs = await ctx.db
        .query("packageDryRunScanJobs")
        .withIndex("by_status_expires", (q) => q.eq("status", status).lte("expiresAt", now))
        .take(jobBatchSize + 1);
      candidates.push(...expiredJobs);
    }
    const hasMoreExpiredJobs = candidates.length > jobBatchSize;
    const jobs = candidates
      .sort((left, right) => {
        const expiresCompare = left.expiresAt - right.expiresAt;
        if (expiresCompare !== 0) return expiresCompare;
        return left._id.localeCompare(right._id);
      })
      .slice(0, jobBatchSize);

    let jobsDeleted = 0;
    let resultsDeleted = 0;
    let remainingResultDeletes = resultBatchSize;
    for (const job of jobs) {
      if (remainingResultDeletes <= 0) break;
      const resultDeleteLimit = remainingResultDeletes;
      const results = await ctx.db
        .query("packageDryRunScanResults")
        .withIndex("by_job_created", (q) => q.eq("jobId", job._id))
        .take(resultDeleteLimit);
      for (const result of results) {
        await ctx.db.delete(result._id);
        resultsDeleted += 1;
        remainingResultDeletes -= 1;
      }
      if (results.length < resultDeleteLimit) {
        await ctx.db.delete(job._id);
        jobsDeleted += 1;
      }
    }

    if (
      (remainingResultDeletes <= 0 && jobs.length > jobsDeleted) ||
      (hasMoreExpiredJobs && jobsDeleted === jobs.length)
    ) {
      await ctx.scheduler.runAfter(
        0,
        internalRefs.packageDryRunScans.prunePackageDryRunScansInternal as never,
        {
          jobBatchSize,
          resultBatchSize,
        } as never,
      );
    }

    return {
      jobsScanned: jobs.length,
      jobsDeleted,
      resultsDeleted,
    };
  },
});

async function requeueStaleRunningResults(
  ctx: Pick<MutationCtx, "db">,
  jobId: Id<"packageDryRunScanJobs">,
  now: number,
) {
  const runningItems = await ctx.db
    .query("packageDryRunScanResults")
    .withIndex("by_job_status_lease", (q) =>
      q.eq("jobId", jobId).eq("status", "running").lte("leaseExpiresAt", now),
    )
    .order("asc")
    .take(MAX_PROCESS_BATCH_SIZE);
  const staleItems = runningItems.filter((item) => (item.leaseExpiresAt ?? 0) <= now);
  if (staleItems.length === 0) return 0;

  for (const item of staleItems) {
    await ctx.db.patch(item._id, {
      status: "queued",
      claimToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
  }

  const job = await ctx.db.get(jobId);
  if (job) {
    await ctx.db.patch(jobId, {
      queuedItems: job.queuedItems + staleItems.length,
      runningItems: Math.max(0, job.runningItems - staleItems.length),
      updatedAt: now,
    });
  }
  return staleItems.length;
}

export const finalizePackageDryRunScanJobInternal = internalMutation({
  args: {
    jobId: v.id("packageDryRunScanJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return { done: true as const, status: "missing" as const };
    if (isTerminalDryRunJobStatus(job.status)) {
      return { done: true as const, status: job.status };
    }

    const done =
      job.targetSelectionDone !== false && job.queuedItems === 0 && job.runningItems === 0;
    if (!done) return { done: false as const, status: job.status };

    const status = job.failedItems > 0 ? "failed" : "completed";
    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status,
      completedAt: now,
      updatedAt: now,
      expiresAt: now + JOB_RETENTION_MS,
      staleRecheckAt: undefined,
      error: status === "failed" ? "One or more dry-run scan items failed" : undefined,
    });
    return { done: true as const, status };
  },
});

export const failPackageDryRunScanJobInternal = internalMutation({
  args: {
    jobId: v.id("packageDryRunScanJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return { done: true as const, status: "missing" as const };
    if (isTerminalDryRunJobStatus(job.status)) {
      return { done: true as const, status: job.status };
    }

    const now = Date.now();
    const outstandingItems = job.queuedItems + job.runningItems;
    const error = truncateDryRunErrorMessage(args.error);
    await ctx.db.patch(args.jobId, {
      status: "failed",
      queuedItems: 0,
      runningItems: 0,
      failedItems: job.failedItems + outstandingItems,
      error,
      completedAt: now,
      updatedAt: now,
      expiresAt: now + JOB_RETENTION_MS,
      staleRecheckAt: undefined,
    });
    return { done: true as const, status: "failed" as const };
  },
});

export const processPackageDryRunScanJobBatchInternal = internalAction({
  args: {
    jobId: v.id("packageDryRunScanJobs"),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx: ActionCtx, args) => {
    let enqueued = { enqueued: 0, done: false, advanced: false };
    let claimed: ClaimedItem[] = [];
    let completed = 0;
    let skipped = 0;
    let failed = 0;

    try {
      enqueued = await runMutationRef<{ enqueued: number; done: boolean; advanced: boolean }>(
        ctx,
        internalRefs.packageDryRunScans.enqueuePackageDryRunScanJobTargetsInternal,
        { jobId: args.jobId },
      );

      claimed = await runMutationRef<ClaimedItem[]>(
        ctx,
        internalRefs.packageDryRunScans.claimPackageDryRunScanResultsInternal,
        {
          jobId: args.jobId,
          batchSize: args.batchSize,
        },
      );

      for (const item of claimed) {
        try {
          const input = await runQueryRef<ScanInput>(
            ctx,
            internalRefs.packageDryRunScans.getPackageDryRunScanInputInternal,
            { releaseId: item.releaseId },
          );
          if (input.kind === "skip") {
            skipped += 1;
            await runMutationRef(
              ctx,
              internalRefs.packageDryRunScans.skipPackageDryRunScanResultInternal,
              {
                itemId: item.itemId,
                claimToken: item.claimToken,
                reason: input.reason,
              },
            );
            continue;
          }

          const result = await runPackageDryRunFilesystemScan(ctx, {
            files: input.files,
          });
          completed += 1;
          await runMutationRef(
            ctx,
            internalRefs.packageDryRunScans.completePackageDryRunScanResultInternal,
            {
              itemId: item.itemId,
              claimToken: item.claimToken,
              result,
            },
          );
        } catch (error) {
          failed += 1;
          await runMutationRef(
            ctx,
            internalRefs.packageDryRunScans.failPackageDryRunScanResultInternal,
            {
              itemId: item.itemId,
              claimToken: item.claimToken,
              error: errorMessage(error),
            },
          );
        }
      }

      const finalized = await runMutationRef<{ done: boolean; status: string }>(
        ctx,
        internalRefs.packageDryRunScans.finalizePackageDryRunScanJobInternal,
        { jobId: args.jobId },
      );

      if (!finalized.done) {
        const noProgress = enqueued.enqueued === 0 && claimed.length === 0;
        const continuationDelay =
          noProgress && (enqueued.done || !enqueued.advanced) ? STALLED_JOB_RECHECK_MS : 0;
        await ctx.scheduler.runAfter(
          continuationDelay,
          internalRefs.packageDryRunScans.processPackageDryRunScanJobBatchInternal as never,
          {
            jobId: args.jobId,
            batchSize: args.batchSize,
          } as never,
        );
      }

      return {
        jobId: args.jobId,
        enqueued: enqueued.enqueued,
        claimed: claimed.length,
        completed,
        skipped,
        failed,
        done: finalized.done,
        status: finalized.status,
      };
    } catch (error) {
      const finalized = await runMutationRef<{ done: boolean; status: string }>(
        ctx,
        internalRefs.packageDryRunScans.failPackageDryRunScanJobInternal,
        { jobId: args.jobId, error: errorMessage(error) },
      );
      return {
        jobId: args.jobId,
        enqueued: enqueued.enqueued,
        claimed: claimed.length,
        completed,
        skipped,
        failed,
        done: finalized.done,
        status: finalized.status,
      };
    }
  },
});
