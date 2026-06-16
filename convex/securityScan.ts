import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery, mutation } from "./functions";
import { applyGitHubSkillVerificationResultHandler } from "./githubSkillSync";
import { assertAdmin, assertModerator, requireUser } from "./lib/access";
import { normalizePackageName } from "./lib/packageRegistry";
import { normalizePackageScanStatus } from "./lib/packageSecurity";
import { assertCanManageOwnedResource } from "./lib/publishers";
import { sourceSkillVersionFiles } from "./lib/skillCards";
import {
  chunkSkillScanRequestFiles,
  MAX_SKILL_SCAN_REQUEST_FILE_CHUNKS,
  MAX_SKILL_SCAN_REQUEST_MANIFEST_BYTES,
  serializedSkillScanRequestFilesBytes,
} from "./lib/skillScanRequestFiles";

const DEFAULT_VT_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_LEASE_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const DEFAULT_CODEX_SCAN_CLAIM_LIMIT = 64;
const MAX_CODEX_SCAN_CLAIM_LIMIT = 512;
const MAX_EXPIRED_CODEX_SCAN_LEASE_REQUEUES = 512;
const DEFAULT_CANCEL_SCAN_LIMIT = 1000;
const DEFAULT_CANCEL_DELETE_LIMIT = 500;
const MAX_CANCEL_SCAN_LIMIT = 5000;
const CANCEL_SAMPLE_LIMIT = 20;
const DEFAULT_PRUNE_SKILL_SCAN_REQUEST_LIMIT = 10;
const MAX_PRUNE_SKILL_SCAN_REQUEST_LIMIT = 10;
const DEFAULT_BULK_RESCAN_BATCH_SIZE = 50;
const MAX_BULK_RESCAN_BATCH_SIZE = 100;
const MAX_BULK_RESCAN_STATUS_JOB_IDS = 200;
const BULK_RESCAN_SAMPLE_LIMIT = 10;
const MAX_STORED_SKILLSPECTOR_ISSUES = 25;
const MAX_STORED_SKILLSPECTOR_TEXT_CHARS = 2_000;
const MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS = 512;
const DEFAULT_SKILL_SCAN_REQUEST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SKILL_SCAN_QUEUE_POSITION_READS = 250;
const MAX_SKILL_SCAN_RUNNING_COUNT_READS = 512;
const GITHUB_SKILL_SCAN_ACTION_LEASE_MS = 15 * 60 * 1000;
const SKILL_SCAN_ASYNC_NOTE = "Scans are asynchronous and may take time to complete.";

const finalLlmAnalysisStatuses = new Set(["clean", "suspicious", "malicious"]);
const artifactBackedLlmAnalysisStatuses = new Set(["clean", "benign", "suspicious", "malicious"]);

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

type JobTarget = {
  job: Doc<"securityScanJobs">;
  skill?: Doc<"skills"> | null;
  version?: Doc<"skillVersions">;
  release?: Doc<"packageReleases">;
  scanRequest?: Doc<"skillScanRequests">;
  scanRequestFiles?: Doc<"skillScanRequests">["files"];
  githubScan?: Doc<"githubSkillScans">;
  missing?: true;
};

type ExistingLlmAnalysis = {
  status?: string;
  verdict?: string;
};

type SkillSpectorIssueForStorage = {
  issueId: string;
  category?: string;
  pattern?: string;
  severity: string;
  confidence?: number;
  file?: string;
  startLine?: number;
  endLine?: number;
  explanation: string;
  remediation?: string;
  finding?: string;
  codeSnippet?: string;
};

type SkillSpectorAnalysisForStorage = {
  status: string;
  score?: number;
  severity?: string;
  recommendation?: string;
  issueCount: number;
  issues: SkillSpectorIssueForStorage[];
  scannerVersion?: string;
  summary?: string;
  error?: string;
  checkedAt: number;
};

type StoredScanArtifactKind = "skill" | "plugin";

const jobSourceValidator = v.union(
  v.literal("publish"),
  v.literal("vt-update"),
  v.literal("backfill"),
  v.literal("bulk-rescan"),
  v.literal("manual"),
);

type SecurityScanJobSource = "publish" | "vt-update" | "backfill" | "bulk-rescan" | "manual";

const CLAIM_SOURCE_ORDER: SecurityScanJobSource[] = [
  "backfill",
  "publish",
  "vt-update",
  "bulk-rescan",
];

type EnqueueSkillVersionScanArgs = {
  versionId: Id<"skillVersions">;
  source: SecurityScanJobSource;
  priority?: number;
  waitForVtMs?: number;
  preserveActiveJob?: boolean;
};

type EnqueuePackageReleaseScanArgs = {
  releaseId: Id<"packageReleases">;
  source: SecurityScanJobSource;
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

const skillSpectorIssueValidator = v.object({
  issueId: v.string(),
  category: v.optional(v.string()),
  pattern: v.optional(v.string()),
  severity: v.string(),
  confidence: v.optional(v.number()),
  file: v.optional(v.string()),
  startLine: v.optional(v.number()),
  endLine: v.optional(v.number()),
  explanation: v.string(),
  remediation: v.optional(v.string()),
  finding: v.optional(v.string()),
  codeSnippet: v.optional(v.string()),
});

const skillSpectorAnalysisValidator = v.object({
  status: v.string(),
  score: v.optional(v.number()),
  severity: v.optional(v.string()),
  recommendation: v.optional(v.string()),
  issueCount: v.number(),
  // Scanner/action boundaries cap this array before storage; Convex validators cannot express max length.
  issues: v.array(skillSpectorIssueValidator),
  scannerVersion: v.optional(v.string()),
  summary: v.optional(v.string()),
  error: v.optional(v.string()),
  checkedAt: v.number(),
});

const scanRequestFileValidator = v.object({
  path: v.string(),
  size: v.number(),
  storageId: v.id("_storage"),
  sha256: v.string(),
  contentType: v.optional(v.string()),
});

const staticScanResultValidator = v.object({
  status: v.union(v.literal("clean"), v.literal("suspicious"), v.literal("malicious")),
  reasonCodes: v.array(v.string()),
  findings: v.array(
    v.object({
      code: v.string(),
      severity: v.union(v.literal("info"), v.literal("warn"), v.literal("critical")),
      file: v.string(),
      line: v.number(),
      message: v.string(),
      evidence: v.string(),
    }),
  ),
  summary: v.string(),
  engineVersion: v.string(),
  checkedAt: v.number(),
});

const githubSkillScanStatusValidator = v.union(
  v.literal("clean"),
  v.literal("suspicious"),
  v.literal("malicious"),
  v.literal("pending"),
  v.literal("failed"),
);

const internalRefs = internal as unknown as {
  packages: {
    getPackageByIdInternal: unknown;
    getReleaseByIdInternal: unknown;
    updateReleaseLlmAnalysisInternal: unknown;
    updateReleaseSkillSpectorAnalysisInternal: unknown;
  };
  securityScan: {
    claimQueuedJobsInternal: unknown;
    createUploadedSkillScanRequestInternal: unknown;
    createPublishedSkillScanRequestInternal: unknown;
    enqueuePackageReleaseScanInternal: unknown;
    enqueueSkillVersionScanInternal: unknown;
    failJobInternal: unknown;
    getSkillScanRequestForUserInternal: unknown;
    getJobTargetInternal: unknown;
    recordGitHubSkillScanResultInternal: unknown;
    recordSkillScanRequestFailedInternal: unknown;
    recordSkillScanRequestSucceededInternal: unknown;
    succeedJobInternal: unknown;
  };
  skills: {
    getSkillByIdInternal: unknown;
    getVersionByIdInternal: unknown;
    listVersionFingerprintsInternal: unknown;
    updateVersionLlmAnalysisInternal: unknown;
    updateVersionSkillSpectorAnalysisInternal: unknown;
  };
  skillCards: {
    enqueueForVersionInternal: unknown;
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

function defaultVtWaitMs() {
  const raw = process.env.SECURITY_SCAN_DEFAULT_VT_WAIT_MS?.trim();
  if (!raw) return DEFAULT_VT_WAIT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_VT_WAIT_MS;
  return Math.max(0, Math.min(parsed, DEFAULT_VT_WAIT_MS));
}

function githubSkillScanStatusFromLlmAnalysis(
  analysis: Pick<NonNullable<Doc<"skillVersions">["llmAnalysis"]>, "status" | "verdict">,
) {
  const status = normalizePackageScanStatus(analysis.verdict ?? analysis.status);
  if (status === "clean" || status === "suspicious" || status === "malicious") return status;
  return "failed" as const;
}

function publicWorkerErrorDetail(error: string) {
  return error
    .replace(/https?:\/\/[^\s"')<>]+/g, "[redacted-url]")
    .replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
      (_match, scheme: string) => `${scheme} [redacted-secret]`,
    )
    .replace(
      /\b(token|secret|password|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
      (_match, key: string, separator: string) => `${key}${separator}[redacted-secret]`,
    )
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|AUTHORIZATION))(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
      (_match, key: string, separator: string) => `${key}${separator}[redacted-secret]`,
    )
    .replace(/\b[A-Za-z0-9_+/=-]{64,}\b/g, "[redacted-secret]")
    .slice(0, 500);
}

function truncateSkillSpectorStorageText(
  value: string | undefined,
  maxChars = MAX_STORED_SKILLSPECTOR_TEXT_CHARS,
) {
  if (value === undefined) return undefined;
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function capSkillSpectorIssueForStorage(
  issue: SkillSpectorIssueForStorage,
): SkillSpectorIssueForStorage {
  return {
    issueId:
      truncateSkillSpectorStorageText(issue.issueId, MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS) ??
      "skillspector-issue",
    category: truncateSkillSpectorStorageText(
      issue.category,
      MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS,
    ),
    pattern: truncateSkillSpectorStorageText(
      issue.pattern,
      MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS,
    ),
    severity:
      truncateSkillSpectorStorageText(issue.severity, MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS) ??
      "UNKNOWN",
    confidence: issue.confidence,
    file: truncateSkillSpectorStorageText(issue.file, MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS),
    startLine: issue.startLine,
    endLine: issue.endLine,
    explanation:
      truncateSkillSpectorStorageText(issue.explanation) ??
      "SkillSpector reported this issue without additional explanation.",
    remediation: truncateSkillSpectorStorageText(issue.remediation),
    finding: truncateSkillSpectorStorageText(issue.finding),
    codeSnippet: truncateSkillSpectorStorageText(issue.codeSnippet),
  };
}

function capSkillSpectorAnalysisForStorage(
  analysis: SkillSpectorAnalysisForStorage,
): SkillSpectorAnalysisForStorage {
  return {
    status:
      truncateSkillSpectorStorageText(analysis.status, MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS) ??
      "error",
    score: analysis.score,
    severity: truncateSkillSpectorStorageText(
      analysis.severity,
      MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS,
    ),
    recommendation: truncateSkillSpectorStorageText(
      analysis.recommendation,
      MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS,
    ),
    issueCount: Math.max(analysis.issueCount, analysis.issues.length),
    issues: analysis.issues
      .slice(0, MAX_STORED_SKILLSPECTOR_ISSUES)
      .map(capSkillSpectorIssueForStorage),
    scannerVersion: truncateSkillSpectorStorageText(
      analysis.scannerVersion,
      MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS,
    ),
    summary: truncateSkillSpectorStorageText(analysis.summary),
    error: truncateSkillSpectorStorageText(analysis.error),
    checkedAt: analysis.checkedAt,
  };
}

function buildWorkerFailureLlmAnalysis(error: string) {
  return {
    status: "error",
    confidence: "low",
    summary:
      "ClawScan could not complete because the scanner failed before an artifact-backed review could finish.",
    guidance:
      "Treat this scan as incomplete. Retry ClawScan before inferring safety or risk from this result.",
    findings: `Worker error: ${publicWorkerErrorDetail(error)}`,
    model: "codex-security-worker",
    checkedAt: Date.now(),
  };
}

function hasArtifactBackedLlmAnalysis(analysis: ExistingLlmAnalysis | undefined) {
  const status = analysis?.status?.trim().toLowerCase();
  const verdict = analysis?.verdict?.trim().toLowerCase();
  return (
    artifactBackedLlmAnalysisStatuses.has(status ?? "") ||
    artifactBackedLlmAnalysisStatuses.has(verdict ?? "")
  );
}

function normalizeLimit(limit: number | undefined) {
  const normalized = Number.isFinite(limit)
    ? Math.floor(limit ?? DEFAULT_CODEX_SCAN_CLAIM_LIMIT)
    : DEFAULT_CODEX_SCAN_CLAIM_LIMIT;
  return Math.max(1, Math.min(normalized, MAX_CODEX_SCAN_CLAIM_LIMIT));
}

function normalizeBulkRescanBatchSize(batchSize: number | undefined) {
  const normalized = Number.isFinite(batchSize)
    ? Math.floor(batchSize ?? DEFAULT_BULK_RESCAN_BATCH_SIZE)
    : DEFAULT_BULK_RESCAN_BATCH_SIZE;
  return Math.max(1, Math.min(normalized, MAX_BULK_RESCAN_BATCH_SIZE));
}

async function getBulkSkillRescanBatchStatus(ctx: QueryCtx, jobIds: Id<"securityScanJobs">[]) {
  let queued = 0;
  let running = 0;
  let succeeded = 0;
  let failed = 0;
  let missing = 0;
  const failedJobIds: Id<"securityScanJobs">[] = [];

  for (const jobId of jobIds) {
    const job = await ctx.db.get(jobId);
    if (!job) {
      missing += 1;
      continue;
    }
    if (job.status === "queued") queued += 1;
    else if (job.status === "running") running += 1;
    else if (job.status === "succeeded") succeeded += 1;
    else if (job.status === "failed") {
      failed += 1;
      failedJobIds.push(job._id);
    }
  }

  const terminal = succeeded + failed + missing;
  return {
    ok: true as const,
    total: jobIds.length,
    queued,
    running,
    succeeded,
    failed,
    missing,
    terminal,
    done: queued + running === 0,
    failedJobIds,
  };
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

export const enqueueBulkSkillRescanBatchForAdminInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    mode: v.optional(v.literal("all-active-latest")),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor) throw new ConvexError("Unauthorized");
    assertAdmin(actor);

    const mode = args.mode ?? "all-active-latest";
    const batchSize = normalizeBulkRescanBatchSize(args.batchSize);
    const dryRun = args.dryRun === true;
    const page = await ctx.db
      .query("skills")
      .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
      .order("asc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: batchSize,
      });

    let queued = 0;
    let alreadyQueued = 0;
    let skipped = 0;
    const jobIds: Id<"securityScanJobs">[] = [];
    const sampleSlugs: string[] = [];

    for (const skill of page.page) {
      if (sampleSlugs.length < BULK_RESCAN_SAMPLE_LIMIT) sampleSlugs.push(skill.slug);
      if ((skill.moderationStatus ?? "active") !== "active" || !skill.latestVersionId) {
        skipped += 1;
        continue;
      }

      const version = await ctx.db.get(skill.latestVersionId);
      if (!version || version.softDeletedAt) {
        skipped += 1;
        continue;
      }

      if (dryRun) {
        const existing = await ctx.db
          .query("securityScanJobs")
          .withIndex("by_skill_version", (q) => q.eq("skillVersionId", version._id))
          .collect();
        const active = existing.find((job) => job.status === "queued" || job.status === "running");
        if (active) alreadyQueued += 1;
        else queued += 1;
        continue;
      }

      const result = await enqueueSkillVersionScan(ctx, {
        versionId: version._id,
        source: "bulk-rescan",
        priority: 0,
        waitForVtMs: 0,
        preserveActiveJob: true,
      });
      if (!result.jobId) {
        skipped += 1;
        continue;
      }
      jobIds.push(result.jobId);
      if (result.alreadyQueued) alreadyQueued += 1;
      else queued += 1;
    }

    const nextCursor = page.isDone ? null : page.continueCursor;

    if (!dryRun) {
      const now = Date.now();
      await ctx.db.insert("auditLogs", {
        actorUserId: actor._id,
        action: "skill.clawscan.bulk_rescan_batch",
        targetType: "securityScanBatch",
        targetId: `bulk-rescan:${now}`,
        metadata: {
          mode,
          batchSize,
          queued,
          alreadyQueued,
          skipped,
          cursor: args.cursor ?? null,
          nextCursor,
          sampleSlugs,
        },
        createdAt: now,
      });
    }

    return {
      ok: true as const,
      mode,
      queued,
      alreadyQueued,
      skipped,
      jobIds,
      nextCursor,
      done: page.isDone,
      sampleSlugs,
    };
  },
});

export const getBulkSkillRescanBatchStatusForAdminInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    jobIds: v.array(v.id("securityScanJobs")),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor) throw new ConvexError("Unauthorized");
    assertAdmin(actor);

    return getBulkSkillRescanBatchStatus(ctx, args.jobIds.slice(0, MAX_BULK_RESCAN_STATUS_JOB_IDS));
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

async function requestSkillRescanForActor(
  ctx: MutationCtx,
  args: {
    actor: Doc<"users">;
    skill: Doc<"skills">;
    version?: string;
  },
) {
  await assertCanManageOwnedResource(ctx, {
    actor: args.actor,
    ownerUserId: args.skill.ownerUserId,
    ownerPublisherId: args.skill.ownerPublisherId,
    allowPlatformModerator: true,
  });

  if (args.skill.installKind === "github") {
    if (
      args.skill.githubCurrentStatus !== "present" ||
      !args.skill.githubSourceId ||
      !args.skill.githubPath ||
      !args.skill.githubCurrentCommit ||
      !args.skill.githubCurrentContentHash
    ) {
      throw new ConvexError("GitHub-backed skill content is not available");
    }
    const now = Date.now();
    const { scan, activeJob, actionPending } = await getGitHubSkillScanState(
      ctx,
      args.skill._id,
      args.skill.githubCurrentContentHash,
      now,
    );
    const alreadyQueued = Boolean(activeJob || actionPending);
    if (activeJob?.status === "queued") {
      await ctx.db.patch(activeJob._id, {
        source: "manual",
        priority: Math.max(activeJob.priority, 100),
        waitForVtUntil: Math.min(activeJob.waitForVtUntil, now),
        nextRunAt: Math.min(activeJob.nextRunAt, now),
        updatedAt: now,
      });
    } else if (actionPending && scan?.skillScanRequestId) {
      await ctx.db.patch(scan.skillScanRequestId, {
        requestedJobSource: "manual",
        requestedJobPriority: 100,
        updatedAt: now,
      });
    }
    if (!alreadyQueued) {
      const pendingScanInsert = {
        githubSourceId: args.skill.githubSourceId,
        commit: args.skill.githubCurrentCommit,
        path: args.skill.githubPath,
        status: "pending" as const,
        updatedAt: now,
      };
      if (scan) {
        await ctx.db.patch(scan._id, {
          ...pendingScanInsert,
          skillScanRequestId: undefined,
          skillSpectorAnalysis: undefined,
          llmAnalysis: undefined,
          lastError: undefined,
          runId: undefined,
          completedAt: undefined,
        });
      } else {
        await ctx.db.insert("githubSkillScans", {
          skillId: args.skill._id,
          contentHash: args.skill.githubCurrentContentHash,
          ...pendingScanInsert,
          createdAt: now,
        });
      }
      await ctx.scheduler.runAfter(0, internal.githubSkillSyncNode.verifyGitHubSkillInternal, {
        skillId: args.skill._id,
        contentHash: args.skill.githubCurrentContentHash,
        force: true,
      });
    }
    await ctx.db.insert("auditLogs", {
      actorUserId: args.actor._id,
      action: "skill.clawscan.rescan",
      targetType: "skill",
      targetId: args.skill._id,
      metadata: {
        skillId: args.skill._id,
        slug: args.skill.slug,
        commit: args.skill.githubCurrentCommit,
        contentHash: args.skill.githubCurrentContentHash,
        scheduled: !alreadyQueued,
        alreadyQueued,
        jobId: activeJob?._id,
      },
      createdAt: now,
    });
    return {
      ok: true as const,
      slug: args.skill.slug,
      version:
        args.skill.latestVersionSummary?.version ?? args.skill.githubCurrentCommit.slice(0, 12),
      skillId: args.skill._id,
      githubContentHash: args.skill.githubCurrentContentHash,
      ...(activeJob ? { jobId: activeJob._id } : {}),
      scheduled: !alreadyQueued,
      alreadyQueued,
    };
  }

  const requestedVersion = args.version?.trim();
  const version = requestedVersion
    ? await ctx.db
        .query("skillVersions")
        .withIndex("by_skill_version", (q) =>
          q.eq("skillId", args.skill._id).eq("version", requestedVersion),
        )
        .unique()
    : args.skill.latestVersionId
      ? await ctx.db.get(args.skill.latestVersionId)
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
    actorUserId: args.actor._id,
    action: "skill.clawscan.rescan",
    targetType: "skillVersion",
    targetId: version._id,
    metadata: {
      skillId: args.skill._id,
      slug: args.skill.slug,
      version: version.version,
      jobId: queued.jobId,
      alreadyQueued: queued.alreadyQueued === true,
    },
    createdAt: Date.now(),
  });

  return {
    ok: true as const,
    slug: args.skill.slug,
    version: version.version,
    skillId: args.skill._id,
    skillVersionId: version._id,
    jobId: queued.jobId,
    alreadyQueued: queued.alreadyQueued === true,
  };
}

async function getGitHubSkillScanState(
  ctx: MutationCtx,
  skillId: Id<"skills">,
  contentHash: string,
  now: number,
) {
  const scan = await ctx.db
    .query("githubSkillScans")
    .withIndex("by_skill_and_content_hash", (q) =>
      q.eq("skillId", skillId).eq("contentHash", contentHash),
    )
    .unique();
  if (scan?.status !== "pending") return { scan, activeJob: null, actionPending: false };
  if (!scan.skillScanRequestId) {
    return {
      scan,
      activeJob: null,
      actionPending: scan.updatedAt > now - GITHUB_SKILL_SCAN_ACTION_LEASE_MS,
    };
  }
  const request = await ctx.db.get(scan.skillScanRequestId);
  if (!request?.securityScanJobId) {
    return {
      scan,
      activeJob: null,
      actionPending: Boolean(
        request && request.updatedAt > now - GITHUB_SKILL_SCAN_ACTION_LEASE_MS,
      ),
    };
  }
  const job = await ctx.db.get(request.securityScanJobId);
  return {
    scan,
    activeJob: job && (job.status === "queued" || job.status === "running") ? job : null,
    actionPending: false,
  };
}

export const requestSkillRescanForUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    slug: v.string(),
    version: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor) throw new ConvexError("Unauthorized");

    const slug = args.slug.trim().toLowerCase();
    if (!slug) throw new ConvexError("Slug required");
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!skill || skill.softDeletedAt) throw new ConvexError("Skill not found");

    return requestSkillRescanForActor(ctx, { actor, skill, version: args.version });
  },
});

export const requestSkillRescan = mutation({
  args: {
    skillId: v.id("skills"),
    version: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const skill = await ctx.db.get(args.skillId);
    if (!skill || skill.softDeletedAt) throw new ConvexError("Skill not found");

    return requestSkillRescanForActor(ctx, { actor: user, skill, version: args.version });
  },
});

function skillScanRequestExpiresAt(now: number) {
  return now + DEFAULT_SKILL_SCAN_REQUEST_RETENTION_MS;
}

function skillScanReportFromRequest(request: Doc<"skillScanRequests">) {
  return {
    clawscan: request.llmAnalysis ?? null,
    skillspector: request.skillSpectorAnalysis ?? null,
    staticAnalysis: request.staticScan ?? null,
    virustotal: request.vtAnalysis
      ? {
          ...request.vtAnalysis,
          ...request.vtAnalysis.engineStats,
        }
      : null,
  };
}

function storedScanReportFromArtifact(
  artifact: Pick<
    Doc<"skillVersions"> | Doc<"packageReleases">,
    "llmAnalysis" | "skillSpectorAnalysis" | "staticScan" | "vtAnalysis"
  >,
) {
  return {
    clawscan: artifact.llmAnalysis ?? null,
    skillspector: artifact.skillSpectorAnalysis ?? null,
    staticAnalysis: artifact.staticScan ?? null,
    virustotal: artifact.vtAnalysis
      ? {
          ...artifact.vtAnalysis,
          ...artifact.vtAnalysis.engineStats,
        }
      : null,
  };
}

function hasStoredScanReport(
  artifact: Pick<
    Doc<"skillVersions"> | Doc<"packageReleases">,
    "llmAnalysis" | "skillSpectorAnalysis" | "staticScan" | "vtAnalysis"
  >,
) {
  return Boolean(
    artifact.llmAnalysis ||
    artifact.skillSpectorAnalysis ||
    artifact.staticScan ||
    artifact.vtAnalysis,
  );
}

function completedAtFromStoredScanReport(
  artifact: Pick<
    Doc<"skillVersions"> | Doc<"packageReleases">,
    "llmAnalysis" | "skillSpectorAnalysis" | "staticScan" | "vtAnalysis"
  >,
) {
  const checkedAtValues = [
    artifact.llmAnalysis?.checkedAt,
    artifact.skillSpectorAnalysis?.checkedAt,
    artifact.staticScan?.checkedAt,
    artifact.vtAnalysis?.checkedAt,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return checkedAtValues.length > 0 ? Math.max(...checkedAtValues) : undefined;
}

function skillScanArtifactFromRequest(request: Doc<"skillScanRequests">) {
  return {
    ...(request.slug ? { slug: request.slug } : {}),
    ...(request.displayName ? { displayName: request.displayName } : {}),
    ...(request.version ? { version: request.version } : {}),
    ...(request.sha256hash ? { sha256hash: request.sha256hash } : {}),
    fileCount: request.files.length,
  };
}

async function countSecurityScanJobs(
  ctx: QueryCtx | MutationCtx,
  status: Doc<"securityScanJobs">["status"],
  source: SecurityScanJobSource,
) {
  const jobs = await ctx.db
    .query("securityScanJobs")
    .withIndex("by_status_source_created_at", (q) => q.eq("status", status).eq("source", source))
    .take(MAX_SKILL_SCAN_RUNNING_COUNT_READS + 1);
  return {
    count: Math.min(jobs.length, MAX_SKILL_SCAN_RUNNING_COUNT_READS),
    isEstimate: jobs.length > MAX_SKILL_SCAN_RUNNING_COUNT_READS,
  };
}

function compareQueuedScanClaimOrder(a: Doc<"securityScanJobs">, b: Doc<"securityScanJobs">) {
  if (a.nextRunAt !== b.nextRunAt) return a.nextRunAt - b.nextRunAt;
  if (a._creationTime !== b._creationTime) return a._creationTime - b._creationTime;
  return a._id.localeCompare(b._id);
}

async function countQueuedJobsAhead(ctx: QueryCtx | MutationCtx, job: Doc<"securityScanJobs">) {
  const candidates = await ctx.db
    .query("securityScanJobs")
    .withIndex("by_status_source_next_run_at", (q) =>
      q.eq("status", "queued").eq("source", job.source).lte("nextRunAt", job.nextRunAt),
    )
    .order("asc")
    .take(MAX_SKILL_SCAN_QUEUE_POSITION_READS + 1);

  const queuedAhead = candidates.reduce((count, candidate) => {
    if (candidate._id === job._id) return count;
    return compareQueuedScanClaimOrder(candidate, job) < 0 ? count + 1 : count;
  }, 0);
  const sawTarget = candidates.some((candidate) => candidate._id === job._id);
  const isEstimate =
    !sawTarget ||
    candidates.length > MAX_SKILL_SCAN_QUEUE_POSITION_READS ||
    queuedAhead > MAX_SKILL_SCAN_QUEUE_POSITION_READS;

  return {
    queuedAhead: Math.min(queuedAhead, MAX_SKILL_SCAN_QUEUE_POSITION_READS),
    isEstimate,
  };
}

async function skillScanQueueState(
  ctx: QueryCtx | MutationCtx,
  job: Doc<"securityScanJobs"> | null,
) {
  if (!job) {
    return {
      queuedAhead: 0,
      position: null,
      running: 0,
      note: SKILL_SCAN_ASYNC_NOTE,
    };
  }

  const running = await countSecurityScanJobs(ctx, "running", job.source);
  const queuedAhead =
    job.status === "queued"
      ? await countQueuedJobsAhead(ctx, job)
      : { queuedAhead: 0, isEstimate: false };

  return {
    queuedAhead: queuedAhead.queuedAhead,
    queuedAheadIsEstimate: queuedAhead.isEstimate,
    position:
      job.status === "queued" && !queuedAhead.isEstimate ? queuedAhead.queuedAhead + 1 : null,
    running: running.count,
    runningIsEstimate: running.isEstimate,
    note: SKILL_SCAN_ASYNC_NOTE,
  };
}

async function skillScanStatusResponse(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"skillScanRequests">,
  job: Doc<"securityScanJobs"> | null,
) {
  const status =
    request.status === "succeeded" || request.status === "failed"
      ? request.status
      : (job?.status ?? request.status);
  return {
    ok: true as const,
    scanId: request._id,
    jobId: request.securityScanJobId,
    status,
    sourceKind: request.sourceKind,
    update: request.update,
    writtenBack: request.writtenBack,
    artifact: skillScanArtifactFromRequest(request),
    report: skillScanReportFromRequest(request),
    queue: await skillScanQueueState(ctx, job),
    lastError: request.lastError ?? job?.lastError,
    createdAt: request.createdAt,
    updatedAt: Math.max(request.updatedAt, job?.updatedAt ?? request.updatedAt),
    completedAt: request.completedAt ?? job?.completedAt,
  };
}

async function enqueueSkillScanRequestJob(
  ctx: MutationCtx,
  requestId: Id<"skillScanRequests">,
  options?: { source?: SecurityScanJobSource; priority?: number },
) {
  const request = await ctx.db.get(requestId);
  if (!request) throw new ConvexError("Scan request not found");
  const now = Date.now();
  const jobId = await ctx.db.insert("securityScanJobs", {
    targetKind: "skillScanRequest",
    skillScanRequestId: request._id,
    status: "queued",
    source: options?.source ?? "manual",
    priority: options?.priority ?? 100,
    hasMaliciousSignal: false,
    waitForVtUntil: now,
    nextRunAt: now,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(request._id, {
    securityScanJobId: jobId,
    updatedAt: now,
  });
  return jobId;
}

export const prepareGitHubSkillScanRequestInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    contentHash: v.string(),
    commit: v.string(),
    force: v.optional(v.boolean()),
    parsed: v.object({
      frontmatter: v.record(v.string(), v.any()),
    }),
    staticScan: staticScanResultValidator,
  },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    if (
      !skill ||
      skill.installKind !== "github" ||
      !skill.githubSourceId ||
      !skill.githubPath ||
      skill.githubCurrentStatus !== "present" ||
      skill.githubCurrentCommit !== args.commit ||
      skill.githubCurrentContentHash !== args.contentHash
    ) {
      return { ok: true as const, skipped: "stale-or-missing" as const };
    }
    const existing = await ctx.db
      .query("githubSkillScans")
      .withIndex("by_skill_and_content_hash", (q) =>
        q.eq("skillId", skill._id).eq("contentHash", args.contentHash),
      )
      .unique();
    if (existing && !args.force && existing.status !== "pending" && existing.status !== "failed") {
      await ctx.db.patch(existing._id, {
        githubSourceId: skill.githubSourceId,
        commit: args.commit,
        path: skill.githubPath,
        staticScan: args.staticScan,
        updatedAt: Date.now(),
      });
      return {
        ok: true as const,
        reused: true as const,
        scanId: existing._id,
        scanStatus: existing.status,
      };
    }
    if (existing?.status === "pending" && existing.skillScanRequestId) {
      const request = await ctx.db.get(existing.skillScanRequestId);
      const job = request?.securityScanJobId ? await ctx.db.get(request.securityScanJobId) : null;
      if (request && job && (job.status === "queued" || job.status === "running")) {
        return {
          ok: true as const,
          alreadyQueued: true as const,
          scanId: existing._id,
          requestId: request._id,
          jobId: job._id,
        };
      }
      if (request && request.updatedAt > Date.now() - GITHUB_SKILL_SCAN_ACTION_LEASE_MS) {
        return {
          ok: true as const,
          alreadyQueued: true as const,
          scanId: existing._id,
          requestId: request._id,
        };
      }
    }

    const now = Date.now();
    const scanId =
      existing?._id ??
      (await ctx.db.insert("githubSkillScans", {
        skillId: skill._id,
        githubSourceId: skill.githubSourceId,
        contentHash: args.contentHash,
        commit: args.commit,
        path: skill.githubPath,
        status: "pending",
        staticScan: args.staticScan,
        createdAt: now,
        updatedAt: now,
      }));
    if (existing) {
      await ctx.db.patch(existing._id, {
        githubSourceId: skill.githubSourceId,
        commit: args.commit,
        path: skill.githubPath,
        status: "pending",
        staticScan: args.staticScan,
        skillSpectorAnalysis: undefined,
        llmAnalysis: undefined,
        lastError: undefined,
        runId: undefined,
        completedAt: undefined,
        updatedAt: now,
      });
    }

    const requestId = await ctx.db.insert("skillScanRequests", {
      actorUserId: skill.ownerUserId,
      sourceKind: "github",
      update: false,
      writtenBack: false,
      status: "queued",
      slug: skill.slug,
      displayName: skill.displayName,
      version: skill.latestVersionSummary?.version ?? args.commit.slice(0, 12),
      skillId: skill._id,
      githubSkillScanId: scanId,
      files: [],
      fileChunkCount: 0,
      fileManifestBytes: 0,
      parsed: args.parsed,
      staticScan: args.staticScan,
      expiresAt: skillScanRequestExpiresAt(now),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(scanId, { skillScanRequestId: requestId, updatedAt: now });

    return {
      ok: true as const,
      prepared: true as const,
      scanId,
      requestId,
    };
  },
});

export const appendGitHubSkillScanRequestFilesInternal = internalMutation({
  args: {
    requestId: v.id("skillScanRequests"),
    chunkIndex: v.number(),
    files: v.array(scanRequestFileValidator),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.chunkIndex) || args.chunkIndex < 0) {
      throw new ConvexError("Invalid file chunk index");
    }
    if (args.files.length === 0 || chunkSkillScanRequestFiles(args.files).length !== 1) {
      throw new ConvexError("Invalid file chunk");
    }
    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      request.sourceKind !== "github" ||
      !request.githubSkillScanId ||
      request.securityScanJobId
    ) {
      throw new ConvexError("GitHub scan request is not accepting files");
    }
    const scan = await ctx.db.get(request.githubSkillScanId);
    if (!scan || scan.status !== "pending" || scan.skillScanRequestId !== request._id) {
      throw new ConvexError("GitHub scan request is no longer current");
    }
    const existing = await ctx.db
      .query("skillScanRequestFileChunks")
      .withIndex("by_skill_scan_request_id_and_chunk_index", (q) =>
        q.eq("skillScanRequestId", request._id).eq("chunkIndex", args.chunkIndex),
      )
      .unique();
    if (existing) {
      return { ok: true as const, appended: true as const };
    }
    const fileChunkCount = request.fileChunkCount ?? 0;
    const fileManifestBytes = request.fileManifestBytes ?? 0;
    const chunkBytes = serializedSkillScanRequestFilesBytes(args.files);
    if (
      args.chunkIndex !== fileChunkCount ||
      fileChunkCount >= MAX_SKILL_SCAN_REQUEST_FILE_CHUNKS ||
      fileManifestBytes + chunkBytes > MAX_SKILL_SCAN_REQUEST_MANIFEST_BYTES
    ) {
      throw new ConvexError("GitHub scan request file manifest exceeds the hydration limit");
    }
    const now = Date.now();
    await ctx.db.insert("skillScanRequestFileChunks", {
      skillScanRequestId: request._id,
      chunkIndex: args.chunkIndex,
      files: args.files,
      createdAt: now,
    });
    await ctx.db.patch(request._id, {
      fileChunkCount: fileChunkCount + 1,
      fileManifestBytes: fileManifestBytes + chunkBytes,
      updatedAt: now,
    });
    return { ok: true as const, appended: true as const };
  },
});

export const finalizeGitHubSkillScanRequestInternal = internalMutation({
  args: {
    requestId: v.id("skillScanRequests"),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.sourceKind !== "github" || !request.githubSkillScanId) {
      throw new ConvexError("GitHub scan request not found");
    }
    if (request.securityScanJobId) {
      const job = await ctx.db.get(request.securityScanJobId);
      if (job && (job.status === "queued" || job.status === "running")) {
        return {
          ok: true as const,
          alreadyQueued: true as const,
          scanId: request.githubSkillScanId,
          requestId: request._id,
          jobId: job._id,
        };
      }
      throw new ConvexError("GitHub scan request was already finalized");
    }
    const scan = await ctx.db.get(request.githubSkillScanId);
    const skill = scan ? await ctx.db.get(scan.skillId) : null;
    if (
      !scan ||
      scan.status !== "pending" ||
      scan.skillScanRequestId !== request._id ||
      !skill ||
      skill.installKind !== "github" ||
      skill.githubCurrentStatus !== "present" ||
      skill.githubSourceId !== scan.githubSourceId ||
      skill.githubPath !== scan.path ||
      skill.githubCurrentCommit !== scan.commit ||
      skill.githubCurrentContentHash !== scan.contentHash
    ) {
      throw new ConvexError("GitHub scan request is no longer current");
    }
    const firstChunk = await ctx.db
      .query("skillScanRequestFileChunks")
      .withIndex("by_skill_scan_request_id_and_chunk_index", (q) =>
        q.eq("skillScanRequestId", request._id),
      )
      .take(1);
    if (
      firstChunk.length === 0 ||
      !request.fileChunkCount ||
      !request.fileManifestBytes ||
      request.fileChunkCount > MAX_SKILL_SCAN_REQUEST_FILE_CHUNKS ||
      request.fileManifestBytes > MAX_SKILL_SCAN_REQUEST_MANIFEST_BYTES
    ) {
      throw new ConvexError("GitHub scan request files are missing");
    }

    const jobId = await enqueueSkillScanRequestJob(ctx, request._id, {
      source: args.force ? "manual" : (request.requestedJobSource ?? "publish"),
      priority: Math.max(args.force ? 100 : 0, request.requestedJobPriority ?? 0),
    });
    return {
      ok: true as const,
      queued: true as const,
      scanId: scan._id,
      requestId: request._id,
      jobId,
    };
  },
});

export const createUploadedSkillScanRequestInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    files: v.array(scanRequestFileValidator),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor) throw new ConvexError("Unauthorized");
    if (args.files.length === 0) throw new ConvexError("files required");
    if (
      !args.files.some((file) => {
        const lower = file.path.trim().toLowerCase();
        return lower === "skill.md";
      })
    ) {
      throw new ConvexError("SKILL.md required");
    }

    const now = Date.now();
    const scanId = await ctx.db.insert("skillScanRequests", {
      actorUserId: actor._id,
      sourceKind: "upload",
      update: false,
      writtenBack: false,
      status: "queued",
      displayName: args.displayName,
      version: "local",
      files: args.files,
      expiresAt: skillScanRequestExpiresAt(now),
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await enqueueSkillScanRequestJob(ctx, scanId);

    await ctx.db.insert("auditLogs", {
      actorUserId: actor._id,
      action: "skill.clawscan.scan_upload",
      targetType: "skillScanRequest",
      targetId: scanId,
      metadata: {
        jobId,
        fileCount: args.files.length,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      scanId,
      jobId,
      status: "queued" as const,
      sourceKind: "upload" as const,
      update: false,
      alreadyQueued: false,
      queue: await skillScanQueueState(ctx, await ctx.db.get(jobId)),
    };
  },
});

export const createPublishedSkillScanRequestInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    slug: v.string(),
    version: v.optional(v.string()),
    update: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor) throw new ConvexError("Unauthorized");

    const slug = args.slug.trim().toLowerCase();
    if (!slug) throw new ConvexError("Slug required");
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!skill || skill.softDeletedAt) throw new ConvexError("Skill not found");

    await assertCanManageOwnedResource(ctx, {
      actor,
      ownerUserId: skill.ownerUserId,
      ownerPublisherId: skill.ownerPublisherId,
      allowPlatformModerator: true,
    });

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

    const fingerprintEntries = await ctx.db
      .query("skillVersionFingerprints")
      .withIndex("by_version", (q) => q.eq("versionId", version._id))
      .collect();
    const files = sourceSkillVersionFiles(version.files, {
      generatedBundleFingerprints: fingerprintEntries
        .filter((entry) => entry.kind === "generated-bundle")
        .map((entry) => entry.fingerprint),
    });

    const now = Date.now();
    const update = args.update === true;
    const scanId = await ctx.db.insert("skillScanRequests", {
      actorUserId: actor._id,
      sourceKind: "published",
      update,
      writtenBack: false,
      status: "queued",
      slug: skill.slug,
      displayName: skill.displayName,
      version: version.version,
      skillId: skill._id,
      skillVersionId: version._id,
      files,
      parsed: version.parsed,
      sha256hash: version.sha256hash,
      vtAnalysis: version.vtAnalysis,
      capabilityTags: version.capabilityTags,
      staticScan: version.staticScan,
      expiresAt: skillScanRequestExpiresAt(now),
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await enqueueSkillScanRequestJob(ctx, scanId);

    await ctx.db.insert("auditLogs", {
      actorUserId: actor._id,
      action: update ? "skill.clawscan.scan_published_update" : "skill.clawscan.scan_published",
      targetType: "skillVersion",
      targetId: version._id,
      metadata: {
        skillId: skill._id,
        slug: skill.slug,
        version: version.version,
        scanId,
        jobId,
        update,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      scanId,
      jobId,
      status: "queued" as const,
      sourceKind: "published" as const,
      update,
      alreadyQueued: false,
      queue: await skillScanQueueState(ctx, await ctx.db.get(jobId)),
    };
  },
});

export const getSkillScanRequestForUserInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    scanId: v.id("skillScanRequests"),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor) throw new ConvexError("Unauthorized");
    const request = await ctx.db.get(args.scanId);
    if (!request) throw new ConvexError("Scan not found");
    if (request.actorUserId !== actor._id && actor.role !== "admin" && actor.role !== "moderator") {
      throw new ConvexError("Forbidden");
    }
    const job = request.securityScanJobId ? await ctx.db.get(request.securityScanJobId) : null;
    return await skillScanStatusResponse(ctx, request, job);
  },
});

export const getStoredScanReportForUserInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    kind: v.union(v.literal("skill"), v.literal("plugin")),
    name: v.string(),
    version: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");

    const name = args.name.trim();
    const versionLabel = args.version.trim();
    if (!name) throw new ConvexError("Name required");
    if (!versionLabel) throw new ConvexError("Version required");

    return args.kind === "plugin"
      ? await getStoredPackageScanReportForUser(ctx, {
          actor,
          kind: args.kind,
          name,
          version: versionLabel,
        })
      : await getStoredSkillScanReportForUser(ctx, {
          actor,
          kind: args.kind,
          name,
          version: versionLabel,
        });
  },
});

async function getStoredSkillScanReportForUser(
  ctx: QueryCtx,
  args: {
    actor: Doc<"users">;
    kind: StoredScanArtifactKind;
    name: string;
    version: string;
  },
) {
  const slug = args.name.toLowerCase();
  const skill = await ctx.db
    .query("skills")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (!skill) throw new ConvexError("Skill not found");

  await assertCanManageOwnedResource(ctx, {
    actor: args.actor,
    ownerUserId: skill.ownerUserId,
    ownerPublisherId: skill.ownerPublisherId,
    allowedPublisherRoles: ["publisher"],
    allowPlatformModerator: true,
  });

  const version = await ctx.db
    .query("skillVersions")
    .withIndex("by_skill_version", (q) => q.eq("skillId", skill._id).eq("version", args.version))
    .unique();
  if (!version) throw new ConvexError("Skill version not found");
  if (!hasStoredScanReport(version)) throw new ConvexError("Scan results not found");

  const completedAt = completedAtFromStoredScanReport(version);
  return {
    ok: true as const,
    scanId: `skill:${skill.slug}:${version.version}`,
    status: "succeeded" as const,
    sourceKind: "published" as const,
    update: false,
    writtenBack: true,
    artifact: {
      kind: args.kind,
      slug: skill.slug,
      displayName: skill.displayName,
      version: version.version,
      ...(version.sha256hash ? { sha256hash: version.sha256hash } : {}),
      fileCount: version.files.length,
    },
    report: storedScanReportFromArtifact(version),
    createdAt: version.createdAt,
    updatedAt: Math.max(version.createdAt, completedAt ?? version.createdAt),
    completedAt,
  };
}

async function getStoredPackageScanReportForUser(
  ctx: QueryCtx,
  args: {
    actor: Doc<"users">;
    kind: StoredScanArtifactKind;
    name: string;
    version: string;
  },
) {
  const normalizedName = normalizePackageName(args.name);
  const pkg = await ctx.db
    .query("packages")
    .withIndex("by_name", (q) => q.eq("normalizedName", normalizedName))
    .unique();
  if (!pkg || pkg.family === "skill") throw new ConvexError("Plugin not found");

  await assertCanManageOwnedResource(ctx, {
    actor: args.actor,
    ownerUserId: pkg.ownerUserId,
    ownerPublisherId: pkg.ownerPublisherId,
    allowedPublisherRoles: ["publisher"],
    allowPlatformModerator: true,
  });

  const release = await ctx.db
    .query("packageReleases")
    .withIndex("by_package_version", (q) => q.eq("packageId", pkg._id).eq("version", args.version))
    .unique();
  if (!release) throw new ConvexError("Plugin version not found");
  if (!hasStoredScanReport(release)) throw new ConvexError("Scan results not found");

  const completedAt = completedAtFromStoredScanReport(release);
  return {
    ok: true as const,
    scanId: `plugin:${pkg.normalizedName}:${release.version}`,
    status: "succeeded" as const,
    sourceKind: "published" as const,
    update: false,
    writtenBack: true,
    artifact: {
      kind: args.kind,
      name: pkg.name,
      displayName: pkg.displayName,
      version: release.version,
      ...(release.integritySha256 ? { sha256hash: release.integritySha256 } : {}),
      fileCount: release.files.length,
    },
    report: storedScanReportFromArtifact(release),
    createdAt: release.createdAt,
    updatedAt: Math.max(release.createdAt, completedAt ?? release.createdAt),
    completedAt,
  };
}

export const recordSkillScanRequestSucceededInternal = internalMutation({
  args: {
    scanId: v.id("skillScanRequests"),
    jobId: v.id("securityScanJobs"),
    runId: v.optional(v.string()),
    llmAnalysis: llmAnalysisValidator,
    skillSpectorAnalysis: v.optional(skillSpectorAnalysisValidator),
    writtenBack: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.scanId);
    if (!request) throw new ConvexError("Scan request not found");
    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: "succeeded",
      llmAnalysis: args.llmAnalysis,
      ...(args.skillSpectorAnalysis
        ? { skillSpectorAnalysis: capSkillSpectorAnalysisForStorage(args.skillSpectorAnalysis) }
        : {}),
      writtenBack: args.writtenBack === true || request.writtenBack,
      runId: args.runId,
      completedAt: now,
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

export const recordSkillScanRequestFailedInternal = internalMutation({
  args: {
    scanId: v.id("skillScanRequests"),
    error: v.string(),
    llmAnalysis: v.optional(llmAnalysisValidator),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.scanId);
    if (!request) throw new ConvexError("Scan request not found");
    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: "failed",
      lastError: args.error.slice(0, 2000),
      ...(args.llmAnalysis ? { llmAnalysis: args.llmAnalysis } : {}),
      completedAt: now,
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

export const recordGitHubSkillScanResultInternal = internalMutation({
  args: {
    githubSkillScanId: v.id("githubSkillScans"),
    scanStatus: githubSkillScanStatusValidator,
    llmAnalysis: v.optional(llmAnalysisValidator),
    skillSpectorAnalysis: v.optional(skillSpectorAnalysisValidator),
    error: v.optional(v.string()),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scan = await ctx.db.get(args.githubSkillScanId);
    if (!scan) return { ok: true as const, skipped: "missing-scan" as const };
    const now = Date.now();
    await ctx.db.patch(scan._id, {
      status: args.scanStatus,
      llmAnalysis: args.llmAnalysis,
      skillSpectorAnalysis: args.skillSpectorAnalysis,
      lastError: args.error?.slice(0, 2000),
      runId: args.runId,
      completedAt: now,
      updatedAt: now,
    });
    return await applyGitHubSkillVerificationResultHandler(ctx, {
      skillId: scan.skillId,
      contentHash: scan.contentHash,
      scanStatus: args.scanStatus,
      now,
    });
  },
});

export const pruneExpiredSkillScanRequestsInternal = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(
      1,
      Math.min(
        args.batchSize ?? DEFAULT_PRUNE_SKILL_SCAN_REQUEST_LIMIT,
        MAX_PRUNE_SKILL_SCAN_REQUEST_LIMIT,
      ),
    );
    const now = Date.now();
    const requests = await ctx.db
      .query("skillScanRequests")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .take(batchSize);

    let deletedJobs = 0;
    let deletedFiles = 0;
    let deletedRequests = 0;
    let deferredRequests = 0;
    for (const request of requests) {
      if (request.securityScanJobId) {
        const job = await ctx.db.get(request.securityScanJobId);
        if (job?.targetKind === "skillScanRequest") {
          await ctx.db.delete(job._id);
          deletedJobs += 1;
        }
      }
      const fileChunks =
        request.sourceKind === "github"
          ? await ctx.db
              .query("skillScanRequestFileChunks")
              .withIndex("by_skill_scan_request_id_and_chunk_index", (q) =>
                q.eq("skillScanRequestId", request._id),
              )
              .take(2)
          : [];
      if (fileChunks.length > 1) {
        const chunk = fileChunks[0];
        if (chunk) {
          for (const file of chunk.files) {
            try {
              await ctx.storage.delete(file.storageId);
              deletedFiles += 1;
            } catch {
              // Missing storage objects should not block expiry of the request row.
            }
          }
          await ctx.db.delete(chunk._id);
        }
        deferredRequests += 1;
        continue;
      }
      if (request.sourceKind === "upload" || request.sourceKind === "github") {
        for (const file of [...request.files, ...fileChunks.flatMap((chunk) => chunk.files)]) {
          try {
            await ctx.storage.delete(file.storageId);
            deletedFiles += 1;
          } catch {
            // Missing storage objects should not block expiry of the request row.
          }
        }
      }
      for (const chunk of fileChunks) await ctx.db.delete(chunk._id);
      await ctx.db.delete(request._id);
      deletedRequests += 1;
    }

    const done = requests.length < batchSize && deferredRequests === 0;
    if (!done) {
      await ctx.scheduler.runAfter(0, internal.securityScan.pruneExpiredSkillScanRequestsInternal, {
        batchSize,
      });
    }
    return {
      ok: true as const,
      deletedRequests,
      deferredRequests,
      deletedJobs,
      deletedFiles,
      done,
    };
  },
});

async function requestPackageRescanForActor(
  ctx: MutationCtx,
  args: {
    actor: Doc<"users">;
    pkg: Doc<"packages">;
    version?: string;
  },
) {
  await assertCanManageOwnedResource(ctx, {
    actor: args.actor,
    ownerUserId: args.pkg.ownerUserId,
    ownerPublisherId: args.pkg.ownerPublisherId,
    allowPlatformModerator: true,
  });

  const requestedVersion = args.version?.trim();
  const release = requestedVersion
    ? await ctx.db
        .query("packageReleases")
        .withIndex("by_package_version", (q) =>
          q.eq("packageId", args.pkg._id).eq("version", requestedVersion),
        )
        .unique()
    : args.pkg.latestReleaseId
      ? await ctx.db.get(args.pkg.latestReleaseId)
      : null;
  if (!release || release.softDeletedAt) throw new ConvexError("Package release not found");

  const queued = await enqueuePackageReleaseScan(ctx, {
    releaseId: release._id,
    source: "manual",
    priority: 100,
    waitForVtMs: 0,
  });
  if (!queued.jobId) throw new ConvexError("Package release not found");

  await ctx.db.insert("auditLogs", {
    actorUserId: args.actor._id,
    action: "package.clawscan.rescan",
    targetType: "packageRelease",
    targetId: release._id,
    metadata: {
      packageId: args.pkg._id,
      name: args.pkg.name,
      version: release.version,
      jobId: queued.jobId,
      alreadyQueued: queued.alreadyQueued === true,
    },
    createdAt: Date.now(),
  });

  return {
    ok: true as const,
    name: args.pkg.name,
    version: release.version,
    packageId: args.pkg._id,
    packageReleaseId: release._id,
    jobId: queued.jobId,
    alreadyQueued: queued.alreadyQueued === true,
  };
}

export const requestPackageRescanForUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    name: v.string(),
    version: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor) throw new ConvexError("Unauthorized");

    const normalizedName = normalizePackageName(args.name);
    if (!normalizedName) throw new ConvexError("Package name required");
    const pkg = await ctx.db
      .query("packages")
      .withIndex("by_name", (q) => q.eq("normalizedName", normalizedName))
      .unique();
    if (!pkg || pkg.softDeletedAt || pkg.family === "skill")
      throw new ConvexError("Package not found");

    return requestPackageRescanForActor(ctx, { actor, pkg, version: args.version });
  },
});

export const requestPackageRescan = mutation({
  args: {
    packageId: v.id("packages"),
    version: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg || pkg.softDeletedAt || pkg.family === "skill")
      throw new ConvexError("Package not found");

    return requestPackageRescanForActor(ctx, { actor: user, pkg, version: args.version });
  },
});

async function enqueueSkillVersionScan(ctx: MutationCtx, args: EnqueueSkillVersionScanArgs) {
  const version = await ctx.db.get(args.versionId);
  if (!version || version.softDeletedAt) return { ok: true as const, skipped: "missing" as const };
  const now = Date.now();
  const waitForVtUntil = now + Math.max(0, args.waitForVtMs ?? defaultVtWaitMs());
  const nextRunAt = args.waitForVtMs === 0 || version.vtAnalysis ? now : waitForVtUntil;
  const hasMaliciousSignal = false;

  const existing = await ctx.db
    .query("securityScanJobs")
    .withIndex("by_skill_version", (q) => q.eq("skillVersionId", args.versionId))
    .collect();
  const active = existing.find((job) => job.status === "queued" || job.status === "running");
  if (active) {
    if (args.preserveActiveJob) {
      return { ok: true as const, jobId: active._id, alreadyQueued: true as const };
    }
    await ctx.db.patch(active._id, {
      source: args.source,
      priority: Math.max(active.priority, args.priority ?? 0),
      hasMaliciousSignal,
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
    priority: args.priority ?? 0,
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
    return enqueuePackageReleaseScan(ctx, args);
  },
});

async function enqueuePackageReleaseScan(ctx: MutationCtx, args: EnqueuePackageReleaseScanArgs) {
  const release = await ctx.db.get(args.releaseId);
  if (!release || release.softDeletedAt) return { ok: true as const, skipped: "missing" as const };
  const now = Date.now();
  const waitForVtUntil = now + Math.max(0, args.waitForVtMs ?? DEFAULT_VT_WAIT_MS);
  const nextRunAt = args.waitForVtMs === 0 || release.vtAnalysis ? now : waitForVtUntil;
  const hasMaliciousSignal = false;

  const existing = await ctx.db
    .query("securityScanJobs")
    .withIndex("by_package_release", (q) => q.eq("packageReleaseId", args.releaseId))
    .collect();
  const active = existing.find((job) => job.status === "queued" || job.status === "running");
  if (active) {
    await ctx.db.patch(active._id, {
      source: args.source,
      priority: Math.max(active.priority, args.priority ?? 0),
      hasMaliciousSignal,
      waitForVtUntil: Math.min(active.waitForVtUntil, waitForVtUntil),
      nextRunAt: Math.min(active.nextRunAt, nextRunAt),
      updatedAt: now,
    });
    return { ok: true as const, jobId: active._id, alreadyQueued: true as const };
  }

  const jobId = await ctx.db.insert("securityScanJobs", {
    targetKind: "packageRelease",
    packageReleaseId: args.releaseId,
    status: "queued",
    source: args.source,
    priority: args.priority ?? 0,
    hasMaliciousSignal,
    waitForVtUntil,
    nextRunAt,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true as const, jobId, alreadyQueued: false as const };
}

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

export const clearQueuedBackfillJobsForLocalDev = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const localDevEnabled =
      process.env.DEV_AUTH_ENABLED === "1" ||
      process.env.SECURITY_SCAN_WORKER_TOKEN === "local-dev-worker-token";
    if (!localDevEnabled) {
      throw new ConvexError("Refusing to clear backfill scan jobs outside local dev");
    }

    const limit = Math.max(1, Math.min(args.limit ?? 1000, MAX_CANCEL_SCAN_LIMIT));
    const jobs = await ctx.db
      .query("securityScanJobs")
      .withIndex("by_status_source_created_at", (q) =>
        q.eq("status", "queued").eq("source", "backfill"),
      )
      .order("asc")
      .take(limit);

    const sampleDeletedJobIds: string[] = [];
    if (!args.dryRun) {
      for (const job of jobs) {
        await ctx.db.delete(job._id);
        if (sampleDeletedJobIds.length < CANCEL_SAMPLE_LIMIT) sampleDeletedJobIds.push(job._id);
      }
    }

    return {
      dryRun: args.dryRun === true,
      matched: jobs.length,
      deleted: args.dryRun ? 0 : jobs.length,
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

    const expiredRunning = await ctx.db
      .query("securityScanJobs")
      .withIndex("by_status_and_lease_expires_at", (q) =>
        q.eq("status", "running").lte("leaseExpiresAt", now),
      )
      .take(MAX_EXPIRED_CODEX_SCAN_LEASE_REQUEUES);
    for (const job of expiredRunning) {
      await ctx.db.patch(job._id, {
        status: "queued",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        workerId: undefined,
        nextRunAt: now,
        updatedAt: now,
      });
    }
    const capacity = limit;

    const ready: Doc<"securityScanJobs">[] = [];
    const claimedIds = new Set<Id<"securityScanJobs">>();
    const remainingCapacity = () => capacity - ready.length;
    const addReadyJobs = (jobs: Doc<"securityScanJobs">[]) => {
      for (const job of jobs) {
        if (remainingCapacity() === 0) break;
        if (claimedIds.has(job._id) || job.nextRunAt > now) continue;
        claimedIds.add(job._id);
        ready.push(job);
      }
    };
    const takeReadySourceJobs = async (source: SecurityScanJobSource) => {
      if (remainingCapacity() === 0) return [];
      return await ctx.db
        .query("securityScanJobs")
        .withIndex("by_status_source_next_run_at", (q) =>
          q.eq("status", "queued").eq("source", source).lte("nextRunAt", now),
        )
        .order("asc")
        .take(remainingCapacity());
    };

    addReadyJobs(await takeReadySourceJobs("manual"));

    if (remainingCapacity() > 0) {
      addReadyJobs(
        await ctx.db
          .query("securityScanJobs")
          .withIndex("by_status_malicious_signal_next_run_at", (q) =>
            q.eq("status", "queued").eq("hasMaliciousSignal", true).lte("nextRunAt", now),
          )
          .order("asc")
          .take(remainingCapacity()),
      );
    }

    for (const source of CLAIM_SOURCE_ORDER) {
      addReadyJobs(await takeReadySourceJobs(source));
      if (remainingCapacity() === 0) break;
    }

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
      if (job.targetKind === "skillScanRequest" && job.skillScanRequestId) {
        await ctx.db.patch(job.skillScanRequestId, {
          status: "running",
          lastError: undefined,
          updatedAt: now,
        });
      }
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
    if (job.targetKind === "skillScanRequest" && job.skillScanRequestId) {
      const scanRequest = await ctx.db.get(job.skillScanRequestId);
      if (!scanRequest) return { job, missing: true as const };
      const version = scanRequest.skillVersionId
        ? await ctx.db.get(scanRequest.skillVersionId)
        : null;
      const skill = scanRequest.skillId ? await ctx.db.get(scanRequest.skillId) : null;
      const githubScan = scanRequest.githubSkillScanId
        ? await ctx.db.get(scanRequest.githubSkillScanId)
        : null;
      let scanRequestFiles = scanRequest.files;
      if (scanRequest.sourceKind === "github") {
        const chunks = await ctx.db
          .query("skillScanRequestFileChunks")
          .withIndex("by_skill_scan_request_id_and_chunk_index", (q) =>
            q.eq("skillScanRequestId", scanRequest._id),
          )
          .take(MAX_SKILL_SCAN_REQUEST_FILE_CHUNKS + 1);
        const manifestBytes = chunks.reduce(
          (total, chunk) => total + serializedSkillScanRequestFilesBytes(chunk.files),
          0,
        );
        const declaredChunkCount = scanRequest.fileChunkCount ?? chunks.length;
        if (
          chunks.length > MAX_SKILL_SCAN_REQUEST_FILE_CHUNKS ||
          chunks.length !== declaredChunkCount ||
          manifestBytes > MAX_SKILL_SCAN_REQUEST_MANIFEST_BYTES ||
          (scanRequest.fileManifestBytes !== undefined &&
            manifestBytes !== scanRequest.fileManifestBytes)
        ) {
          return { job, missing: true as const };
        }
        scanRequestFiles = chunks.flatMap((chunk) => chunk.files);
      }
      return {
        job,
        skill,
        version: version ?? undefined,
        scanRequest,
        scanRequestFiles,
        githubScan: githubScan ?? undefined,
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
    if (job.targetKind === "skillScanRequest" && job.skillScanRequestId) {
      await ctx.db.patch(job.skillScanRequestId, {
        status: retry ? "queued" : "failed",
        lastError: args.error.slice(0, 2000),
        ...(retry ? {} : { completedAt: now }),
        updatedAt: now,
      });
    }
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
        // Hydrated jobs contain signed URLs, so claim one at a time to stay below action limits.
        limit: Math.min(normalizeLimit(args.limit), 1),
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

      const scanRequest = target.scanRequest as Doc<"skillScanRequests"> | undefined;
      const version = target.version as Doc<"skillVersions"> | undefined;
      const release = target.release as Doc<"packageReleases"> | undefined;
      let files: Array<{
        path: string;
        size: number;
        sha256: string;
        storageId: Id<"_storage">;
        contentType?: string;
      }> = [];
      if (scanRequest) {
        files =
          (target.scanRequestFiles as Doc<"skillScanRequests">["files"] | undefined) ??
          scanRequest.files;
      } else if (version) {
        const fingerprintEntries = await runQueryRef<
          Array<{ fingerprint: string; kind?: "source" | "generated-bundle" }>
        >(ctx, internalRefs.skills.listVersionFingerprintsInternal, {
          skillVersionId: version._id,
        });
        files = sourceSkillVersionFiles(version.files, {
          generatedBundleFingerprints: fingerprintEntries
            .filter((entry) => entry.kind === "generated-bundle")
            .map((entry) => entry.fingerprint),
        });
      } else if (release) {
        files = release.files;
      }
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
    skillSpectorAnalysis: v.optional(skillSpectorAnalysisValidator),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertWorkerToken(args.token);
    const target = await runQueryRef<JobTarget | null>(
      ctx,
      internalRefs.securityScan.getJobTargetInternal,
      {
        jobId: args.jobId,
      },
    );
    if (!target) throw new ConvexError("Job not found");
    if (target.job.leaseToken !== args.leaseToken) throw new ConvexError("Lease mismatch");

    if (target.job.targetKind === "skillVersion" && target.version) {
      if (args.skillSpectorAnalysis) {
        await runMutationRef(ctx, internalRefs.skills.updateVersionSkillSpectorAnalysisInternal, {
          versionId: target.version._id,
          skillSpectorAnalysis: capSkillSpectorAnalysisForStorage(args.skillSpectorAnalysis),
        });
      }
      await runMutationRef(ctx, internalRefs.skills.updateVersionLlmAnalysisInternal, {
        versionId: target.version._id,
        llmAnalysis: args.llmAnalysis,
      });
    } else if (target.job.targetKind === "packageRelease" && target.release) {
      if (args.skillSpectorAnalysis) {
        await runMutationRef(ctx, internalRefs.packages.updateReleaseSkillSpectorAnalysisInternal, {
          releaseId: target.release._id,
          skillSpectorAnalysis: capSkillSpectorAnalysisForStorage(args.skillSpectorAnalysis),
        });
      }
      await runMutationRef(ctx, internalRefs.packages.updateReleaseLlmAnalysisInternal, {
        releaseId: target.release._id,
        llmAnalysis: args.llmAnalysis,
      });
    } else if (target.job.targetKind === "skillScanRequest" && target.scanRequest) {
      let writtenBack = false;
      if (
        target.scanRequest.sourceKind === "published" &&
        target.scanRequest.update &&
        target.version
      ) {
        if (args.skillSpectorAnalysis) {
          await runMutationRef(ctx, internalRefs.skills.updateVersionSkillSpectorAnalysisInternal, {
            versionId: target.version._id,
            skillSpectorAnalysis: capSkillSpectorAnalysisForStorage(args.skillSpectorAnalysis),
          });
        }
        await runMutationRef(ctx, internalRefs.skills.updateVersionLlmAnalysisInternal, {
          versionId: target.version._id,
          llmAnalysis: args.llmAnalysis,
        });
        writtenBack = true;
      }
      const skillSpectorAnalysis = args.skillSpectorAnalysis
        ? capSkillSpectorAnalysisForStorage(args.skillSpectorAnalysis)
        : undefined;
      if (target.scanRequest.sourceKind === "github" && target.githubScan) {
        await runMutationRef(ctx, internalRefs.securityScan.recordGitHubSkillScanResultInternal, {
          githubSkillScanId: target.githubScan._id,
          scanStatus: githubSkillScanStatusFromLlmAnalysis(args.llmAnalysis),
          llmAnalysis: args.llmAnalysis,
          skillSpectorAnalysis,
          runId: args.runId,
        });
        writtenBack = true;
      }
      await runMutationRef(ctx, internalRefs.securityScan.recordSkillScanRequestSucceededInternal, {
        scanId: target.scanRequest._id,
        jobId: args.jobId,
        runId: args.runId,
        llmAnalysis: args.llmAnalysis,
        skillSpectorAnalysis,
        writtenBack,
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
    const result = await runMutationRef<{ ok: true; retry: boolean }>(
      ctx,
      internalRefs.securityScan.failJobInternal,
      {
        jobId: args.jobId,
        leaseToken: args.leaseToken,
        error: args.error,
      },
    );

    if (!result.retry) {
      const target = await runQueryRef<JobTarget | null>(
        ctx,
        internalRefs.securityScan.getJobTargetInternal,
        {
          jobId: args.jobId,
        },
      );
      if (target && !target.missing) {
        const llmAnalysis = buildWorkerFailureLlmAnalysis(args.error);
        if (target.job.targetKind === "skillVersion" && target.version) {
          if (!hasArtifactBackedLlmAnalysis(target.version.llmAnalysis)) {
            await runMutationRef(ctx, internalRefs.skills.updateVersionLlmAnalysisInternal, {
              versionId: target.version._id,
              moderationMode: "preserve",
              llmAnalysis,
            });
          }
        } else if (target.job.targetKind === "packageRelease" && target.release) {
          if (!hasArtifactBackedLlmAnalysis(target.release.llmAnalysis)) {
            await runMutationRef(ctx, internalRefs.packages.updateReleaseLlmAnalysisInternal, {
              releaseId: target.release._id,
              llmAnalysis,
            });
          }
        } else if (target.job.targetKind === "skillScanRequest" && target.scanRequest) {
          if (target.scanRequest.sourceKind === "github" && target.githubScan) {
            await runMutationRef(
              ctx,
              internalRefs.securityScan.recordGitHubSkillScanResultInternal,
              {
                githubSkillScanId: target.githubScan._id,
                scanStatus: "failed",
                error: args.error,
                llmAnalysis,
              },
            );
          }
          await runMutationRef(
            ctx,
            internalRefs.securityScan.recordSkillScanRequestFailedInternal,
            {
              scanId: target.scanRequest._id,
              error: args.error,
              llmAnalysis,
            },
          );
        }
      }
    }

    return result;
  },
});
