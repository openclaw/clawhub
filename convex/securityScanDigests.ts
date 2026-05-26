import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./functions";
import { assertModerator, requireUser } from "./lib/access";
import { normalizePackageName } from "./lib/packageRegistry";
import {
  buildPluginSecurityScanArtifactState,
  buildSkillSecurityScanArtifactState,
  CLAW_SCAN_DIGEST_VERDICTS,
  clampSecurityScanDigestBackfillBatchSize,
  getCurrentRollupDeltas,
  SECURITY_SCAN_FAILURE_STATUSES,
  SECURITY_SCAN_PIPELINE_STATUSES,
  toSecurityScanHourBucket,
  type SecurityScanArtifactStateFields,
  type SecurityScanCurrentRollupDimensions,
  type SecurityScanHourlyRollupDimensions,
} from "./lib/securityScanDigest";

const securityScanArtifactKindValidator = v.union(v.literal("skill"), v.literal("plugin"));
const securityScanDigestTargetKindValidator = v.union(
  v.literal("skillVersion"),
  v.literal("packageRelease"),
);
const clawScanDigestVerdictValidator = v.union(
  v.literal("pass"),
  v.literal("suspicious"),
  v.literal("malicious"),
  v.literal("pending"),
  v.literal("failed"),
  v.literal("unknown"),
);
const securityScanPipelineStatusValidator = v.union(
  v.literal("none"),
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
);
const securityScanFailureStatusValidator = v.union(v.literal("none"), v.literal("failed"));
const securityScanJobSourceValidator = v.union(
  v.literal("publish"),
  v.literal("clawscan-note"),
  v.literal("vt-update"),
  v.literal("backfill"),
  v.literal("manual"),
);
const pluginPackageFamilyValidator = v.union(v.literal("code-plugin"), v.literal("bundle-plugin"));
const SECURITY_SCAN_OVERVIEW_DEFAULT_WINDOW_HOURS = 24;
const SECURITY_SCAN_OVERVIEW_MAX_WINDOW_HOURS = 168;
const SECURITY_SCAN_OVERVIEW_FAILED_LIMIT = 10;
const SECURITY_SCAN_OVERVIEW_MAX_FAILED_LIMIT = 50;
const SECURITY_SCAN_LIST_DEFAULT_LIMIT = 25;
const SECURITY_SCAN_LIST_MAX_LIMIT = 100;
const SECURITY_SCAN_ROLLUP_TAKE_LIMIT = 500;
const SECURITY_SCAN_HOURLY_TAKE_LIMIT = 2_000;
const SECURITY_SCAN_EVIDENCE_ISSUE_LIMIT = 10;

const securityScanArtifactStateFieldsValidator = v.object({
  artifactKind: securityScanArtifactKindValidator,
  targetKind: securityScanDigestTargetKindValidator,
  artifactKey: v.string(),
  targetKey: v.string(),
  skillId: v.optional(v.id("skills")),
  skillVersionId: v.optional(v.id("skillVersions")),
  packageId: v.optional(v.id("packages")),
  packageReleaseId: v.optional(v.id("packageReleases")),
  ownerUserId: v.id("users"),
  ownerPublisherId: v.optional(v.id("publishers")),
  slug: v.optional(v.string()),
  name: v.optional(v.string()),
  displayName: v.string(),
  version: v.optional(v.string()),
  clawScanVerdict: clawScanDigestVerdictValidator,
  clawScanStatus: v.optional(v.string()),
  clawScanCheckedAt: v.optional(v.number()),
  clawScanSummary: v.optional(v.string()),
  clawScanModel: v.optional(v.string()),
  clawScanPrimaryRiskBucket: v.optional(v.string()),
  clawScanPrimaryCategoryKey: v.optional(v.string()),
  clawScanPrimaryCategoryLabel: v.optional(v.string()),
  clawScanVisibleFindingCount: v.optional(v.number()),
  clawScanHighestSeverity: v.optional(v.string()),
  scanJobStatus: securityScanPipelineStatusValidator,
  failureStatus: securityScanFailureStatusValidator,
  lastScanJobId: v.optional(v.id("securityScanJobs")),
  lastScanJobSource: v.optional(securityScanJobSourceValidator),
  lastScanWorkerId: v.optional(v.string()),
  lastScanAttempts: v.optional(v.number()),
  lastScanQueuedAt: v.optional(v.number()),
  lastScanStartedAt: v.optional(v.number()),
  lastScanCompletedAt: v.optional(v.number()),
  lastScanFailedAt: v.optional(v.number()),
  lastScanUpdatedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  skillSpectorStatus: v.optional(v.string()),
  skillSpectorScore: v.optional(v.number()),
  skillSpectorSeverity: v.optional(v.string()),
  skillSpectorRecommendation: v.optional(v.string()),
  skillSpectorIssueCount: v.optional(v.number()),
  skillSpectorTopCategory: v.optional(v.string()),
  skillSpectorCheckedAt: v.optional(v.number()),
  staticStatus: v.optional(v.string()),
  staticReasonCount: v.optional(v.number()),
  staticCheckedAt: v.optional(v.number()),
  vtStatus: v.optional(v.string()),
  vtVerdict: v.optional(v.string()),
  vtMalicious: v.optional(v.number()),
  vtSuspicious: v.optional(v.number()),
  vtCheckedAt: v.optional(v.number()),
  evidenceUpdatedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const hourlyRollupDimensionsValidator = v.object({
  artifactKind: securityScanArtifactKindValidator,
  clawScanVerdict: clawScanDigestVerdictValidator,
  scanJobStatus: securityScanPipelineStatusValidator,
  failureStatus: securityScanFailureStatusValidator,
});

type DigestMutationCtx = Pick<MutationCtx, "db">;
type DigestReadCtx = Pick<QueryCtx, "db">;
type SecurityScanArtifactKind = "skill" | "plugin";

async function requireStaff(ctx: QueryCtx) {
  const { user } = await requireUser(ctx);
  assertModerator(user);
  return user;
}

async function requireStaffByUserId(ctx: QueryCtx, actorUserId: Id<"users">) {
  const user = await ctx.db.get(actorUserId);
  if (!user || user.deletedAt || user.deactivatedAt) {
    throw new Error("User not found");
  }
  assertModerator(user);
  return user;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value ?? NaN)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value!)));
}

function artifactKindsForArg(
  kind: SecurityScanArtifactKind | undefined,
): SecurityScanArtifactKind[] {
  return kind ? [kind] : ["skill", "plugin"];
}

function emptyCounts() {
  return {
    total: 0,
    byVerdict: Object.fromEntries(CLAW_SCAN_DIGEST_VERDICTS.map((verdict) => [verdict, 0])),
    byScanJobStatus: Object.fromEntries(
      SECURITY_SCAN_PIPELINE_STATUSES.map((status) => [status, 0]),
    ),
    byFailureStatus: Object.fromEntries(
      SECURITY_SCAN_FAILURE_STATUSES.map((status) => [status, 0]),
    ),
  } as {
    total: number;
    byVerdict: Record<(typeof CLAW_SCAN_DIGEST_VERDICTS)[number], number>;
    byScanJobStatus: Record<(typeof SECURITY_SCAN_PIPELINE_STATUSES)[number], number>;
    byFailureStatus: Record<(typeof SECURITY_SCAN_FAILURE_STATUSES)[number], number>;
  };
}

function addRollupToCounts(
  counts: ReturnType<typeof emptyCounts>,
  row: Pick<
    Doc<"securityScanCurrentRollups">,
    "clawScanVerdict" | "scanJobStatus" | "failureStatus" | "count"
  >,
) {
  counts.total += row.count;
  counts.byVerdict[row.clawScanVerdict] += row.count;
  counts.byScanJobStatus[row.scanJobStatus] += row.count;
  counts.byFailureStatus[row.failureStatus] += row.count;
}

function toRollupResponse(row: Doc<"securityScanCurrentRollups">, totalForKind: number) {
  return {
    artifactKind: row.artifactKind,
    rollupKind: row.rollupKind,
    categoryKey: row.categoryKey,
    categoryLabel: row.categoryLabel,
    clawScanVerdict: row.clawScanVerdict,
    scanJobStatus: row.scanJobStatus,
    failureStatus: row.failureStatus,
    count: row.count,
    totalForKind,
    percentageBasis: totalForKind,
    updatedAt: row.updatedAt,
  };
}

function toArtifactStateSummary(state: Doc<"securityScanArtifactStates">) {
  return {
    artifactKind: state.artifactKind,
    targetKind: state.targetKind,
    artifactKey: state.artifactKey,
    targetKey: state.targetKey,
    skillId: state.skillId,
    skillVersionId: state.skillVersionId,
    packageId: state.packageId,
    packageReleaseId: state.packageReleaseId,
    ownerUserId: state.ownerUserId,
    ownerPublisherId: state.ownerPublisherId,
    slug: state.slug,
    name: state.name,
    displayName: state.displayName,
    version: state.version,
    clawScanVerdict: state.clawScanVerdict,
    clawScanStatus: state.clawScanStatus,
    clawScanCheckedAt: state.clawScanCheckedAt,
    clawScanSummary: state.clawScanSummary,
    clawScanModel: state.clawScanModel,
    clawScanPrimaryRiskBucket: state.clawScanPrimaryRiskBucket,
    clawScanPrimaryCategoryKey: state.clawScanPrimaryCategoryKey,
    clawScanPrimaryCategoryLabel: state.clawScanPrimaryCategoryLabel,
    clawScanVisibleFindingCount: state.clawScanVisibleFindingCount,
    clawScanHighestSeverity: state.clawScanHighestSeverity,
    scanJobStatus: state.scanJobStatus,
    failureStatus: state.failureStatus,
    lastScanJobId: state.lastScanJobId,
    lastScanJobSource: state.lastScanJobSource,
    lastScanWorkerId: state.lastScanWorkerId,
    lastScanAttempts: state.lastScanAttempts,
    lastScanQueuedAt: state.lastScanQueuedAt,
    lastScanStartedAt: state.lastScanStartedAt,
    lastScanCompletedAt: state.lastScanCompletedAt,
    lastScanFailedAt: state.lastScanFailedAt,
    lastScanUpdatedAt: state.lastScanUpdatedAt,
    lastError: state.lastError,
    skillSpectorStatus: state.skillSpectorStatus,
    skillSpectorScore: state.skillSpectorScore,
    skillSpectorSeverity: state.skillSpectorSeverity,
    skillSpectorRecommendation: state.skillSpectorRecommendation,
    skillSpectorIssueCount: state.skillSpectorIssueCount,
    skillSpectorTopCategory: state.skillSpectorTopCategory,
    skillSpectorCheckedAt: state.skillSpectorCheckedAt,
    staticStatus: state.staticStatus,
    staticReasonCount: state.staticReasonCount,
    staticCheckedAt: state.staticCheckedAt,
    vtStatus: state.vtStatus,
    vtVerdict: state.vtVerdict,
    vtMalicious: state.vtMalicious,
    vtSuspicious: state.vtSuspicious,
    vtCheckedAt: state.vtCheckedAt,
    evidenceUpdatedAt: state.evidenceUpdatedAt,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

function toHourlySummary(row: Doc<"securityScanHourlyRollups">) {
  return {
    bucketStartMs: row.bucketStartMs,
    artifactKind: row.artifactKind,
    clawScanVerdict: row.clawScanVerdict,
    scanJobStatus: row.scanJobStatus,
    failureStatus: row.failureStatus,
    count: row.count,
    updatedAt: row.updatedAt,
  };
}

function toScanJobSummary(job: Doc<"securityScanJobs"> | null) {
  if (!job) return null;
  return {
    _id: job._id,
    targetKind: job.targetKind,
    skillVersionId: job.skillVersionId,
    packageReleaseId: job.packageReleaseId,
    status: job.status,
    source: job.source,
    priority: job.priority,
    hasMaliciousSignal: job.hasMaliciousSignal,
    waitForVtUntil: job.waitForVtUntil,
    nextRunAt: job.nextRunAt,
    attempts: job.attempts,
    leaseExpiresAt: job.leaseExpiresAt,
    workerId: job.workerId,
    lastError: job.lastError,
    runId: job.runId,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function toEvidenceSummary(
  artifact:
    | Pick<
        Doc<"skillVersions">,
        "llmAnalysis" | "skillSpectorAnalysis" | "staticScan" | "vtAnalysis"
      >
    | Pick<
        Doc<"packageReleases">,
        "llmAnalysis" | "skillSpectorAnalysis" | "staticScan" | "vtAnalysis"
      >
    | null,
) {
  return {
    clawScan: {
      status: artifact?.llmAnalysis?.status,
      verdict: artifact?.llmAnalysis?.verdict,
      confidence: artifact?.llmAnalysis?.confidence,
      summary: artifact?.llmAnalysis?.summary,
      guidance: artifact?.llmAnalysis?.guidance,
      findings: artifact?.llmAnalysis?.findings,
      model: artifact?.llmAnalysis?.model,
      checkedAt: artifact?.llmAnalysis?.checkedAt,
      riskSummary: artifact?.llmAnalysis?.riskSummary,
      agenticRiskFindings: artifact?.llmAnalysis?.agenticRiskFindings,
    },
    skillSpector: {
      status: artifact?.skillSpectorAnalysis?.status,
      score: artifact?.skillSpectorAnalysis?.score,
      severity: artifact?.skillSpectorAnalysis?.severity,
      recommendation: artifact?.skillSpectorAnalysis?.recommendation,
      issueCount: artifact?.skillSpectorAnalysis?.issueCount,
      checkedAt: artifact?.skillSpectorAnalysis?.checkedAt,
      issues: (artifact?.skillSpectorAnalysis?.issues ?? []).slice(
        0,
        SECURITY_SCAN_EVIDENCE_ISSUE_LIMIT,
      ),
    },
    staticScan: artifact?.staticScan,
    virusTotal: artifact?.vtAnalysis,
  };
}

async function getArtifactStateByKey(
  ctx: DigestReadCtx,
  artifactKind: SecurityScanArtifactKind,
  artifactKey: string,
) {
  return await ctx.db
    .query("securityScanArtifactStates")
    .withIndex("by_artifact_kind_and_artifact_key", (q) =>
      q.eq("artifactKind", artifactKind).eq("artifactKey", artifactKey),
    )
    .unique();
}

async function getCurrentAllRollups(ctx: DigestReadCtx, kind: SecurityScanArtifactKind) {
  return await ctx.db
    .query("securityScanCurrentRollups")
    .withIndex("by_artifact_kind_and_rollup_kind_and_category_key", (q) =>
      q.eq("artifactKind", kind).eq("rollupKind", "all").eq("categoryKey", "all"),
    )
    .take(SECURITY_SCAN_ROLLUP_TAKE_LIMIT);
}

async function readStaffSecurityScanOverview(
  ctx: QueryCtx,
  args: {
    artifactKind?: SecurityScanArtifactKind;
    windowHours?: number;
    failedLimit?: number;
  },
) {
  const now = Date.now();
  const windowHours = clampInt(
    args.windowHours,
    SECURITY_SCAN_OVERVIEW_DEFAULT_WINDOW_HOURS,
    1,
    SECURITY_SCAN_OVERVIEW_MAX_WINDOW_HOURS,
  );
  const failedLimit = clampInt(
    args.failedLimit,
    SECURITY_SCAN_OVERVIEW_FAILED_LIMIT,
    0,
    SECURITY_SCAN_OVERVIEW_MAX_FAILED_LIMIT,
  );
  const windowStartMs = toSecurityScanHourBucket(now - windowHours * 60 * 60 * 1000);
  const kinds = artifactKindsForArg(args.artifactKind);

  const currentByKind: Record<
    SecurityScanArtifactKind,
    {
      totals: ReturnType<typeof emptyCounts>;
      rollups: ReturnType<typeof toRollupResponse>[];
      truncated: boolean;
    }
  > = {
    skill: { totals: emptyCounts(), rollups: [], truncated: false },
    plugin: { totals: emptyCounts(), rollups: [], truncated: false },
  };
  const hourlyRows: ReturnType<typeof toHourlySummary>[] = [];
  const hourlyTotals: Record<SecurityScanArtifactKind, ReturnType<typeof emptyCounts>> = {
    skill: emptyCounts(),
    plugin: emptyCounts(),
  };
  const failedRows: ReturnType<typeof toArtifactStateSummary>[] = [];

  for (const kind of kinds) {
    const allRollups = await getCurrentAllRollups(ctx, kind);
    for (const row of allRollups) addRollupToCounts(currentByKind[kind].totals, row);

    const rollupRows = await ctx.db
      .query("securityScanCurrentRollups")
      .withIndex("by_artifact_kind_and_rollup_kind_and_category_key", (q) =>
        q.eq("artifactKind", kind),
      )
      .take(SECURITY_SCAN_ROLLUP_TAKE_LIMIT);
    currentByKind[kind].truncated = rollupRows.length >= SECURITY_SCAN_ROLLUP_TAKE_LIMIT;
    currentByKind[kind].rollups = rollupRows.map((row) =>
      toRollupResponse(row, currentByKind[kind].totals.total),
    );

    const hourly = await ctx.db
      .query("securityScanHourlyRollups")
      .withIndex("by_artifact_kind_and_bucket_start_ms", (q) =>
        q.eq("artifactKind", kind).gte("bucketStartMs", windowStartMs),
      )
      .order("desc")
      .take(SECURITY_SCAN_HOURLY_TAKE_LIMIT);
    for (const row of hourly) {
      const summary = toHourlySummary(row);
      hourlyRows.push(summary);
      addRollupToCounts(hourlyTotals[kind], row);
    }

    if (failedLimit > 0) {
      const failed = await ctx.db
        .query("securityScanArtifactStates")
        .withIndex("by_artifact_kind_and_failure_status_and_updated_at", (q) =>
          q.eq("artifactKind", kind).eq("failureStatus", "failed"),
        )
        .order("desc")
        .take(failedLimit);
      failedRows.push(...failed.map(toArtifactStateSummary));
    }
  }

  return {
    generatedAt: now,
    window: {
      hours: windowHours,
      startMs: windowStartMs,
      endMs: now,
      totalsByKind: Object.fromEntries(kinds.map((kind) => [kind, hourlyTotals[kind]])),
      rows: hourlyRows.sort((a, b) => b.bucketStartMs - a.bucketStartMs),
      truncated: hourlyRows.length >= SECURITY_SCAN_HOURLY_TAKE_LIMIT * kinds.length,
    },
    current: Object.fromEntries(kinds.map((kind) => [kind, currentByKind[kind]])),
    failed: {
      items: failedRows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, failedLimit),
      limit: failedLimit,
    },
  };
}

async function listStaffSecurityScanArtifactsPage(
  ctx: QueryCtx,
  args: {
    artifactKind: SecurityScanArtifactKind;
    cursor?: string | null;
    limit?: number;
    clawScanVerdict?: (typeof CLAW_SCAN_DIGEST_VERDICTS)[number];
    scanJobStatus?: (typeof SECURITY_SCAN_PIPELINE_STATUSES)[number];
    failureStatus?: (typeof SECURITY_SCAN_FAILURE_STATUSES)[number];
    clawScanPrimaryCategoryKey?: string;
  },
) {
  const limit = clampInt(
    args.limit,
    SECURITY_SCAN_LIST_DEFAULT_LIMIT,
    1,
    SECURITY_SCAN_LIST_MAX_LIMIT,
  );
  const cursor = args.cursor ?? null;
  const filterCount = [
    args.failureStatus,
    args.scanJobStatus,
    args.clawScanVerdict,
    args.clawScanPrimaryCategoryKey,
  ].filter((value) => value !== undefined).length;
  if (filterCount > 1) {
    throw new Error("Provide at most one security scan artifact filter");
  }

  const page = args.failureStatus
    ? await ctx.db
        .query("securityScanArtifactStates")
        .withIndex("by_artifact_kind_and_failure_status_and_updated_at", (q) =>
          q.eq("artifactKind", args.artifactKind).eq("failureStatus", args.failureStatus!),
        )
        .order("desc")
        .paginate({ cursor, numItems: limit })
    : args.scanJobStatus
      ? await ctx.db
          .query("securityScanArtifactStates")
          .withIndex("by_artifact_kind_and_scan_job_status_and_updated_at", (q) =>
            q.eq("artifactKind", args.artifactKind).eq("scanJobStatus", args.scanJobStatus!),
          )
          .order("desc")
          .paginate({ cursor, numItems: limit })
      : args.clawScanVerdict
        ? await ctx.db
            .query("securityScanArtifactStates")
            .withIndex("by_artifact_kind_and_claw_scan_verdict_and_updated_at", (q) =>
              q.eq("artifactKind", args.artifactKind).eq("clawScanVerdict", args.clawScanVerdict!),
            )
            .order("desc")
            .paginate({ cursor, numItems: limit })
        : args.clawScanPrimaryCategoryKey
          ? await ctx.db
              .query("securityScanArtifactStates")
              .withIndex("by_kind_claw_category_updated_at", (q) =>
                q
                  .eq("artifactKind", args.artifactKind)
                  .eq("clawScanPrimaryCategoryKey", args.clawScanPrimaryCategoryKey!),
              )
              .order("desc")
              .paginate({ cursor, numItems: limit })
          : await ctx.db
              .query("securityScanArtifactStates")
              .withIndex("by_artifact_kind_and_updated_at", (q) =>
                q.eq("artifactKind", args.artifactKind),
              )
              .order("desc")
              .paginate({ cursor, numItems: limit });

  return {
    items: page.page.map(toArtifactStateSummary),
    nextCursor: page.isDone ? null : page.continueCursor,
    done: page.isDone,
    limit,
  };
}

async function readStaffSecurityScanArtifact(
  ctx: QueryCtx,
  args: { skillSlug?: string; packageName?: string },
) {
  const skillSlug = args.skillSlug?.trim();
  const packageName = args.packageName?.trim();
  if (Boolean(skillSlug) === Boolean(packageName)) {
    throw new Error("Provide exactly one of skillSlug or packageName");
  }

  if (skillSlug) {
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", skillSlug))
      .unique();
    if (!skill || skill.softDeletedAt) {
      return {
        found: false as const,
        artifactKind: "skill" as const,
        reason: "missing" as const,
      };
    }
    const state = await getArtifactStateByKey(ctx, "skill", `skill:${skill._id}`);
    const version = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;
    const scanJob = state?.lastScanJobId ? await ctx.db.get(state.lastScanJobId) : null;
    return {
      found: true as const,
      artifactKind: "skill" as const,
      state: state ? toArtifactStateSummary(state) : null,
      artifact: {
        skill: {
          _id: skill._id,
          slug: skill.slug,
          displayName: skill.displayName,
          ownerUserId: skill.ownerUserId,
          ownerPublisherId: skill.ownerPublisherId,
          latestVersionId: skill.latestVersionId,
        },
        version: version
          ? {
              _id: version._id,
              version: version.version,
              createdAt: version.createdAt,
            }
          : null,
      },
      scanJob: toScanJobSummary(scanJob),
      evidence: toEvidenceSummary(version),
    };
  }

  const normalizedName = normalizePackageName(packageName ?? "");
  if (!normalizedName) {
    return { found: false as const, artifactKind: "plugin" as const, reason: "missing" as const };
  }
  const pkg = await ctx.db
    .query("packages")
    .withIndex("by_name", (q) => q.eq("normalizedName", normalizedName))
    .unique();
  if (!pkg || pkg.softDeletedAt || pkg.family === "skill") {
    return { found: false as const, artifactKind: "plugin" as const, reason: "missing" as const };
  }
  const state = await getArtifactStateByKey(ctx, "plugin", `plugin:${pkg._id}`);
  const release = pkg.latestReleaseId ? await ctx.db.get(pkg.latestReleaseId) : null;
  const scanJob = state?.lastScanJobId ? await ctx.db.get(state.lastScanJobId) : null;
  return {
    found: true as const,
    artifactKind: "plugin" as const,
    state: state ? toArtifactStateSummary(state) : null,
    artifact: {
      package: {
        _id: pkg._id,
        name: pkg.name,
        displayName: pkg.displayName,
        ownerUserId: pkg.ownerUserId,
        ownerPublisherId: pkg.ownerPublisherId,
        family: pkg.family,
        latestReleaseId: pkg.latestReleaseId,
      },
      release: release
        ? {
            _id: release._id,
            version: release.version,
            createdAt: release.createdAt,
          }
        : null,
    },
    scanJob: toScanJobSummary(scanJob),
    evidence: toEvidenceSummary(release),
  };
}

export const getStaffSecurityScanOverview = query({
  args: {
    artifactKind: v.optional(securityScanArtifactKindValidator),
    windowHours: v.optional(v.number()),
    failedLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    return await readStaffSecurityScanOverview(ctx, args);
  },
});

export const getStaffSecurityScanOverviewInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    artifactKind: v.optional(securityScanArtifactKindValidator),
    windowHours: v.optional(v.number()),
    failedLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireStaffByUserId(ctx, args.actorUserId);
    return await readStaffSecurityScanOverview(ctx, args);
  },
});

export const listStaffSecurityScanArtifacts = query({
  args: {
    artifactKind: securityScanArtifactKindValidator,
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    clawScanVerdict: v.optional(clawScanDigestVerdictValidator),
    scanJobStatus: v.optional(securityScanPipelineStatusValidator),
    failureStatus: v.optional(securityScanFailureStatusValidator),
    clawScanPrimaryCategoryKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    return await listStaffSecurityScanArtifactsPage(ctx, args);
  },
});

export const listStaffSecurityScanArtifactsInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    artifactKind: securityScanArtifactKindValidator,
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    clawScanVerdict: v.optional(clawScanDigestVerdictValidator),
    scanJobStatus: v.optional(securityScanPipelineStatusValidator),
    failureStatus: v.optional(securityScanFailureStatusValidator),
    clawScanPrimaryCategoryKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireStaffByUserId(ctx, args.actorUserId);
    return await listStaffSecurityScanArtifactsPage(ctx, args);
  },
});

export const getStaffSecurityScanArtifact = query({
  args: {
    skillSlug: v.optional(v.string()),
    packageName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    return await readStaffSecurityScanArtifact(ctx, args);
  },
});

export const getStaffSecurityScanArtifactInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    skillSlug: v.optional(v.string()),
    packageName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireStaffByUserId(ctx, args.actorUserId);
    return await readStaffSecurityScanArtifact(ctx, args);
  },
});

async function applyCurrentRollupDelta(
  ctx: DigestMutationCtx,
  dimensions: SecurityScanCurrentRollupDimensions,
  delta: 1 | -1,
  now: number,
) {
  const existing = await ctx.db
    .query("securityScanCurrentRollups")
    .withIndex("by_kind_rollup_category_verdict_job_failure", (q) =>
      q
        .eq("artifactKind", dimensions.artifactKind)
        .eq("rollupKind", dimensions.rollupKind)
        .eq("categoryKey", dimensions.categoryKey)
        .eq("clawScanVerdict", dimensions.clawScanVerdict)
        .eq("scanJobStatus", dimensions.scanJobStatus)
        .eq("failureStatus", dimensions.failureStatus),
    )
    .unique();
  const nextCount = (existing?.count ?? 0) + delta;
  if (existing) {
    if (nextCount <= 0) {
      await ctx.db.delete(existing._id);
      return;
    }
    await ctx.db.patch(existing._id, {
      categoryLabel: dimensions.categoryLabel,
      count: nextCount,
      updatedAt: now,
    });
    return;
  }
  if (nextCount <= 0) return;
  await ctx.db.insert("securityScanCurrentRollups", {
    ...dimensions,
    count: nextCount,
    updatedAt: now,
  });
}

export async function upsertSecurityScanArtifactState(
  ctx: DigestMutationCtx,
  fields: SecurityScanArtifactStateFields,
) {
  const existing = await ctx.db
    .query("securityScanArtifactStates")
    .withIndex("by_artifact_kind_and_artifact_key", (q) =>
      q.eq("artifactKind", fields.artifactKind).eq("artifactKey", fields.artifactKey),
    )
    .unique();
  const stateFields = existing ? { ...fields, createdAt: existing.createdAt } : fields;
  const rollupDeltas = getCurrentRollupDeltas(existing, stateFields);
  if (existing) {
    await ctx.db.patch(existing._id, stateFields);
  } else {
    await ctx.db.insert("securityScanArtifactStates", stateFields);
  }
  for (const rollupDelta of rollupDeltas) {
    await applyCurrentRollupDelta(ctx, rollupDelta.dimensions, rollupDelta.delta, fields.updatedAt);
  }
  return {
    inserted: !existing,
    rollupDeltaCount: rollupDeltas.length,
  };
}

export async function deleteSecurityScanArtifactState(
  ctx: DigestMutationCtx,
  existing: Doc<"securityScanArtifactStates">,
  now: number,
) {
  const rollupDeltas = getCurrentRollupDeltas(existing, null);
  await ctx.db.delete(existing._id);
  for (const rollupDelta of rollupDeltas) {
    await applyCurrentRollupDelta(ctx, rollupDelta.dimensions, rollupDelta.delta, now);
  }
  return { deleted: true, rollupDeltaCount: rollupDeltas.length };
}

export const upsertSecurityScanArtifactStateInternal = internalMutation({
  args: {
    state: securityScanArtifactStateFieldsValidator,
  },
  handler: async (ctx, args) => {
    return await upsertSecurityScanArtifactState(ctx, args.state);
  },
});

export const deleteSecurityScanArtifactStateInternal = internalMutation({
  args: {
    artifactKind: securityScanArtifactKindValidator,
    artifactKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("securityScanArtifactStates")
      .withIndex("by_artifact_kind_and_artifact_key", (q) =>
        q.eq("artifactKind", args.artifactKind).eq("artifactKey", args.artifactKey),
      )
      .unique();
    if (!existing) return { deleted: false, rollupDeltaCount: 0 };
    return await deleteSecurityScanArtifactState(ctx, existing, Date.now());
  },
});

async function getLatestSkillScanJob(ctx: DigestMutationCtx, skillVersionId: Id<"skillVersions">) {
  return await ctx.db
    .query("securityScanJobs")
    .withIndex("by_skill_version_and_updated_at", (q) => q.eq("skillVersionId", skillVersionId))
    .order("desc")
    .first();
}

async function getLatestPackageScanJob(
  ctx: DigestMutationCtx,
  packageReleaseId: Id<"packageReleases">,
) {
  return await ctx.db
    .query("securityScanJobs")
    .withIndex("by_package_release_and_updated_at", (q) =>
      q.eq("packageReleaseId", packageReleaseId),
    )
    .order("desc")
    .first();
}

async function writeBackfillMetadata(
  ctx: DigestMutationCtx,
  params: {
    key: string;
    artifactKind: "skill" | "plugin";
    cursor: string | null;
    isDone: boolean;
    scannedCount: number;
    upsertedCount: number;
    skippedCount: number;
    resetCounts: boolean;
    now: number;
  },
) {
  const existing = await ctx.db
    .query("securityScanDigestMetadata")
    .withIndex("by_key", (q) => q.eq("key", params.key))
    .unique();
  const previousCounts =
    existing && !params.resetCounts
      ? {
          scannedCount: existing.scannedCount,
          upsertedCount: existing.upsertedCount,
          skippedCount: existing.skippedCount,
        }
      : { scannedCount: 0, upsertedCount: 0, skippedCount: 0 };
  const fields: Omit<Doc<"securityScanDigestMetadata">, "_creationTime" | "_id"> = {
    key: params.key,
    artifactKind: params.artifactKind,
    cursor: params.cursor,
    isDone: params.isDone,
    scannedCount: previousCounts.scannedCount + params.scannedCount,
    upsertedCount: previousCounts.upsertedCount + params.upsertedCount,
    skippedCount: previousCounts.skippedCount + params.skippedCount,
    startedAt: params.resetCounts || !existing ? params.now : existing.startedAt,
    completedAt: params.isDone ? params.now : undefined,
    updatedAt: params.now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, fields);
  } else {
    await ctx.db.insert("securityScanDigestMetadata", fields);
  }
  return fields;
}

export const backfillSkillSecurityScanDigestPageInternal = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db
      .query("skills")
      .withIndex("by_active_updated", (q) => q.eq("softDeletedAt", undefined))
      .paginate({
        cursor: args.cursor ?? null,
        numItems: clampSecurityScanDigestBackfillBatchSize(args.batchSize),
      });
    let upsertedCount = 0;
    let skippedCount = 0;
    for (const skill of page.page) {
      if (!skill.latestVersionId) {
        skippedCount++;
        continue;
      }
      const version = await ctx.db.get(skill.latestVersionId);
      if (!version || version.softDeletedAt) {
        skippedCount++;
        continue;
      }
      const scanJob = await getLatestSkillScanJob(ctx, version._id);
      await upsertSecurityScanArtifactState(
        ctx,
        buildSkillSecurityScanArtifactState({ skill, version, scanJob, now }),
      );
      upsertedCount++;
    }
    const metadata = await writeBackfillMetadata(ctx, {
      key: "backfill:skill",
      artifactKind: "skill",
      cursor: page.continueCursor,
      isDone: page.isDone,
      scannedCount: page.page.length,
      upsertedCount,
      skippedCount,
      resetCounts: args.cursor === undefined || args.cursor === null,
      now,
    });
    return {
      scannedCount: page.page.length,
      upsertedCount,
      skippedCount,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      metadata,
    };
  },
});

export const backfillPluginSecurityScanDigestPageInternal = internalMutation({
  args: {
    family: pluginPackageFamilyValidator,
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db
      .query("packages")
      .withIndex("by_family_and_soft_deleted_at_and_updated_at", (q) =>
        q.eq("family", args.family).eq("softDeletedAt", undefined),
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: clampSecurityScanDigestBackfillBatchSize(args.batchSize),
      });
    let upsertedCount = 0;
    let skippedCount = 0;
    for (const pkg of page.page) {
      if (!pkg.latestReleaseId) {
        skippedCount++;
        continue;
      }
      const release = await ctx.db.get(pkg.latestReleaseId);
      if (!release || release.softDeletedAt) {
        skippedCount++;
        continue;
      }
      const scanJob = await getLatestPackageScanJob(ctx, release._id);
      await upsertSecurityScanArtifactState(
        ctx,
        buildPluginSecurityScanArtifactState({ pkg, release, scanJob, now }),
      );
      upsertedCount++;
    }
    const metadata = await writeBackfillMetadata(ctx, {
      key: `backfill:plugin:${args.family}`,
      artifactKind: "plugin",
      cursor: page.continueCursor,
      isDone: page.isDone,
      scannedCount: page.page.length,
      upsertedCount,
      skippedCount,
      resetCounts: args.cursor === undefined || args.cursor === null,
      now,
    });
    return {
      family: args.family,
      scannedCount: page.page.length,
      upsertedCount,
      skippedCount,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      metadata,
    };
  },
});

function isStaleSkillState(skill: Doc<"skills"> | null, state: Doc<"securityScanArtifactStates">) {
  return (
    !skill ||
    skill.softDeletedAt !== undefined ||
    !state.skillVersionId ||
    skill.latestVersionId !== state.skillVersionId
  );
}

function isStalePluginState(pkg: Doc<"packages"> | null, state: Doc<"securityScanArtifactStates">) {
  return (
    !pkg ||
    pkg.softDeletedAt !== undefined ||
    !state.packageReleaseId ||
    pkg.latestReleaseId !== state.packageReleaseId
  );
}

export const pruneStaleSecurityScanArtifactStatesPageInternal = internalMutation({
  args: {
    artifactKind: securityScanArtifactKindValidator,
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db
      .query("securityScanArtifactStates")
      .withIndex("by_artifact_kind_and_updated_at", (q) => q.eq("artifactKind", args.artifactKind))
      .paginate({
        cursor: args.cursor ?? null,
        numItems: clampSecurityScanDigestBackfillBatchSize(args.batchSize),
      });
    let deletedCount = 0;
    for (const state of page.page) {
      if (state.artifactKind === "skill") {
        const skill = state.skillId ? await ctx.db.get(state.skillId) : null;
        if (!isStaleSkillState(skill, state)) continue;
      } else {
        const pkg = state.packageId ? await ctx.db.get(state.packageId) : null;
        if (!isStalePluginState(pkg, state)) continue;
      }
      await deleteSecurityScanArtifactState(ctx, state, now);
      deletedCount++;
    }
    return {
      scannedCount: page.page.length,
      deletedCount,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const clearSecurityScanCurrentRollupsPageInternal = internalMutation({
  args: {
    artifactKind: securityScanArtifactKindValidator,
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await clearSecurityScanCurrentRollupsPage(ctx, args);
  },
});

export async function clearSecurityScanCurrentRollupsPage(
  ctx: DigestMutationCtx,
  args: {
    artifactKind: "skill" | "plugin";
    batchSize?: number;
  },
) {
  const batchSize = clampSecurityScanDigestBackfillBatchSize(args.batchSize);
  const rows = await ctx.db
    .query("securityScanCurrentRollups")
    .withIndex("by_artifact_kind_and_rollup_kind_and_category_key", (q) =>
      q.eq("artifactKind", args.artifactKind),
    )
    .take(batchSize);
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return {
    deletedCount: rows.length,
    isDone: rows.length < batchSize,
  };
}

export const rebuildSecurityScanCurrentRollupsFromStatesPageInternal = internalMutation({
  args: {
    artifactKind: securityScanArtifactKindValidator,
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await rebuildSecurityScanCurrentRollupsFromStatesPage(ctx, args);
  },
});

export async function rebuildSecurityScanCurrentRollupsFromStatesPage(
  ctx: DigestMutationCtx,
  args: {
    artifactKind: "skill" | "plugin";
    cursor?: string | null;
    batchSize?: number;
  },
) {
  const now = Date.now();
  const page = await ctx.db
    .query("securityScanArtifactStates")
    .withIndex("by_artifact_kind_and_updated_at", (q) => q.eq("artifactKind", args.artifactKind))
    .paginate({
      cursor: args.cursor ?? null,
      numItems: clampSecurityScanDigestBackfillBatchSize(args.batchSize),
    });
  let rollupDeltaCount = 0;
  for (const state of page.page) {
    const rollupDeltas = getCurrentRollupDeltas(null, state);
    for (const rollupDelta of rollupDeltas) {
      await applyCurrentRollupDelta(ctx, rollupDelta.dimensions, rollupDelta.delta, now);
      rollupDeltaCount++;
    }
  }
  return {
    scannedCount: page.page.length,
    rollupDeltaCount,
    continueCursor: page.continueCursor,
    isDone: page.isDone,
  };
}

async function applyHourlyRollupDelta(
  ctx: DigestMutationCtx,
  bucketStartMs: number,
  dimensions: SecurityScanHourlyRollupDimensions,
  count: number,
  now: number,
) {
  const existing = await ctx.db
    .query("securityScanHourlyRollups")
    .withIndex("by_bucket_kind_verdict_job_failure", (q) =>
      q
        .eq("bucketStartMs", bucketStartMs)
        .eq("artifactKind", dimensions.artifactKind)
        .eq("clawScanVerdict", dimensions.clawScanVerdict)
        .eq("scanJobStatus", dimensions.scanJobStatus)
        .eq("failureStatus", dimensions.failureStatus),
    )
    .unique();
  if (existing) {
    const nextCount = existing.count + count;
    await ctx.db.patch(existing._id, { count: nextCount, updatedAt: now });
    return { updated: true, count: nextCount };
  }
  await ctx.db.insert("securityScanHourlyRollups", {
    bucketStartMs,
    ...dimensions,
    count,
    updatedAt: now,
  });
  return { updated: true, count };
}

export async function recordSecurityScanHourlyRollupEvent(
  ctx: DigestMutationCtx,
  params: {
    eventKey: string;
    occurredAt: number;
    dimensions: SecurityScanHourlyRollupDimensions;
    count?: number;
  },
) {
  const count = params.count ?? 1;
  if (count <= 0) return { updated: false, duplicate: false, count: 0 };
  const existingEvent = await ctx.db
    .query("securityScanHourlyRollupEvents")
    .withIndex("by_event_key", (q) => q.eq("eventKey", params.eventKey))
    .unique();
  if (existingEvent) return { updated: false, duplicate: true, count: existingEvent.count };

  const now = Date.now();
  const bucketStartMs = toSecurityScanHourBucket(params.occurredAt);
  await ctx.db.insert("securityScanHourlyRollupEvents", {
    eventKey: params.eventKey,
    bucketStartMs,
    ...params.dimensions,
    count,
    createdAt: now,
  });
  const result = await applyHourlyRollupDelta(ctx, bucketStartMs, params.dimensions, count, now);
  return { ...result, duplicate: false };
}

export const recordSecurityScanHourlyRollupEventInternal = internalMutation({
  args: {
    eventKey: v.string(),
    occurredAt: v.number(),
    dimensions: hourlyRollupDimensionsValidator,
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await recordSecurityScanHourlyRollupEvent(ctx, args);
  },
});
