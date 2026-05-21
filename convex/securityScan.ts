import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { action, internalMutation, internalQuery } from "./functions";
import { assertModerator } from "./lib/access";

const MAX_PARALLEL_CODEX_SCANS = 20;
const DEFAULT_VT_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_LEASE_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const DEFAULT_CANCEL_SCAN_LIMIT = 1000;
const DEFAULT_CANCEL_DELETE_LIMIT = 500;
const MAX_CANCEL_SCAN_LIMIT = 5000;
const CANCEL_SAMPLE_LIMIT = 20;

const finalLlmAnalysisStatuses = new Set(["clean", "suspicious", "malicious"]);

type CancelSkipReason =
  | "not-queued"
  | "not-vt-update"
  | "not-queued-vt-update"
  | "malicious-signal"
  | "missing-target-id"
  | "missing-target"
  | "missing-llm-analysis"
  | "non-final-llm-analysis"
  | "delete-limit-reached";

const jobSourceValidator = v.union(
  v.literal("publish"),
  v.literal("clawscan-note"),
  v.literal("vt-update"),
  v.literal("backfill"),
  v.literal("manual"),
);

type EnqueueSkillVersionScanArgs = {
  versionId: Id<"skillVersions">;
  source: "publish" | "clawscan-note" | "vt-update" | "backfill" | "manual";
  priority?: number;
  waitForVtMs?: number;
};

const llmAgenticRiskEvidenceValidator = v.object({
  path: v.string(),
  snippet: v.string(),
  explanation: v.string(),
});

const llmAgenticRiskFindingValidator = v.object({
  categoryId: v.string(),
  categoryLabel: v.string(),
  riskBucket: v.union(
    v.literal("abnormal_behavior_control"),
    v.literal("permission_boundary"),
    v.literal("sensitive_data_protection"),
  ),
  status: v.union(v.literal("none"), v.literal("note"), v.literal("concern")),
  severity: v.string(),
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  evidence: v.optional(llmAgenticRiskEvidenceValidator),
  userImpact: v.string(),
  recommendation: v.string(),
});

const llmRiskSummaryBucketValidator = v.object({
  status: v.union(v.literal("none"), v.literal("note"), v.literal("concern")),
  summary: v.string(),
  highestSeverity: v.optional(v.string()),
});

const llmAnalysisValidator = v.object({
  status: v.string(),
  verdict: v.optional(v.string()),
  confidence: v.optional(v.string()),
  summary: v.optional(v.string()),
  dimensions: v.optional(
    v.array(
      v.object({
        name: v.string(),
        label: v.string(),
        rating: v.string(),
        detail: v.string(),
      }),
    ),
  ),
  guidance: v.optional(v.string()),
  findings: v.optional(v.string()),
  agenticRiskFindings: v.optional(v.array(llmAgenticRiskFindingValidator)),
  riskSummary: v.optional(
    v.object({
      abnormal_behavior_control: llmRiskSummaryBucketValidator,
      permission_boundary: llmRiskSummaryBucketValidator,
      sensitive_data_protection: llmRiskSummaryBucketValidator,
    }),
  ),
  model: v.optional(v.string()),
  checkedAt: v.number(),
});

const internalRefs = internal as unknown as {
  packages: {
    getPackageByIdInternal: unknown;
    getReleaseByIdInternal: unknown;
    updateReleaseLlmAnalysisInternal: unknown;
  };
  securityScan: {
    claimQueuedJobsInternal: unknown;
    enqueuePackageReleaseScanInternal: unknown;
    enqueueSkillVersionScanInternal: unknown;
    failJobInternal: unknown;
    getJobTargetInternal: unknown;
    succeedJobInternal: unknown;
  };
  skills: {
    getSkillByIdInternal: unknown;
    getVersionByIdInternal: unknown;
    updateVersionLlmAnalysisInternal: unknown;
  };
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

function assertWorkerToken(token: string) {
  const expected = process.env.SECURITY_SCAN_WORKER_TOKEN;
  if (!expected || token !== expected) throw new ConvexError("Unauthorized");
}

function normalizeLimit(limit: number | undefined) {
  return Math.max(
    1,
    Math.min(Math.floor(limit ?? MAX_PARALLEL_CODEX_SCANS), MAX_PARALLEL_CODEX_SCANS),
  );
}

function normalizeMaintenanceScanLimit(limit: number | undefined) {
  const normalized = Number.isFinite(limit) ? Math.floor(limit ?? DEFAULT_CANCEL_SCAN_LIMIT) : null;
  return Math.max(1, Math.min(normalized ?? DEFAULT_CANCEL_SCAN_LIMIT, MAX_CANCEL_SCAN_LIMIT));
}

function normalizeMaintenanceDeleteLimit(limit: number | undefined, scanLimit: number) {
  const normalized = Number.isFinite(limit)
    ? Math.floor(limit ?? DEFAULT_CANCEL_DELETE_LIMIT)
    : null;
  return Math.max(0, Math.min(normalized ?? DEFAULT_CANCEL_DELETE_LIMIT, scanLimit));
}

function incrementSkip(
  skippedByReason: Partial<Record<CancelSkipReason, number>>,
  reason: CancelSkipReason,
) {
  skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
}

function isOpenClawPluginPackage(
  pkg: Doc<"packages"> | null | undefined,
  ownerPublisher: Pick<Doc<"publishers">, "handle" | "deletedAt"> | null | undefined,
) {
  if (!pkg) return false;
  if (pkg.family !== "code-plugin" && pkg.family !== "bundle-plugin") return false;
  if (!pkg.normalizedName.startsWith("@openclaw/")) return false;
  return ownerPublisher?.handle.trim().toLowerCase() === "openclaw" && !ownerPublisher.deletedAt;
}

export const enqueueSkillVersionScanInternal = internalMutation({
  args: {
    versionId: v.id("skillVersions"),
    source: jobSourceValidator,
    priority: v.optional(v.number()),
    waitForVtMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return enqueueSkillVersionScan(ctx, args);
  },
});

export const enqueueSkillRescanForModeratorInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    slug: v.string(),
    version: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor) throw new ConvexError("Unauthorized");
    assertModerator(actor);

    const slug = args.slug.trim().toLowerCase();
    if (!slug) throw new ConvexError("Slug required");
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!skill || skill.softDeletedAt) throw new ConvexError("Skill not found");

    const requestedVersion = args.version?.trim();
    const version = requestedVersion
      ? await ctx.db
          .query("skillVersions")
          .withIndex("by_skill_version", (q) =>
            q.eq("skillId", skill._id).eq("version", requestedVersion),
          )
          .unique()
      : skill.latestVersionId
        ? await ctx.db.get(skill.latestVersionId)
        : null;
    if (!version || version.softDeletedAt) throw new ConvexError("Skill version not found");

    const queued = await enqueueSkillVersionScan(ctx, {
      versionId: version._id,
      source: "manual",
      priority: 100,
      waitForVtMs: 0,
    });
    if (!queued.jobId) throw new ConvexError("Skill version not found");

    await ctx.db.insert("auditLogs", {
      actorUserId: actor._id,
      action: "skill.clawscan.rescan",
      targetType: "skillVersion",
      targetId: version._id,
      metadata: {
        skillId: skill._id,
        slug: skill.slug,
        version: version.version,
        jobId: queued.jobId,
        alreadyQueued: queued.alreadyQueued === true,
      },
      createdAt: Date.now(),
    });

    return {
      ok: true as const,
      slug: skill.slug,
      version: version.version,
      skillId: skill._id,
      skillVersionId: version._id,
      jobId: queued.jobId,
      alreadyQueued: queued.alreadyQueued === true,
    };
  },
});

async function enqueueSkillVersionScan(ctx: MutationCtx, args: EnqueueSkillVersionScanArgs) {
  const version = await ctx.db.get(args.versionId);
  if (!version || version.softDeletedAt) return { ok: true as const, skipped: "missing" as const };
  const now = Date.now();
  const waitForVtUntil = now + Math.max(0, args.waitForVtMs ?? DEFAULT_VT_WAIT_MS);
  const nextRunAt = args.waitForVtMs === 0 || version.vtAnalysis ? now : waitForVtUntil;
  const hasMaliciousSignal = version.staticScan?.status === "malicious";

  const existing = await ctx.db
    .query("securityScanJobs")
    .withIndex("by_skill_version", (q) => q.eq("skillVersionId", args.versionId))
    .collect();
  const active = existing.find((job) => job.status === "queued" || job.status === "running");
  if (active) {
    await ctx.db.patch(active._id, {
      source: args.source,
      priority: Math.max(active.priority, args.priority ?? 0),
      hasMaliciousSignal: active.hasMaliciousSignal || hasMaliciousSignal,
      waitForVtUntil: Math.min(active.waitForVtUntil, waitForVtUntil),
      nextRunAt: Math.min(active.nextRunAt, nextRunAt),
      updatedAt: now,
    });
    return { ok: true as const, jobId: active._id, alreadyQueued: true as const };
  }

  const jobId = await ctx.db.insert("securityScanJobs", {
    targetKind: "skillVersion",
    skillVersionId: args.versionId,
    status: "queued",
    source: args.source,
    priority: args.priority ?? (hasMaliciousSignal ? 100 : 0),
    hasMaliciousSignal,
    waitForVtUntil,
    nextRunAt,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true as const, jobId, alreadyQueued: false as const };
}

export const enqueuePackageReleaseScanInternal = internalMutation({
  args: {
    releaseId: v.id("packageReleases"),
    source: jobSourceValidator,
    priority: v.optional(v.number()),
    waitForVtMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const release = await ctx.db.get(args.releaseId);
    if (!release || release.softDeletedAt) return { ok: true as const, skipped: "missing" };
    const now = Date.now();
    const waitForVtUntil = now + Math.max(0, args.waitForVtMs ?? DEFAULT_VT_WAIT_MS);
    const nextRunAt = args.waitForVtMs === 0 || release.vtAnalysis ? now : waitForVtUntil;
    const hasMaliciousSignal = release.staticScan?.status === "malicious";

    const existing = await ctx.db
      .query("securityScanJobs")
      .withIndex("by_package_release", (q) => q.eq("packageReleaseId", args.releaseId))
      .collect();
    const active = existing.find((job) => job.status === "queued" || job.status === "running");
    if (active) {
      await ctx.db.patch(active._id, {
        source: args.source,
        priority: Math.max(active.priority, args.priority ?? 0),
        hasMaliciousSignal: active.hasMaliciousSignal || hasMaliciousSignal,
        waitForVtUntil: Math.min(active.waitForVtUntil, waitForVtUntil),
        nextRunAt: Math.min(active.nextRunAt, nextRunAt),
        updatedAt: now,
      });
      return { ok: true as const, jobId: active._id };
    }

    const jobId = await ctx.db.insert("securityScanJobs", {
      targetKind: "packageRelease",
      packageReleaseId: args.releaseId,
      status: "queued",
      source: args.source,
      priority: args.priority ?? (hasMaliciousSignal ? 100 : 0),
      hasMaliciousSignal,
      waitForVtUntil,
      nextRunAt,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true as const, jobId };
  },
});

export const cancelQueuedVtUpdateJobsInternal = internalMutation({
  args: {
    dryRun: v.boolean(),
    createdBefore: v.number(),
    scanLimit: v.optional(v.number()),
    deleteLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const scanLimit = normalizeMaintenanceScanLimit(args.scanLimit);
    const deleteLimit = normalizeMaintenanceDeleteLimit(args.deleteLimit, scanLimit);
    const jobs = await ctx.db
      .query("securityScanJobs")
      .withIndex("by_status_source_created_at", (q) =>
        q.eq("status", "queued").eq("source", "vt-update").lt("createdAt", args.createdBefore),
      )
      .order("asc")
      .take(scanLimit);

    const skippedByReason: Partial<Record<CancelSkipReason, number>> = {};
    const sampleMatchedJobIds: string[] = [];
    const sampleDeletedJobIds: string[] = [];
    let matched = 0;
    let deleted = 0;

    for (const job of jobs) {
      if (job.status !== "queued") {
        incrementSkip(
          skippedByReason,
          job.source === "vt-update" ? "not-queued-vt-update" : "not-queued",
        );
        continue;
      }
      if (job.source !== "vt-update") {
        incrementSkip(skippedByReason, "not-vt-update");
        continue;
      }
      if (job.hasMaliciousSignal) {
        incrementSkip(skippedByReason, "malicious-signal");
        continue;
      }

      const targetId =
        job.targetKind === "skillVersion" ? job.skillVersionId : job.packageReleaseId;
      if (!targetId) {
        incrementSkip(skippedByReason, "missing-target-id");
        continue;
      }
      const target = await ctx.db.get(targetId);
      if (!target || target.softDeletedAt) {
        incrementSkip(skippedByReason, "missing-target");
        continue;
      }
      const rawLlmStatus = target.llmAnalysis?.status?.trim();
      if (!rawLlmStatus) {
        incrementSkip(skippedByReason, "missing-llm-analysis");
        continue;
      }
      if (!finalLlmAnalysisStatuses.has(rawLlmStatus.toLowerCase())) {
        incrementSkip(skippedByReason, "non-final-llm-analysis");
        continue;
      }

      // Emergency cleanup: source may have been overwritten by a VT update, but this
      // intentionally cancels old VT-origin work once ClawScan has a final result.
      matched += 1;
      if (sampleMatchedJobIds.length < CANCEL_SAMPLE_LIMIT) sampleMatchedJobIds.push(job._id);
      if (matched > deleteLimit) {
        incrementSkip(skippedByReason, "delete-limit-reached");
        continue;
      }
      if (args.dryRun) continue;

      await ctx.db.delete(job._id);
      deleted += 1;
      if (sampleDeletedJobIds.length < CANCEL_SAMPLE_LIMIT) sampleDeletedJobIds.push(job._id);
    }

    const oldestScannedJob = jobs[0];
    const newestScannedJob = jobs.at(-1);
    return {
      dryRun: args.dryRun,
      scanned: jobs.length,
      matched,
      wouldDelete: Math.min(matched, deleteLimit),
      deleted,
      skippedByReason,
      oldestScannedCreatedAt: oldestScannedJob?.createdAt ?? null,
      newestScannedCreatedAt: newestScannedJob?.createdAt ?? null,
      oldestScannedNextRunAt: oldestScannedJob?.nextRunAt ?? null,
      newestScannedNextRunAt: newestScannedJob?.nextRunAt ?? null,
      sampleMatchedJobIds,
      sampleDeletedJobIds,
    };
  },
});

export const claimQueuedJobsInternal = internalMutation({
  args: {
    workerId: v.string(),
    limit: v.number(),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = normalizeLimit(args.limit);
    const leaseMs = Math.max(60_000, Math.min(args.leaseMs ?? DEFAULT_LEASE_MS, 60 * 60 * 1000));

    const running = await ctx.db
      .query("securityScanJobs")
      .withIndex("by_status_and_lease_expires_at", (q) => q.eq("status", "running"))
      .take(MAX_PARALLEL_CODEX_SCANS * 4);
    for (const job of running) {
      if ((job.leaseExpiresAt ?? 0) <= now) {
        await ctx.db.patch(job._id, {
          status: "queued",
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          workerId: undefined,
          nextRunAt: now,
          updatedAt: now,
        });
      }
    }
    const activeRunning = running.filter((job) => (job.leaseExpiresAt ?? 0) > now).length;
    const capacity = Math.max(0, Math.min(limit, MAX_PARALLEL_CODEX_SCANS - activeRunning));
    if (capacity === 0) return [];

    const maliciousSignalReady = await ctx.db
      .query("securityScanJobs")
      .withIndex("by_status_malicious_signal_next_run_at", (q) =>
        q.eq("status", "queued").eq("hasMaliciousSignal", true).lte("nextRunAt", now),
      )
      .order("asc")
      .take(capacity);
    const claimedIds = new Set(maliciousSignalReady.map((job) => job._id));
    const remainingCapacity = capacity - maliciousSignalReady.length;
    const queued = remainingCapacity
      ? await ctx.db
          .query("securityScanJobs")
          .withIndex("by_status_and_next_run_at", (q) =>
            q.eq("status", "queued").lte("nextRunAt", now),
          )
          .order("asc")
          .take(remainingCapacity * 4)
      : [];
    const ready = [...maliciousSignalReady, ...queued.filter((job) => !claimedIds.has(job._id))]
      .filter((job) => job.nextRunAt <= now)
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
      .slice(0, capacity);

    const claimed = [];
    for (const job of ready) {
      const leaseToken = crypto.randomUUID();
      await ctx.db.patch(job._id, {
        status: "running",
        attempts: job.attempts + 1,
        leaseToken,
        leaseExpiresAt: now + leaseMs,
        workerId: args.workerId,
        lastError: undefined,
        updatedAt: now,
      });
      claimed.push({
        ...job,
        status: "running" as const,
        attempts: job.attempts + 1,
        leaseToken,
        leaseExpiresAt: now + leaseMs,
        workerId: args.workerId,
      });
    }
    return claimed;
  },
});

export const getJobTargetInternal = internalQuery({
  args: {
    jobId: v.id("securityScanJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    if (job.targetKind === "skillVersion" && job.skillVersionId) {
      const version = await ctx.db.get(job.skillVersionId);
      if (!version || version.softDeletedAt) return { job, missing: true as const };
      const skill = await ctx.db.get(version.skillId);
      return { job, skill, version };
    }
    if (job.targetKind === "packageRelease" && job.packageReleaseId) {
      const release = await ctx.db.get(job.packageReleaseId);
      if (!release || release.softDeletedAt) return { job, missing: true as const };
      const pkg = await ctx.db.get(release.packageId);
      const ownerPublisher = pkg?.ownerPublisherId ? await ctx.db.get(pkg.ownerPublisherId) : null;
      return {
        job,
        package: pkg,
        release,
        trustedOpenClawPlugin: isOpenClawPluginPackage(pkg, ownerPublisher),
      };
    }
    return { job, missing: true as const };
  },
});

export const succeedJobInternal = internalMutation({
  args: {
    jobId: v.id("securityScanJobs"),
    leaseToken: v.string(),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseToken !== args.leaseToken) throw new ConvexError("Lease mismatch");
    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "succeeded",
      runId: args.runId,
      completedAt: now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

export const failJobInternal = internalMutation({
  args: {
    jobId: v.id("securityScanJobs"),
    leaseToken: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseToken !== args.leaseToken) throw new ConvexError("Lease mismatch");
    const now = Date.now();
    const retry = job.attempts < MAX_ATTEMPTS;
    await ctx.db.patch(args.jobId, {
      status: retry ? "queued" : "failed",
      lastError: args.error.slice(0, 2000),
      nextRunAt: retry ? now + Math.min(30 * 60 * 1000, 2 ** job.attempts * 60_000) : job.nextRunAt,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      workerId: undefined,
      updatedAt: now,
    });
    return { ok: true as const, retry };
  },
});

export const claimCodexScanJobs = action({
  args: {
    token: v.string(),
    workerId: v.string(),
    limit: v.optional(v.number()),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertWorkerToken(args.token);
    const jobs = await runMutationRef<Array<Doc<"securityScanJobs"> & { leaseToken: string }>>(
      ctx,
      internalRefs.securityScan.claimQueuedJobsInternal,
      {
        workerId: args.workerId,
        limit: normalizeLimit(args.limit),
        leaseMs: args.leaseMs,
      },
    );

    const hydrated = [];
    for (const job of jobs) {
      const target = await runQueryRef<Record<string, unknown> | null>(
        ctx,
        internalRefs.securityScan.getJobTargetInternal,
        { jobId: job._id },
      );
      if (!target || target.missing) {
        await runMutationRef(ctx, internalRefs.securityScan.failJobInternal, {
          jobId: job._id,
          leaseToken: job.leaseToken,
          error: "Target artifact missing",
        });
        continue;
      }

      const files = ((target.version as Doc<"skillVersions"> | undefined)?.files ??
        (target.release as Doc<"packageReleases"> | undefined)?.files ??
        []) as Array<{
        path: string;
        size: number;
        sha256: string;
        storageId: Id<"_storage">;
        contentType?: string;
      }>;
      const fileUrls = [];
      let missingStoragePath: string | null = null;
      for (const file of files) {
        const url = await ctx.storage.getUrl(file.storageId);
        if (!url) {
          missingStoragePath = file.path;
          break;
        }
        fileUrls.push({
          path: file.path,
          size: file.size,
          sha256: file.sha256,
          contentType: file.contentType,
          url,
        });
      }
      if (missingStoragePath) {
        await runMutationRef(ctx, internalRefs.securityScan.failJobInternal, {
          jobId: job._id,
          leaseToken: job.leaseToken,
          error: `Artifact file unavailable: ${missingStoragePath}`,
        });
        continue;
      }

      const release = target.release as Doc<"packageReleases"> | undefined;
      const clawpackUrl = release?.clawpackStorageId
        ? await ctx.storage.getUrl(release.clawpackStorageId)
        : null;
      if (release?.clawpackStorageId && !clawpackUrl) {
        await runMutationRef(ctx, internalRefs.securityScan.failJobInternal, {
          jobId: job._id,
          leaseToken: job.leaseToken,
          error: "ClawPack artifact unavailable",
        });
        continue;
      }
      hydrated.push({
        job,
        target: {
          ...target,
          files: fileUrls,
          clawpackUrl,
        },
      });
    }
    return hydrated;
  },
});

export const completeCodexScanJob = action({
  args: {
    token: v.string(),
    jobId: v.id("securityScanJobs"),
    leaseToken: v.string(),
    llmAnalysis: llmAnalysisValidator,
    runId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertWorkerToken(args.token);
    const target = await runQueryRef<{
      job: Doc<"securityScanJobs">;
      version?: Doc<"skillVersions">;
      release?: Doc<"packageReleases">;
    } | null>(ctx, internalRefs.securityScan.getJobTargetInternal, {
      jobId: args.jobId,
    });
    if (!target) throw new ConvexError("Job not found");
    if (target.job.leaseToken !== args.leaseToken) throw new ConvexError("Lease mismatch");

    if (target.job.targetKind === "skillVersion" && target.version) {
      await runMutationRef(ctx, internalRefs.skills.updateVersionLlmAnalysisInternal, {
        versionId: target.version._id,
        llmAnalysis: args.llmAnalysis,
      });
    } else if (target.job.targetKind === "packageRelease" && target.release) {
      await runMutationRef(ctx, internalRefs.packages.updateReleaseLlmAnalysisInternal, {
        releaseId: target.release._id,
        llmAnalysis: args.llmAnalysis,
      });
    } else {
      throw new ConvexError("Unsupported security scan target");
    }

    return await runMutationRef(ctx, internalRefs.securityScan.succeedJobInternal, {
      jobId: args.jobId,
      leaseToken: args.leaseToken,
      runId: args.runId,
    });
  },
});

export const failCodexScanJob = action({
  args: {
    token: v.string(),
    jobId: v.id("securityScanJobs"),
    leaseToken: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    assertWorkerToken(args.token);
    return await runMutationRef(ctx, internalRefs.securityScan.failJobInternal, {
      jobId: args.jobId,
      leaseToken: args.leaseToken,
      error: args.error,
    });
  },
});
