import { ConvexError, v } from "convex/values";
import { unzipSync, type UnzipFileInfo } from "fflate";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery } from "./functions";
import { assertAdmin, requireUserFromAction } from "./lib/access";
import { decodeBoundedUtf8Text } from "./lib/artifactText";
import { buildGitHubApiHeaders } from "./lib/githubAuth";
import { getGitHubProviderAccountId } from "./lib/githubIdentity";
import {
  fetchGitHubZipBytes,
  type GitHubImportUrl,
  resolveGitHubCommit,
  stripGitHubZipRoot,
} from "./lib/githubImport";
import { GITHUB_ORG_MEMBERSHIP_VERIFICATION_MAX_AGE_MS } from "./lib/githubOrgMemberships";
import {
  buildGitHubSkillSourceSnapshot,
  buildGitHubSkillSyncPlan,
  type DiscoveredGitHubSkill,
  type DisplayManifestStatus,
  githubBackedSkillModeration,
  type GitHubSkillScanStatus,
  type GitHubSkillSourceMetadataSnapshot,
  type GitHubSkillSourceSnapshot,
} from "./lib/githubSkillSync";
import { adjustGlobalPublicSkillsCount, getPublicSkillVisibilityDelta } from "./lib/globalStats";
import { runStaticModerationScan } from "./lib/moderationEngine";
import { Events, logErrorEvent, logEvent } from "./lib/observabilityEvents";
import { requirePublisherRole } from "./lib/publishers";
import {
  assertGenericGitHubSkillSyncEnabled,
  assertGitHubSkillSyncRuntimeEnabled,
  getRuntimeRolloutCapabilities,
  isLegacyNvidiaSkillSource,
} from "./lib/rolloutCapabilities";
import { buildSkillPresentationIconPath } from "./lib/skillPresentation";
import { isMacJunkPath, parseFrontmatter } from "./lib/skills";
import {
  getSkillBySlugForPublisher,
  getSkillSlugAliasBySlugForPublisher,
} from "./lib/skills/slugResolution";
import { chunkSkillScanRequestFiles } from "./lib/skillScanRequestFiles";
import { syncSkillSearchDigestForSkill } from "./lib/skillSearchDigest";
import { assertValidSkillSlug } from "./lib/skillSlugValidator";
import { getSkillsShFixtureEnvironmentPolicy } from "./lib/skillsShCatalogEnvironment";
import {
  isDecodableSkillPresentationRaster,
  storeSkillPresentationAsset,
} from "./skillPresentationAssets";

const DEFAULT_BRANCH = "main";
const GITHUB_SKILL_SCAN_ACTION_LEASE_MS = 15 * 60 * 1000;
const PUBLIC_REPO_ONLY_ERROR = "Enter a public GitHub repo.";
const MAX_UNZIPPED_BYTES = 80 * 1024 * 1024;
const MAX_FILE_COUNT = 7_500;
const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_STATIC_SCAN_TEXT_FILES = 200;
const MAX_STATIC_SCAN_TEXT_FILE_BYTES = 256 * 1024;
const DEFAULT_SOURCE_SYNC_BATCH_SIZE = 20;
const MAX_SOURCE_SYNC_BATCH_SIZE = 50;

type SourceForSync = Pick<
  Doc<"githubSkillSources">,
  | "_id"
  | "repo"
  | "ownerPublisherId"
  | "githubRepositoryId"
  | "githubOwnerId"
  | "defaultBranch"
  | "updatedAt"
>;

type SourceForSyncPage = {
  sources: SourceForSync[];
  continueCursor: string | null;
  isDone: boolean;
};

export type SyncOneResult = {
  ok: true;
  skipped?: "stale-source-observation";
  repo: string;
  sourceId?: Id<"githubSkillSources">;
  commit: string;
  manifestStatus: DisplayManifestStatus;
  issues?: GitHubSkillSourceSyncIssue[];
  invalidSkills?: Array<{
    slug: string;
    path: string;
    displayName: string;
    error: string;
  }>;
  stats: {
    discovered: number;
    inserted: number;
    changed: number;
    unchanged: number;
    removed: number;
    conflicts: number;
    invalid: number;
    revived: number;
  };
  claim?: {
    phase: "first-claim" | "native-followup";
    attempt: number;
    skillId: Id<"skills">;
  };
};

type GitHubSkillSourceSyncIssue = {
  slug: string;
  path: string;
  displayName: string;
  kind: "invalid_slug" | "slug_conflict";
  severity: "error" | "warning";
  message: string;
  existingOwnerHandle?: string;
};

type SyncManyResult = {
  ok: true;
  synced: number;
  skipped: number;
  errors: number;
  cursor: string | null;
  isDone: boolean;
  scheduledNext: boolean;
  results: SyncOneResult[];
};

type SyncDryRunResult = {
  ok: true;
  dryRun: true;
  repo: string;
  sourceId?: Id<"githubSkillSources">;
  commit: string;
  manifestStatus: DisplayManifestStatus;
  discovered: number;
};

type GitHubRepoMetadata = {
  repositoryId?: string;
  ownerId?: string;
  repo: string;
  defaultBranch: string;
};

type GitHubSkillSourceSetupContext = {
  ownerUserId: Id<"users">;
  existingSource: SourceForSync | null;
};

type ExpectedSkillsShSource = {
  repo: string;
  externalId: string;
  path: string;
  commit: string;
  contentHash: string;
};

type GitHubSkillVerificationTarget = {
  skill: Pick<Doc<"skills">, "_id" | "slug" | "displayName" | "summary"> & {
    githubPath: string;
    githubCurrentCommit: string;
    githubCurrentContentHash: string;
    githubCurrentStatus: "present";
  };
  source: Pick<Doc<"githubSkillSources">, "_id" | "repo" | "defaultBranch">;
  candidateId?: Id<"githubSkillCandidates">;
};

type GitHubSkillVerificationResult = {
  ok: true;
  prepared?: true;
  queued?: true;
  reused?: true;
  alreadyQueued?: true;
  skipped?: string;
  scanStatus?: GitHubSkillScanStatus;
  scanId?: Id<"githubSkillScans">;
  requestId?: Id<"skillScanRequests">;
  jobId?: Id<"securityScanJobs">;
  currentContentHash?: string;
};

type GitHubSkillContentTarget = {
  skillId: Id<"skills">;
  githubPath: string;
  githubCurrentContentHash: string;
  candidateId?: Id<"githubSkillCandidates">;
};

const displayManifestStatusValidator = v.union(
  v.literal("ok"),
  v.literal("missing"),
  v.literal("invalid"),
  v.literal("failed"),
);

function clampInt(value: number, min: number, max: number) {
  const finite = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.min(max, Math.max(min, finite));
}

const displayManifestValidator = v.object({
  notGrouped: v.optional(v.union(v.literal("top"), v.literal("bottom"))),
  groupings: v.array(
    v.object({
      title: v.string(),
      description: v.optional(v.string()),
      skills: v.array(v.string()),
    }),
  ),
});

const discoveredSkillMetadataValidator = v.object({
  slug: v.string(),
  displayName: v.string(),
  summary: v.optional(v.string()),
  upstreamVersion: v.optional(v.string()),
  path: v.string(),
  skillMarkdownPath: v.string(),
  skillCardMarkdownPath: v.optional(v.string()),
  iconAsset: v.optional(
    v.object({
      path: v.string(),
      sha256: v.string(),
      contentType: v.string(),
      size: v.number(),
    }),
  ),
  contentHash: v.string(),
});

const discoveredSkillContentValidator = v.object({
  slug: v.string(),
  displayName: v.string(),
  summary: v.optional(v.string()),
  upstreamVersion: v.optional(v.string()),
  path: v.string(),
  skillMarkdownPath: v.string(),
  skillMarkdown: v.string(),
  skillCardMarkdownPath: v.optional(v.string()),
  skillCardMarkdown: v.optional(v.string()),
  iconAsset: v.optional(
    v.object({
      path: v.string(),
      sha256: v.string(),
      contentType: v.string(),
      size: v.number(),
    }),
  ),
  contentHash: v.string(),
});

export const sourceSnapshotValidator = v.object({
  repo: v.string(),
  defaultBranch: v.string(),
  commit: v.string(),
  manifestStatus: displayManifestStatusValidator,
  manifestHash: v.optional(v.string()),
  manifest: v.optional(displayManifestValidator),
  skills: v.array(discoveredSkillMetadataValidator),
});

const githubSkillScanStatusValidator = v.union(
  v.literal("clean"),
  v.literal("suspicious"),
  v.literal("malicious"),
  v.literal("pending"),
  v.literal("failed"),
);

export async function getArchiveScanBySkillAndContentHashHandler(
  ctx: QueryCtx,
  args: { skillId: Id<"skills">; commit: string; contentHash: string },
) {
  const skill = await ctx.db.get(args.skillId);
  if (!skill) return null;
  const candidates = await ctx.db
    .query("githubSkillCandidates")
    .withIndex("by_skill_and_commit_and_content_hash", (q) =>
      q
        .eq("skillId", args.skillId)
        .eq("githubCommit", args.commit)
        .eq("githubContentHash", args.contentHash),
    )
    .collect();
  const eligibleCandidates = candidates.filter(
    (candidate) =>
      (candidate.lifecycleStatus === "promoted" ||
        candidate.lifecycleStatus === "superseded" ||
        candidate.lifecycleStatus === "rolled_back") &&
      (candidate.scanStatus === "clean" || candidate.scanStatus === "suspicious") &&
      candidate.verdictSourceScanId,
  );
  const preferredCandidate =
    eligibleCandidates.find((candidate) => candidate._id === skill.githubCurrentCandidateId) ??
    eligibleCandidates
      .slice()
      .sort(
        (a, b) =>
          (b.promotedAt ?? b.updatedAt) - (a.promotedAt ?? a.updatedAt) ||
          b._creationTime - a._creationTime ||
          String(b._id).localeCompare(String(a._id)),
      )[0] ??
    null;
  if (preferredCandidate?.verdictSourceScanId) {
    const [scan, source] = await Promise.all([
      ctx.db.get(preferredCandidate.verdictSourceScanId),
      ctx.db.get(preferredCandidate.githubSourceId),
    ]);
    if (
      scan &&
      source &&
      scan.skillId === skill._id &&
      scan.contentHash === preferredCandidate.githubContentHash &&
      scan.status === preferredCandidate.scanStatus
    ) {
      return {
        githubSourceId: preferredCandidate.githubSourceId,
        repo: preferredCandidate.githubRepo ?? source.repo,
        contentHash: preferredCandidate.githubContentHash,
        commit: preferredCandidate.githubCommit,
        path: preferredCandidate.githubPath,
        status: scan.status,
      };
    }
  }

  if (
    skill.installKind !== "github" ||
    skill.githubCurrentCommit !== args.commit ||
    skill.githubCurrentContentHash !== args.contentHash ||
    !skill.githubSourceId ||
    !skill.githubPath ||
    (skill.githubScanStatus !== "clean" && skill.githubScanStatus !== "suspicious")
  ) {
    return null;
  }
  const source = await ctx.db.get(skill.githubSourceId);
  if (!source) return null;
  const scans = await ctx.db
    .query("githubSkillScans")
    .withIndex("by_skill_and_content_hash", (q) =>
      q.eq("skillId", skill._id).eq("contentHash", args.contentHash),
    )
    .collect();
  const scan = scans.find((candidateScan) => candidateScan.status === skill.githubScanStatus);
  if (!scan) return null;
  return {
    githubSourceId: skill.githubSourceId,
    repo: skill.githubCurrentRepo ?? source.repo,
    contentHash: skill.githubCurrentContentHash,
    commit: skill.githubCurrentCommit,
    path: skill.githubPath,
    status: scan.status,
  };
}

export const getArchiveScanBySkillAndContentHashInternal = internalQuery({
  args: {
    skillId: v.id("skills"),
    commit: v.string(),
    contentHash: v.string(),
  },
  handler: getArchiveScanBySkillAndContentHashHandler,
});

export const getSourceByRepoInternal = internalQuery({
  args: { repo: v.string() },
  handler: async (ctx, args): Promise<SourceForSync | null> => {
    const repo = normalizeRepo(args.repo);
    return await ctx.db
      .query("githubSkillSources")
      .withIndex("by_repo", (q) => q.eq("repo", repo))
      .unique();
  },
});

export const listSourcesForSyncInternal = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    legacyOnly: v.optional(v.boolean()),
  },
  handler: listSourcesForSyncHandler,
});

export async function listSourcesForSyncHandler(
  ctx: QueryCtx,
  args: { cursor?: string | null; batchSize?: number; legacyOnly?: boolean },
): Promise<SourceForSyncPage> {
  if (args.legacyOnly) {
    const source = await ctx.db
      .query("githubSkillSources")
      .withIndex("by_repo", (q) => q.eq("repo", "NVIDIA/skills"))
      .unique();
    return {
      sources: source ? [source] : [],
      continueCursor: null,
      isDone: true,
    };
  }
  const batchSize = clampInt(
    args.batchSize ?? DEFAULT_SOURCE_SYNC_BATCH_SIZE,
    1,
    MAX_SOURCE_SYNC_BATCH_SIZE,
  );
  const { page, continueCursor, isDone } = await ctx.db
    .query("githubSkillSources")
    .withIndex("by_created")
    .order("asc")
    .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
  return { sources: page, continueCursor, isDone };
}

export const listGitHubSkillContentTargetsInternal = internalQuery({
  args: { sourceId: v.id("githubSkillSources") },
  handler: async (ctx, args): Promise<GitHubSkillContentTarget[]> => {
    const [skills, pendingCandidates, legacyCandidates] = await Promise.all([
      ctx.db
        .query("skills")
        .withIndex("by_github_source", (q) => q.eq("githubSourceId", args.sourceId))
        .collect(),
      ctx.db
        .query("githubSkillCandidates")
        .withIndex("by_github_source_and_lifecycle_status", (q) =>
          q.eq("githubSourceId", args.sourceId).eq("lifecycleStatus", "pending"),
        )
        .collect(),
      ctx.db
        .query("githubSkillCandidates")
        .withIndex("by_github_source_and_lifecycle_status", (q) =>
          q.eq("githubSourceId", args.sourceId).eq("lifecycleStatus", undefined),
        )
        .collect(),
    ]);
    const candidates = [...pendingCandidates, ...legacyCandidates];
    const currentTargets = skills.flatMap((skill) => {
      if (
        skill.installKind !== "github" ||
        skill.githubCurrentStatus !== "present" ||
        !skill.githubPath ||
        !skill.githubCurrentContentHash
      ) {
        return [];
      }
      return [
        {
          skillId: skill._id,
          githubPath: skill.githubPath,
          githubCurrentContentHash: skill.githubCurrentContentHash,
        },
      ];
    });
    const pendingCandidateIds = new Set(
      skills.flatMap((skill) =>
        skill.githubPendingCandidateId ? [skill.githubPendingCandidateId] : [],
      ),
    );
    const candidateTargets = candidates.flatMap((candidate) =>
      pendingCandidateIds.has(candidate._id) &&
      (candidate.lifecycleStatus === undefined || candidate.lifecycleStatus === "pending")
        ? [
            {
              skillId: candidate.skillId,
              githubPath: candidate.githubPath,
              githubCurrentContentHash: candidate.githubContentHash,
              candidateId: candidate._id,
            },
          ]
        : [],
    );
    return [...currentTargets, ...candidateTargets];
  },
});

export async function resolveOwnerUserIdForPublisherHandler(
  ctx: QueryCtx,
  args: { publisherId: Id<"publishers"> },
) {
  return resolveOwnerUserIdForPublisher(ctx, args.publisherId);
}

export const resolveOwnerUserIdForPublisherInternal = internalQuery({
  args: { publisherId: v.id("publishers") },
  handler: resolveOwnerUserIdForPublisherHandler,
});

export const getPublicGitHubSkillSourceSetupContextInternal = internalQuery({
  args: {
    ownerPublisherId: v.id("publishers"),
    actorUserId: v.id("users"),
    repo: v.string(),
    githubRepositoryId: v.string(),
    githubOwnerId: v.string(),
  },
  handler: async (ctx, args): Promise<GitHubSkillSourceSetupContext> => {
    const { publisher } = await requirePublisherRole(ctx, {
      publisherId: args.ownerPublisherId,
      userId: args.actorUserId,
      allowed: ["admin"],
    });
    if (publisher.kind === "user") {
      if (publisher.linkedUserId !== args.actorUserId) throw new ConvexError("Forbidden");
      const providerId = normalizeGitHubNumericId(
        await getGitHubProviderAccountId(ctx, args.actorUserId),
      );
      if (!providerId || providerId !== args.githubOwnerId) {
        throw new ConvexError("Repository ownership does not match the selected publisher.");
      }
    } else {
      const publisherOwnerId = normalizeGitHubNumericId(publisher.githubOrgId);
      if (
        !publisherOwnerId ||
        !publisher.githubVerifiedAt ||
        publisherOwnerId !== args.githubOwnerId
      ) {
        throw new ConvexError("Repository ownership does not match the selected publisher.");
      }
      const membership = await ctx.db
        .query("githubOrgMemberships")
        .withIndex("by_user_and_github_org", (q) =>
          q.eq("userId", args.actorUserId).eq("githubOrgId", publisherOwnerId),
        )
        .unique();
      if (
        !membership ||
        membership.role !== "admin" ||
        Date.now() - membership.syncedAt > GITHUB_ORG_MEMBERSHIP_VERIFICATION_MAX_AGE_MS
      ) {
        throw new ConvexError("Reconnect GitHub to verify current organization admin access.");
      }
    }
    const repo = normalizeRepo(args.repo);
    const sourceByRepo = await ctx.db
      .query("githubSkillSources")
      .withIndex("by_repo", (q) => q.eq("repo", repo))
      .unique();
    const sourceByRepositoryId = await ctx.db
      .query("githubSkillSources")
      .withIndex("by_github_repository_id", (q) =>
        q.eq("githubRepositoryId", args.githubRepositoryId),
      )
      .unique();
    if (sourceByRepo && sourceByRepositoryId && sourceByRepo._id !== sourceByRepositoryId._id) {
      throw new ConvexError("GitHub repository identity conflicts with an existing source.");
    }
    const existingSource = sourceByRepositoryId ?? sourceByRepo;
    if (
      existingSource?.ownerPublisherId &&
      existingSource.ownerPublisherId !== args.ownerPublisherId
    ) {
      throw new ConvexError("GitHub repo is already configured for another publisher.");
    }
    const ownerUserId = await resolveOwnerUserIdForPublisher(ctx, args.ownerPublisherId);
    return { ownerUserId, existingSource };
  },
});

export async function recordGitHubSkillSourceSyncAttemptHandler(
  ctx: MutationCtx,
  args: {
    sourceId: Id<"githubSkillSources">;
    status?: "failed" | "skipped";
    error?: string;
    now?: number;
  },
) {
  const source = await ctx.db.get(args.sourceId);
  if (!source) return { ok: true as const, skipped: "missing-source" as const };
  const now = args.now ?? Date.now();
  const status = args.status ?? "skipped";
  await ctx.db.patch(args.sourceId, {
    updatedAt: now,
    lastSyncStatus: status,
    lastSyncError: status === "failed" ? args.error : undefined,
    lastSyncErrorAt: status === "failed" ? now : undefined,
  });
  return { ok: true as const };
}

export const recordGitHubSkillSourceSyncAttemptInternal = internalMutation({
  args: {
    sourceId: v.id("githubSkillSources"),
    status: v.optional(v.union(v.literal("failed"), v.literal("skipped"))),
    error: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: recordGitHubSkillSourceSyncAttemptHandler,
});

async function cancelPendingGitHubSkillCandidate(
  ctx: MutationCtx,
  candidateId: Id<"githubSkillCandidates"> | undefined,
  now: number,
  reason: string,
) {
  if (!candidateId) return;
  const candidate = await ctx.db.get(candidateId);
  if (!candidate) return;
  await ctx.db.patch(candidate._id, {
    lifecycleStatus: "canceled",
    canceledAt: now,
    cancellationReason: reason,
    updatedAt: now,
  });
}

export async function revokeGitHubSkillSourceAuthorizationHandler(
  ctx: MutationCtx,
  args: { sourceId: Id<"githubSkillSources">; error: string; now?: number },
) {
  const source = await ctx.db.get(args.sourceId);
  if (!source || isLegacyNvidiaSkillSource(source.repo)) {
    return { ok: true as const, skipped: "missing-or-legacy-source" as const };
  }
  const now = args.now ?? Date.now();
  const [pendingCandidates, failedCandidates, legacyCandidates] = await Promise.all([
    ctx.db
      .query("githubSkillCandidates")
      .withIndex("by_github_source_and_lifecycle_status", (q) =>
        q.eq("githubSourceId", source._id).eq("lifecycleStatus", "pending"),
      )
      .collect(),
    ctx.db
      .query("githubSkillCandidates")
      .withIndex("by_github_source_and_lifecycle_status", (q) =>
        q.eq("githubSourceId", source._id).eq("lifecycleStatus", "failed"),
      )
      .collect(),
    ctx.db
      .query("githubSkillCandidates")
      .withIndex("by_github_source_and_lifecycle_status", (q) =>
        q.eq("githubSourceId", source._id).eq("lifecycleStatus", undefined),
      )
      .collect(),
  ]);
  const candidates = [...pendingCandidates, ...failedCandidates, ...legacyCandidates];
  for (const candidate of candidates) {
    const skill = await ctx.db.get(candidate.skillId);
    if (skill?.githubPendingCandidateId === candidate._id) {
      await ctx.db.patch(skill._id, {
        githubPendingCandidateId: undefined,
        updatedAt: now,
      });
      await cancelPendingGitHubSkillCandidate(
        ctx,
        candidate._id,
        now,
        "github.authorization.revoked",
      );
    }
  }

  const skills = await ctx.db
    .query("skills")
    .withIndex("by_github_source", (q) => q.eq("githubSourceId", source._id))
    .collect();
  let blockedSkills = 0;
  for (const skill of skills) {
    if (skill.installKind !== "github") continue;
    const previousSkill = { ...skill };
    const removedAt = skill.githubRemovedAt ?? now;
    const patch = {
      githubCurrentStatus: "missing" as const,
      githubCurrentCheckedAt: now,
      githubRemovedAt: removedAt,
      githubPendingCandidateId: undefined,
      softDeletedAt: skill.softDeletedAt ?? removedAt,
      moderationStatus: "hidden" as const,
      moderationReason: "github.authorization.revoked",
      moderationVerdict: undefined,
      moderationFlags: [],
      isSuspicious: false,
      updatedAt: now,
    };
    await ctx.db.patch(skill._id, patch);
    const nextSkill = { ...previousSkill, ...patch };
    await syncSkillSearchDigestForSkill(ctx, nextSkill);
    await adjustGlobalPublicCountForSkillChange(ctx, previousSkill, nextSkill, now);
    blockedSkills += 1;
  }

  await ctx.db.patch(source._id, {
    authorizationStatus: "revoked",
    authorizationCheckedAt: now,
    authorizationError: args.error,
    lastSyncStatus: "failed",
    lastSyncError: args.error,
    lastSyncErrorAt: now,
    updatedAt: now,
  });
  return { ok: true as const, revoked: true as const, blockedSkills };
}

export const revokeGitHubSkillSourceAuthorizationInternal = internalMutation({
  args: {
    sourceId: v.id("githubSkillSources"),
    error: v.string(),
    now: v.optional(v.number()),
  },
  handler: revokeGitHubSkillSourceAuthorizationHandler,
});

export const getGitHubSkillVerificationTargetInternal = internalQuery({
  args: { skillId: v.id("skills"), contentHash: v.string() },
  handler: async (ctx, args): Promise<GitHubSkillVerificationTarget | null> => {
    const skill = await ctx.db.get(args.skillId);
    if (!skill) return null;
    const candidate = skill.githubPendingCandidateId
      ? await ctx.db.get(skill.githubPendingCandidateId)
      : null;
    const exact =
      candidate?.githubContentHash === args.contentHash
        ? {
            sourceId: candidate.githubSourceId,
            path: candidate.githubPath,
            commit: candidate.githubCommit,
            contentHash: candidate.githubContentHash,
            candidateId: candidate._id,
          }
        : skill.installKind === "github" &&
            skill.githubCurrentStatus === "present" &&
            skill.githubCurrentCommit &&
            skill.githubCurrentContentHash === args.contentHash &&
            skill.githubSourceId &&
            skill.githubPath
          ? {
              sourceId: skill.githubSourceId,
              path: skill.githubPath,
              commit: skill.githubCurrentCommit,
              contentHash: skill.githubCurrentContentHash,
            }
          : null;
    if (!exact) return null;
    const source = await ctx.db.get(exact.sourceId);
    if (!source) return null;
    return {
      skill: {
        _id: skill._id,
        slug: skill.slug,
        displayName: skill.displayName,
        summary: skill.summary,
        githubPath: exact.path,
        githubCurrentCommit: exact.commit,
        githubCurrentContentHash: exact.contentHash,
        githubCurrentStatus: "present",
      },
      source: {
        _id: source._id,
        repo: exact.candidateId
          ? (candidate?.githubRepo ?? source.repo)
          : (skill.githubCurrentRepo ?? source.repo),
        defaultBranch: source.defaultBranch,
      },
      ...(exact.candidateId ? { candidateId: exact.candidateId } : {}),
    };
  },
});

export type ApplyGitHubSkillSourceSyncArgs = {
  sourceId?: Id<"githubSkillSources">;
  repo: string;
  ownerUserId: Id<"users">;
  ownerPublisherId?: Id<"publishers">;
  githubRepositoryId?: string;
  githubOwnerId?: string;
  expectedSourceUpdatedAt?: number | null;
  skillsShClaimPath?: string;
  snapshot: GitHubSkillSourceMetadataSnapshot;
  now?: number;
};

export async function applyGitHubSkillSourceSyncHandler(
  ctx: MutationCtx,
  args: ApplyGitHubSkillSourceSyncArgs,
): Promise<SyncOneResult> {
  const now = args.now ?? Date.now();
  const repo = normalizeRepo(args.repo);
  if (!isLegacyNvidiaSkillSource(repo)) {
    return await applyGenericGitHubSkillSourceSyncHandler(ctx, {
      ...args,
      repo,
      now,
    });
  }
  const existingSource = args.sourceId
    ? await ctx.db.get(args.sourceId)
    : await ctx.db
        .query("githubSkillSources")
        .withIndex("by_repo", (q) => q.eq("repo", repo))
        .unique();
  if (existingSource && existingSource.repo !== repo) {
    throw new ConvexError("GitHub source id does not match repo");
  }
  if (
    existingSource?.ownerPublisherId &&
    args.ownerPublisherId &&
    existingSource.ownerPublisherId !== args.ownerPublisherId
  ) {
    throw new ConvexError("GitHub source is already configured for another publisher");
  }

  const sourceOwnerPublisherId = args.ownerPublisherId ?? existingSource?.ownerPublisherId;
  const sourceId =
    existingSource?._id ??
    (await ctx.db.insert(
      "githubSkillSources",
      stripUndefined({
        repo,
        ownerPublisherId: sourceOwnerPublisherId,
        createdAt: now,
        updatedAt: now,
      }) as Omit<Doc<"githubSkillSources">, "_id" | "_creationTime">,
    ));

  const existingSkills = await ctx.db
    .query("skills")
    .withIndex("by_github_source", (q) => q.eq("githubSourceId", sourceId))
    .collect();
  const plan = buildGitHubSkillSyncPlan({
    sourceId,
    ownerUserId: args.ownerUserId,
    ...(sourceOwnerPublisherId ? { ownerPublisherId: sourceOwnerPublisherId } : {}),
    existingSkills: existingSkills.map((skill) => ({
      _id: skill._id,
      slug: skill.slug,
      displayName: skill.displayName,
      summary: skill.summary,
      latestVersionSummary: skill.latestVersionSummary,
      githubPath: skill.githubPath,
      githubCurrentCommit: skill.githubCurrentCommit,
      githubCurrentContentHash: skill.githubCurrentContentHash,
      githubCurrentStatus: skill.githubCurrentStatus,
      githubScanStatus: skill.githubScanStatus,
      githubRemovedAt: skill.githubRemovedAt,
      softDeletedAt: skill.softDeletedAt,
    })),
    snapshot: {
      ...args.snapshot,
      repo,
    },
    now,
  });
  const discoveredByPath = new Map(args.snapshot.skills.map((skill) => [skill.path, skill]));
  const discoveredBySlug = new Map(args.snapshot.skills.map((skill) => [skill.slug, skill]));

  await ctx.db.patch(sourceId, plan.sourcePatch);

  for (const skillPatch of plan.skillPatches) {
    const previousSkill = existingSkills.find((skill) => skill._id === skillPatch.skillId);
    const previousSkillSnapshot = previousSkill ? ({ ...previousSkill } as Doc<"skills">) : null;
    await ctx.db.patch(skillPatch.skillId as Id<"skills">, skillPatch.patch);
    if (previousSkillSnapshot) {
      const nextSkillSnapshot = {
        ...previousSkillSnapshot,
        ...skillPatch.patch,
      };
      await syncSkillSearchDigestForSkill(ctx, nextSkillSnapshot);
      await adjustGlobalPublicCountForSkillChange(
        ctx,
        previousSkillSnapshot,
        nextSkillSnapshot,
        now,
      );
    }
    const githubPath =
      typeof skillPatch.patch.githubPath === "string" ? skillPatch.patch.githubPath : undefined;
    const discovered =
      (githubPath ? discoveredByPath.get(githubPath) : undefined) ??
      discoveredBySlug.get(skillPatch.slug);
    if (discovered && skillPatch.patch.githubCurrentStatus !== "missing") {
      if (hasGitHubSkillContent(discovered)) {
        await upsertGitHubSkillContent(ctx, {
          skillId: skillPatch.skillId as Id<"skills">,
          sourceId,
          discovered,
          commit: args.snapshot.commit,
          now,
        });
      }
      await scheduleGitHubSkillVerification(ctx, {
        skillId: skillPatch.skillId as Id<"skills">,
        contentHash: discovered.contentHash,
        scanStatus: skillPatch.patch.githubScanStatus,
        now,
      });
    }
  }

  let inserted = 0;
  let conflicts = 0;
  let invalid = 0;
  let revived = 0;
  const invalidSkills: NonNullable<SyncOneResult["invalidSkills"]> = [];
  const issues: GitHubSkillSourceSyncIssue[] = [];
  for (const skillInsert of plan.skillInserts) {
    try {
      assertValidSkillSlug(skillInsert.slug);
    } catch (error) {
      invalid += 1;
      const discovered = discoveredBySlug.get(skillInsert.slug);
      const path =
        discovered?.path ??
        (typeof skillInsert.doc.githubPath === "string"
          ? skillInsert.doc.githubPath
          : skillInsert.slug);
      const displayName =
        typeof skillInsert.doc.displayName === "string"
          ? skillInsert.doc.displayName
          : skillInsert.slug;
      const message = getErrorMessage(error);
      invalidSkills.push({
        slug: skillInsert.slug,
        path,
        displayName,
        error: message,
      });
      issues.push({
        slug: skillInsert.slug,
        path,
        displayName,
        kind: "invalid_slug",
        severity: "error",
        message,
      });
      continue;
    }

    const reviveCandidate = await findGitHubSkillRevivalCandidate(ctx, {
      ownerUserId: args.ownerUserId,
      ownerPublisherId: sourceOwnerPublisherId,
      slug: skillInsert.slug,
    });
    if (reviveCandidate && canReviveGitHubSkillForSource(reviveCandidate)) {
      const previousSkillSnapshot = { ...reviveCandidate } as Doc<"skills">;
      const doc = stripUndefined(skillInsert.doc) as Partial<Doc<"skills">>;
      const patch = {
        ...doc,
        createdAt: reviveCandidate.createdAt,
        tags: reviveCandidate.tags ?? {},
        statsDownloads: reviveCandidate.statsDownloads ?? doc.statsDownloads,
        statsStars: reviveCandidate.statsStars ?? doc.statsStars,
        statsInstallsCurrent: reviveCandidate.statsInstallsCurrent ?? doc.statsInstallsCurrent,
        statsInstallsAllTime: reviveCandidate.statsInstallsAllTime ?? doc.statsInstallsAllTime,
        stats: reviveCandidate.stats ?? doc.stats,
        badges: reviveCandidate.badges,
        latestVersionId: undefined,
        githubRemovedAt: undefined,
        softDeletedAt: undefined,
        updatedAt: now,
      };
      await ctx.db.patch(reviveCandidate._id, patch);
      const nextSkillSnapshot = {
        ...previousSkillSnapshot,
        ...patch,
      } as Doc<"skills">;
      const discovered = discoveredBySlug.get(skillInsert.slug);
      if (discovered) {
        if (hasGitHubSkillContent(discovered)) {
          await upsertGitHubSkillContent(ctx, {
            skillId: reviveCandidate._id,
            sourceId,
            discovered,
            commit: args.snapshot.commit,
            now,
          });
        }
        await scheduleGitHubSkillVerification(ctx, {
          skillId: reviveCandidate._id,
          contentHash: discovered.contentHash,
          scanStatus: doc.githubScanStatus,
          now,
        });
      }
      await adjustGlobalPublicCountForSkillChange(
        ctx,
        previousSkillSnapshot,
        nextSkillSnapshot,
        now,
      );
      await syncSkillSearchDigestForSkill(ctx, nextSkillSnapshot);
      revived += 1;
      continue;
    }

    const doc = stripUndefined(skillInsert.doc) as Omit<Doc<"skills">, "_id" | "_creationTime">;
    const skillId = await ctx.db.insert("skills", doc);
    const insertedSkill = {
      ...doc,
      _id: skillId,
      _creationTime: now,
    } as Doc<"skills">;
    await syncSkillSearchDigestForSkill(ctx, insertedSkill);
    const discovered = discoveredBySlug.get(skillInsert.slug);
    if (discovered) {
      if (hasGitHubSkillContent(discovered)) {
        await upsertGitHubSkillContent(ctx, {
          skillId,
          sourceId,
          discovered,
          commit: args.snapshot.commit,
          now,
        });
      }
      await scheduleGitHubSkillVerification(ctx, {
        skillId,
        contentHash: discovered.contentHash,
        scanStatus: doc.githubScanStatus,
        now,
      });
    }
    await adjustGlobalPublicCountForSkillChange(ctx, null, insertedSkill, now);
    inserted += 1;
  }

  await ctx.db.patch(sourceId, {
    lastSyncIssues: issues,
    lastSyncInvalidSkills: invalidSkills,
  });

  return {
    ok: true,
    repo,
    sourceId,
    commit: args.snapshot.commit,
    manifestStatus: args.snapshot.manifestStatus,
    issues,
    invalidSkills,
    stats: {
      ...plan.stats,
      inserted,
      conflicts,
      invalid,
      revived,
    },
  };
}

async function applyGenericGitHubSkillSourceSyncHandler(
  ctx: MutationCtx,
  args: ApplyGitHubSkillSourceSyncArgs & { repo: string; now: number },
): Promise<SyncOneResult> {
  if (!args.ownerPublisherId || !args.githubRepositoryId || !args.githubOwnerId) {
    throw new ConvexError("GitHub Skill Sync requires immutable repository authorization.");
  }
  const existingSource = args.sourceId
    ? await ctx.db.get(args.sourceId)
    : ((await ctx.db
        .query("githubSkillSources")
        .withIndex("by_github_repository_id", (q) =>
          q.eq("githubRepositoryId", args.githubRepositoryId),
        )
        .unique()) ??
      (await ctx.db
        .query("githubSkillSources")
        .withIndex("by_repo", (q) => q.eq("repo", args.repo))
        .unique()));
  if (
    args.expectedSourceUpdatedAt !== undefined &&
    (args.expectedSourceUpdatedAt === null
      ? Boolean(existingSource)
      : existingSource?.updatedAt !== args.expectedSourceUpdatedAt)
  ) {
    return {
      ok: true as const,
      skipped: "stale-source-observation" as const,
      repo: existingSource?.repo ?? args.repo,
      sourceId: existingSource?._id,
      commit: args.snapshot.commit,
      manifestStatus: args.snapshot.manifestStatus,
      stats: {
        discovered: args.snapshot.skills.length,
        inserted: 0,
        changed: 0,
        unchanged: 0,
        removed: 0,
        conflicts: 0,
        invalid: 0,
        revived: 0,
      },
    };
  }
  const collidingSource = (
    await ctx.db
      .query("githubSkillSources")
      .withIndex("by_repo", (q) => q.eq("repo", args.repo))
      .take(2)
  ).find((source) => source._id !== existingSource?._id);
  if (collidingSource) {
    throw new ConvexError("GitHub repository name is retained by another source.");
  }
  if (
    existingSource?.ownerPublisherId &&
    existingSource.ownerPublisherId !== args.ownerPublisherId
  ) {
    throw new ConvexError("GitHub source is already configured for another publisher.");
  }
  if (
    !existingSource?.ownerPublisherId &&
    existingSource?.disconnectedOwnerPublisherId &&
    existingSource.disconnectedOwnerPublisherId !== args.ownerPublisherId
  ) {
    throw new ConvexError(
      "Disconnected GitHub source requires an explicit ownership transfer before reassignment.",
    );
  }
  if (
    existingSource?.githubRepositoryId &&
    existingSource.githubRepositoryId !== args.githubRepositoryId
  ) {
    throw new ConvexError("GitHub repository identity changed.");
  }
  if (existingSource?.githubOwnerId && existingSource.githubOwnerId !== args.githubOwnerId) {
    throw new ConvexError("GitHub repository owner identity changed.");
  }

  const sourceId =
    existingSource?._id ??
    (await ctx.db.insert("githubSkillSources", {
      repo: args.repo,
      ownerPublisherId: args.ownerPublisherId,
      githubRepositoryId: args.githubRepositoryId,
      githubOwnerId: args.githubOwnerId,
      authorizationStatus: "active",
      authorizationCheckedAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
    }));
  const sourceUpdatedAt = existingSource
    ? Math.max(args.now, existingSource.updatedAt + 1)
    : args.now;
  const publisher = await ctx.db.get(args.ownerPublisherId);
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
    throw new ConvexError("GitHub source owner publisher not found.");
  }
  await ctx.db.patch(sourceId, {
    repo: args.repo,
    ownerPublisherId: args.ownerPublisherId,
    disconnectedOwnerPublisherId: undefined,
    githubRepositoryId: args.githubRepositoryId,
    githubOwnerId: args.githubOwnerId,
    authorizationStatus: "active",
    authorizationCheckedAt: args.now,
    authorizationError: undefined,
    defaultBranch: args.snapshot.defaultBranch,
    lastSyncStatus: "ok",
    lastSyncError: undefined,
    lastSyncErrorAt: undefined,
    displayManifestKind: "skills.sh",
    displayManifestHash: args.snapshot.manifestHash,
    displayManifestCommit: args.snapshot.commit,
    displayManifestFetchedAt: args.now,
    displayManifestStatus: args.snapshot.manifestStatus,
    displayManifest: args.snapshot.manifest,
    updatedAt: sourceUpdatedAt,
  });

  const sourceSkills = await ctx.db
    .query("skills")
    .withIndex("by_github_source", (q) => q.eq("githubSourceId", sourceId))
    .collect();
  const [pendingSourceCandidates, legacySourceCandidates] = await Promise.all([
    ctx.db
      .query("githubSkillCandidates")
      .withIndex("by_github_source_and_lifecycle_status", (q) =>
        q.eq("githubSourceId", sourceId).eq("lifecycleStatus", "pending"),
      )
      .collect(),
    ctx.db
      .query("githubSkillCandidates")
      .withIndex("by_github_source_and_lifecycle_status", (q) =>
        q.eq("githubSourceId", sourceId).eq("lifecycleStatus", undefined),
      )
      .collect(),
  ]);
  const sourceCandidates = [...pendingSourceCandidates, ...legacySourceCandidates];
  const sourceSkillByPath = new Map(
    sourceSkills.flatMap((skill) => (skill.githubPath ? [[skill.githubPath, skill] as const] : [])),
  );
  const sourceSkillBySlug = new Map(sourceSkills.map((skill) => [skill.slug, skill]));
  const matchedSkillIds = new Set<Id<"skills">>();
  const matchedCandidateIds = new Set<Id<"githubSkillCandidates">>();
  const issues: GitHubSkillSourceSyncIssue[] = [];
  const invalidSkills: NonNullable<SyncOneResult["invalidSkills"]> = [];
  const stats = {
    discovered: args.snapshot.skills.length,
    inserted: 0,
    changed: 0,
    unchanged: 0,
    removed: 0,
    conflicts: 0,
    invalid: 0,
    revived: 0,
  };

  for (const discovered of args.snapshot.skills) {
    const scheduleVerification = discovered.path !== args.skillsShClaimPath;
    try {
      assertValidSkillSlug(discovered.slug);
    } catch (error) {
      const message = getErrorMessage(error);
      invalidSkills.push({
        slug: discovered.slug,
        path: discovered.path,
        displayName: discovered.displayName,
        error: message,
      });
      issues.push({
        slug: discovered.slug,
        path: discovered.path,
        displayName: discovered.displayName,
        kind: "invalid_slug",
        severity: "error",
        message,
      });
      stats.invalid += 1;
      continue;
    }

    let skill =
      sourceSkillByPath.get(discovered.path) ?? sourceSkillBySlug.get(discovered.slug) ?? null;
    if (!skill) {
      const [destination, alias] = await Promise.all([
        getSkillBySlugForPublisher(ctx, discovered.slug, publisher),
        getSkillSlugAliasBySlugForPublisher(ctx, discovered.slug, publisher),
      ]);
      if (alias && (!destination || alias.skillId !== destination._id)) {
        issues.push(
          githubSkillSyncConflictIssue(
            discovered,
            "Destination slug is already reserved by another skill redirect.",
            publisher.handle,
          ),
        );
        stats.conflicts += 1;
        continue;
      }
      skill = destination;
    }

    if (!skill) {
      const moderation = githubBackedSkillModeration("pending");
      const skillId = await ctx.db.insert("skills", {
        slug: discovered.slug,
        displayName: discovered.displayName,
        summary: discovered.summary,
        icon: iconForDiscoveredGitHubSkill(discovered),
        ownerUserId: args.ownerUserId,
        ownerPublisherId: args.ownerPublisherId,
        installKind: "github",
        githubSourceId: sourceId,
        githubCurrentRepo: args.repo,
        githubPath: discovered.path,
        githubHasSkillCard: Boolean(discovered.skillCardMarkdownPath),
        githubCurrentCommit: args.snapshot.commit,
        githubCurrentContentHash: discovered.contentHash,
        githubCurrentStatus: "present",
        githubCurrentCheckedAt: args.now,
        githubScanStatus: "pending",
        latestVersionSummary: latestGitHubVersionSummary(discovered.upstreamVersion, args.now),
        tags: {},
        statsDownloads: 0,
        statsStars: 0,
        statsInstallsCurrent: 0,
        statsInstallsAllTime: 0,
        stats: {
          downloads: 0,
          stars: 0,
          installsCurrent: 0,
          installsAllTime: 0,
          versions: 0,
          comments: 0,
        },
        ...moderation,
        createdAt: args.now,
        updatedAt: args.now,
      });
      const insertedSkill = await ctx.db.get(skillId);
      if (insertedSkill) {
        await syncSkillSearchDigestForSkill(ctx, insertedSkill);
        await adjustGlobalPublicCountForSkillChange(ctx, null, insertedSkill, args.now);
      }
      if (scheduleVerification) {
        await scheduleGitHubSkillVerification(ctx, {
          skillId,
          contentHash: discovered.contentHash,
          scanStatus: "pending",
          now: args.now,
        });
      }
      matchedSkillIds.add(skillId);
      stats.inserted += 1;
      continue;
    }

    if (
      skill.ownerPublisherId !== args.ownerPublisherId ||
      (skill.installKind === "github" &&
        skill.githubSourceId &&
        skill.githubSourceId !== sourceId &&
        !skill.softDeletedAt)
    ) {
      issues.push(
        githubSkillSyncConflictIssue(
          discovered,
          "Destination is controlled by another GitHub source.",
          publisher.handle,
        ),
      );
      stats.conflicts += 1;
      continue;
    }

    matchedSkillIds.add(skill._id);
    const hasAllowedGitHubSource =
      skill.installKind === "github" &&
      skill.githubCurrentStatus === "present" &&
      (skill.githubScanStatus === "clean" || skill.githubScanStatus === "suspicious") &&
      !skill.softDeletedAt;
    const hasAllowedHostedSource = skill.installKind !== "github" && Boolean(skill.latestVersionId);
    const sameCurrentContent =
      skill.installKind === "github" &&
      skill.githubSourceId === sourceId &&
      skill.githubCurrentStatus === "present" &&
      skill.githubCurrentContentHash === discovered.contentHash;
    const sameCurrentPointer =
      sameCurrentContent &&
      (skill.githubCurrentRepo ?? existingSource?.repo) === args.repo &&
      skill.githubPath === discovered.path &&
      skill.githubCurrentCommit === args.snapshot.commit;
    const unchangedAllowedReappearance =
      canAutoReviveGitHubSkill(skill) &&
      (skill.githubCurrentRepo ?? existingSource?.repo) === args.repo &&
      skill.githubPath === discovered.path &&
      skill.githubCurrentCommit === args.snapshot.commit &&
      skill.githubCurrentContentHash === discovered.contentHash &&
      (skill.githubScanStatus === "clean" || skill.githubScanStatus === "suspicious");

    if (skill.softDeletedAt && !canAutoReviveGitHubSkill(skill)) {
      stats.unchanged += 1;
      continue;
    }

    if (unchangedAllowedReappearance) {
      const previousSkill = { ...skill };
      const moderation = githubBackedSkillModeration(
        skill.githubScanStatus === "suspicious" ? "suspicious" : "clean",
      );
      const patch = {
        githubCurrentRepo: args.repo,
        githubCurrentStatus: "present" as const,
        githubCurrentCheckedAt: args.now,
        githubRemovedAt: undefined,
        softDeletedAt: undefined,
        updatedAt: args.now,
        ...moderation,
      };
      await ctx.db.patch(skill._id, patch);
      const nextSkill = { ...previousSkill, ...patch };
      await syncSkillSearchDigestForSkill(ctx, nextSkill);
      await adjustGlobalPublicCountForSkillChange(ctx, previousSkill, nextSkill, args.now);
      stats.revived += 1;
      continue;
    }

    if (sameCurrentPointer) {
      const previousSkill = { ...skill };
      const patch = {
        displayName: discovered.displayName,
        summary: discovered.summary,
        icon: iconForDiscoveredGitHubSkill(discovered),
        ownerUserId: args.ownerUserId,
        ownerPublisherId: args.ownerPublisherId,
        githubCurrentRepo: args.repo,
        githubPath: discovered.path,
        githubHasSkillCard: Boolean(discovered.skillCardMarkdownPath),
        githubCurrentCommit: args.snapshot.commit,
        githubCurrentCheckedAt: args.now,
        githubRemovedAt: undefined,
        updatedAt: args.now,
      };
      await ctx.db.patch(skill._id, patch);
      const nextSkill = { ...previousSkill, ...patch };
      await syncSkillSearchDigestForSkill(ctx, nextSkill);
      await adjustGlobalPublicCountForSkillChange(ctx, previousSkill, nextSkill, args.now);
      stats.unchanged += 1;
      continue;
    }

    if (hasAllowedGitHubSource || hasAllowedHostedSource || canAutoReviveGitHubSkill(skill)) {
      const candidateId = await upsertGitHubSkillCandidate(ctx, {
        skill,
        sourceId,
        repo: args.repo,
        currentRepo: skill.githubCurrentRepo ?? existingSource?.repo ?? args.repo,
        discovered,
        commit: args.snapshot.commit,
        now: args.now,
        scheduleVerification,
      });
      matchedCandidateIds.add(candidateId);
      if (canAutoReviveGitHubSkill(skill)) stats.revived += 1;
      else stats.changed += 1;
      continue;
    }

    const previousSkill = { ...skill };
    if (skill.githubPendingCandidateId) {
      await cancelPendingGitHubSkillCandidate(
        ctx,
        skill.githubPendingCandidateId,
        args.now,
        "github.source.replaced-before-first-verdict",
      );
    }
    const moderation = githubBackedSkillModeration("pending");
    const patch = {
      displayName: discovered.displayName,
      summary: discovered.summary,
      icon: iconForDiscoveredGitHubSkill(discovered),
      ownerUserId: args.ownerUserId,
      ownerPublisherId: args.ownerPublisherId,
      installKind: "github" as const,
      githubSourceId: sourceId,
      githubCurrentRepo: args.repo,
      githubPath: discovered.path,
      githubHasSkillCard: Boolean(discovered.skillCardMarkdownPath),
      githubCurrentCommit: args.snapshot.commit,
      githubCurrentContentHash: discovered.contentHash,
      githubCurrentStatus: "present" as const,
      githubCurrentCheckedAt: args.now,
      githubScanStatus: "pending" as const,
      githubRemovedAt: undefined,
      githubPendingCandidateId: undefined,
      latestVersionId: undefined,
      latestVersionSummary: latestGitHubVersionSummary(discovered.upstreamVersion, args.now),
      softDeletedAt: undefined,
      updatedAt: args.now,
      ...moderation,
    };
    await ctx.db.patch(skill._id, patch);
    const nextSkill = { ...previousSkill, ...patch };
    await syncSkillSearchDigestForSkill(ctx, nextSkill);
    await adjustGlobalPublicCountForSkillChange(ctx, previousSkill, nextSkill, args.now);
    if (scheduleVerification) {
      await scheduleGitHubSkillVerification(ctx, {
        skillId: skill._id,
        contentHash: discovered.contentHash,
        scanStatus: "pending",
        now: args.now,
      });
    }
    if (skill.softDeletedAt) stats.revived += 1;
    else stats.changed += 1;
  }

  for (const skill of sourceSkills) {
    if (matchedSkillIds.has(skill._id)) continue;
    const previousSkill = { ...skill };
    await cancelPendingGitHubSkillCandidate(
      ctx,
      skill.githubPendingCandidateId,
      args.now,
      "github.upstream.removed",
    );
    const removedAt = skill.githubRemovedAt ?? args.now;
    const patch = {
      githubCurrentStatus: "missing" as const,
      githubCurrentCheckedAt: args.now,
      githubRemovedAt: removedAt,
      githubPendingCandidateId: undefined,
      softDeletedAt: skill.softDeletedAt ?? removedAt,
      moderationStatus: "hidden" as const,
      moderationReason: "github.upstream.removed",
      moderationVerdict: undefined,
      moderationFlags: [],
      isSuspicious: false,
      updatedAt: args.now,
    };
    await ctx.db.patch(skill._id, patch);
    const nextSkill = { ...previousSkill, ...patch };
    await syncSkillSearchDigestForSkill(ctx, nextSkill);
    await adjustGlobalPublicCountForSkillChange(ctx, previousSkill, nextSkill, args.now);
    stats.removed += 1;
  }

  for (const candidate of sourceCandidates) {
    if (matchedCandidateIds.has(candidate._id)) continue;
    const skill = await ctx.db.get(candidate.skillId);
    if (skill?.githubPendingCandidateId === candidate._id) {
      await ctx.db.patch(skill._id, {
        githubPendingCandidateId: undefined,
        updatedAt: args.now,
      });
      await cancelPendingGitHubSkillCandidate(
        ctx,
        candidate._id,
        args.now,
        "github.source.observation-superseded",
      );
    }
  }

  await ctx.db.patch(sourceId, {
    lastSyncIssues: issues,
    lastSyncInvalidSkills: invalidSkills,
    updatedAt: sourceUpdatedAt,
  });
  return {
    ok: true,
    repo: args.repo,
    sourceId,
    commit: args.snapshot.commit,
    manifestStatus: args.snapshot.manifestStatus,
    issues,
    invalidSkills,
    stats,
  };
}

async function upsertGitHubSkillCandidate(
  ctx: MutationCtx,
  args: {
    skill: Doc<"skills">;
    sourceId: Id<"githubSkillSources">;
    repo: string;
    currentRepo: string;
    discovered: GitHubSkillSourceMetadataSnapshot["skills"][number];
    commit: string;
    now: number;
    scheduleVerification: boolean;
  },
) {
  const currentCandidateId = await ensureRetainedCurrentGitHubSkillCandidate(ctx, {
    skill: args.skill,
    repo: args.currentRepo,
    now: args.now,
  });
  const exactCandidate = await ctx.db
    .query("githubSkillCandidates")
    .withIndex("by_skill_and_repo_source_commit_path_hash", (q) =>
      q
        .eq("skillId", args.skill._id)
        .eq("githubRepo", args.repo)
        .eq("githubSourceId", args.sourceId)
        .eq("githubCommit", args.commit)
        .eq("githubPath", args.discovered.path)
        .eq("githubContentHash", args.discovered.contentHash),
    )
    .unique();
  if (exactCandidate) {
    if (
      exactCandidate.scanStatus === "pending" ||
      exactCandidate.scanStatus === "clean" ||
      exactCandidate.scanStatus === "suspicious"
    ) {
      await ctx.db.patch(exactCandidate._id, {
        lifecycleStatus: "pending",
        updatedAt: args.now,
      });
      await ctx.db.patch(args.skill._id, {
        githubPendingCandidateId: exactCandidate._id,
        updatedAt: args.now,
      });
      const verdictSourceScanId = args.scheduleVerification
        ? await scheduleGitHubSkillVerification(ctx, {
            skillId: args.skill._id,
            contentHash: exactCandidate.githubContentHash,
            scanStatus: exactCandidate.scanStatus,
            now: args.now,
            candidateId: exactCandidate._id,
          })
        : null;
      if (verdictSourceScanId && verdictSourceScanId !== exactCandidate.verdictSourceScanId) {
        await ctx.db.patch(exactCandidate._id, {
          verdictSourceScanId,
          updatedAt: args.now,
        });
      }
      if (
        verdictSourceScanId &&
        exactCandidate.skillMarkdown &&
        exactCandidate.skillMarkdownPath &&
        (exactCandidate.scanStatus === "clean" || exactCandidate.scanStatus === "suspicious")
      ) {
        await applyGitHubSkillVerificationResultHandler(ctx, {
          skillId: args.skill._id,
          contentHash: exactCandidate.githubContentHash,
          githubSkillScanId: verdictSourceScanId,
          scanStatus: exactCandidate.scanStatus,
          now: args.now,
        });
      }
    }
    return exactCandidate._id;
  }
  const pendingCandidate = args.skill.githubPendingCandidateId
    ? await ctx.db.get(args.skill.githubPendingCandidateId)
    : null;
  if (
    pendingCandidate &&
    pendingCandidate.githubSourceId === args.sourceId &&
    pendingCandidate.githubCommit === args.commit &&
    pendingCandidate.githubPath === args.discovered.path &&
    pendingCandidate.githubContentHash === args.discovered.contentHash &&
    (pendingCandidate.lifecycleStatus === undefined ||
      pendingCandidate.lifecycleStatus === "pending")
  ) {
    return pendingCandidate._id;
  }
  const reusableScan = await ctx.db
    .query("githubSkillScans")
    .withIndex("by_skill_and_content_hash", (q) =>
      q.eq("skillId", args.skill._id).eq("contentHash", args.discovered.contentHash),
    )
    .unique();
  const scanStatus = reusableScan?.status ?? "pending";
  const lifecycle =
    scanStatus === "malicious"
      ? { lifecycleStatus: "rejected" as const, rejectedAt: args.now }
      : scanStatus === "failed"
        ? { lifecycleStatus: "failed" as const, failedAt: args.now }
        : { lifecycleStatus: "pending" as const };
  const candidateId = await ctx.db.insert(
    "githubSkillCandidates",
    stripUndefined({
      skillId: args.skill._id,
      githubSourceId: args.sourceId,
      githubRepo: args.repo,
      githubPath: args.discovered.path,
      githubHasSkillCard: Boolean(args.discovered.skillCardMarkdownPath),
      githubCommit: args.commit,
      githubContentHash: args.discovered.contentHash,
      displayName: args.discovered.displayName,
      summary: args.discovered.summary,
      icon: iconForDiscoveredGitHubSkill(args.discovered),
      upstreamVersion: args.discovered.upstreamVersion,
      skillMarkdownPath: undefined,
      skillMarkdown: undefined,
      skillCardMarkdownPath: undefined,
      skillCardMarkdown: undefined,
      scanStatus,
      ...lifecycle,
      verdictSourceScanId: reusableScan?._id,
      previousCandidateId: currentCandidateId,
      createdAt: args.now,
      updatedAt: args.now,
    }) as Omit<Doc<"githubSkillCandidates">, "_id" | "_creationTime">,
  );
  if (pendingCandidate) {
    await ctx.db.patch(pendingCandidate._id, {
      lifecycleStatus: "superseded",
      supersededByCandidateId: candidateId,
      supersededAt: args.now,
      updatedAt: args.now,
    });
  }
  await ctx.db.patch(
    args.skill._id,
    scanStatus === "malicious" || scanStatus === "failed"
      ? { githubPendingCandidateId: undefined, updatedAt: args.now }
      : { githubPendingCandidateId: candidateId, updatedAt: args.now },
  );
  if (scanStatus === "pending" || scanStatus === "clean" || scanStatus === "suspicious") {
    const verdictSourceScanId = args.scheduleVerification
      ? await scheduleGitHubSkillVerification(ctx, {
          skillId: args.skill._id,
          contentHash: args.discovered.contentHash,
          scanStatus,
          now: args.now,
          candidateId,
        })
      : null;
    if (verdictSourceScanId && verdictSourceScanId !== reusableScan?._id) {
      await ctx.db.patch(candidateId, {
        verdictSourceScanId,
        updatedAt: args.now,
      });
    }
  }
  return candidateId;
}

async function ensureRetainedCurrentGitHubSkillCandidate(
  ctx: MutationCtx,
  args: { skill: Doc<"skills">; repo: string; now: number },
): Promise<Id<"githubSkillCandidates"> | undefined> {
  if (args.skill.githubCurrentCandidateId) return args.skill.githubCurrentCandidateId;
  if (
    args.skill.installKind !== "github" ||
    !args.skill.githubSourceId ||
    !args.skill.githubPath ||
    !args.skill.githubCurrentCommit ||
    !args.skill.githubCurrentContentHash ||
    (args.skill.githubCurrentStatus !== "present" &&
      args.skill.githubCurrentStatus !== "missing") ||
    (args.skill.githubScanStatus !== "clean" && args.skill.githubScanStatus !== "suspicious")
  ) {
    return undefined;
  }
  const githubSourceId = args.skill.githubSourceId;
  const githubPath = args.skill.githubPath;
  const githubCommit = args.skill.githubCurrentCommit;
  const githubContentHash = args.skill.githubCurrentContentHash;

  const existing = await ctx.db
    .query("githubSkillCandidates")
    .withIndex("by_skill_and_repo_source_commit_path_hash", (q) =>
      q
        .eq("skillId", args.skill._id)
        .eq("githubRepo", args.repo)
        .eq("githubSourceId", githubSourceId)
        .eq("githubCommit", githubCommit)
        .eq("githubPath", githubPath)
        .eq("githubContentHash", githubContentHash),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(args.skill._id, {
      githubCurrentCandidateId: existing._id,
      updatedAt: args.now,
    });
    return existing._id;
  }

  const [scan, content] = await Promise.all([
    ctx.db
      .query("githubSkillScans")
      .withIndex("by_skill_and_content_hash", (q) =>
        q.eq("skillId", args.skill._id).eq("contentHash", githubContentHash),
      )
      .unique(),
    ctx.db
      .query("githubSkillContents")
      .withIndex("by_skill", (q) => q.eq("skillId", args.skill._id))
      .unique(),
  ]);
  const allowedScan = scan?.status === args.skill.githubScanStatus ? scan : null;
  const exactContent =
    content &&
    content.githubSourceId === githubSourceId &&
    content.githubPath === githubPath &&
    content.githubCommit === githubCommit &&
    content.githubContentHash === githubContentHash
      ? content
      : null;
  const candidateId = await ctx.db.insert(
    "githubSkillCandidates",
    stripUndefined({
      skillId: args.skill._id,
      githubSourceId,
      githubRepo: args.repo,
      githubPath,
      githubHasSkillCard: args.skill.githubHasSkillCard ?? false,
      githubCommit,
      githubContentHash,
      displayName: args.skill.displayName,
      summary: args.skill.summary,
      icon: args.skill.icon,
      upstreamVersion: args.skill.latestVersionSummary?.version,
      skillMarkdownPath: exactContent?.skillMarkdownPath,
      skillMarkdown: exactContent?.skillMarkdown,
      skillCardMarkdownPath: exactContent?.skillCardMarkdownPath,
      skillCardMarkdown: exactContent?.skillCardMarkdown,
      scanStatus: args.skill.githubScanStatus,
      lifecycleStatus: "promoted",
      verdictSourceScanId: allowedScan?._id,
      promotedAt: args.skill.updatedAt,
      createdAt: args.now,
      updatedAt: args.now,
    }) as Omit<Doc<"githubSkillCandidates">, "_id" | "_creationTime">,
  );
  await ctx.db.patch(args.skill._id, {
    githubCurrentCandidateId: candidateId,
    updatedAt: args.now,
  });
  return candidateId;
}

function githubSkillSyncConflictIssue(
  discovered: GitHubSkillSourceMetadataSnapshot["skills"][number],
  message: string,
  existingOwnerHandle: string,
): GitHubSkillSourceSyncIssue {
  return {
    slug: discovered.slug,
    path: discovered.path,
    displayName: discovered.displayName,
    kind: "slug_conflict",
    severity: "error",
    message,
    existingOwnerHandle,
  };
}

function latestGitHubVersionSummary(version: string | undefined, now: number) {
  if (!version) return undefined;
  return {
    version,
    createdAt: now,
    changelog: "Synced from GitHub source.",
    changelogSource: "auto" as const,
  };
}

async function findGitHubSkillRevivalCandidate(
  ctx: MutationCtx,
  args: {
    ownerUserId: Id<"users">;
    ownerPublisherId: Id<"publishers"> | undefined;
    slug: string;
  },
) {
  if (args.ownerPublisherId) {
    return await ctx.db
      .query("skills")
      .withIndex("by_owner_publisher_slug", (q) =>
        q.eq("ownerPublisherId", args.ownerPublisherId).eq("slug", args.slug),
      )
      .unique();
  }
  return await ctx.db
    .query("skills")
    .withIndex("by_owner_slug", (q) => q.eq("ownerUserId", args.ownerUserId).eq("slug", args.slug))
    .unique();
}

function canReviveGitHubSkillForSource(skill: Doc<"skills">) {
  return skill.installKind === "github" && typeof skill.softDeletedAt === "number";
}

function canAutoReviveGitHubSkill(skill: Doc<"skills">) {
  return (
    skill.installKind === "github" &&
    skill.githubCurrentStatus === "missing" &&
    typeof skill.githubRemovedAt === "number" &&
    skill.softDeletedAt === skill.githubRemovedAt
  );
}

function hasGitHubSkillContent(
  discovered: GitHubSkillSourceMetadataSnapshot["skills"][number],
): discovered is DiscoveredGitHubSkill {
  return typeof (discovered as Partial<DiscoveredGitHubSkill>).skillMarkdown === "string";
}

async function upsertGitHubSkillContent(
  ctx: MutationCtx,
  args: {
    skillId: Id<"skills">;
    sourceId: Id<"githubSkillSources">;
    discovered: GitHubSkillSourceSnapshot["skills"][number];
    commit: string;
    now: number;
  },
) {
  const existing = await ctx.db
    .query("githubSkillContents")
    .withIndex("by_skill", (q) => q.eq("skillId", args.skillId))
    .unique();
  const doc = {
    skillId: args.skillId,
    githubSourceId: args.sourceId,
    githubPath: args.discovered.path,
    skillMarkdownPath: args.discovered.skillMarkdownPath,
    skillMarkdown: args.discovered.skillMarkdown,
    skillCardMarkdownPath: args.discovered.skillCardMarkdownPath,
    skillCardMarkdown: args.discovered.skillCardMarkdown,
    githubCommit: args.commit,
    githubContentHash: args.discovered.contentHash,
    fetchedAt: args.now,
    updatedAt: args.now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, doc);
    return;
  }
  await ctx.db.insert("githubSkillContents", {
    skillId: doc.skillId,
    githubSourceId: doc.githubSourceId,
    githubPath: doc.githubPath,
    skillMarkdownPath: doc.skillMarkdownPath,
    skillMarkdown: doc.skillMarkdown,
    ...(doc.skillCardMarkdownPath ? { skillCardMarkdownPath: doc.skillCardMarkdownPath } : {}),
    ...(doc.skillCardMarkdown !== undefined ? { skillCardMarkdown: doc.skillCardMarkdown } : {}),
    githubCommit: doc.githubCommit,
    githubContentHash: doc.githubContentHash,
    fetchedAt: doc.fetchedAt,
    createdAt: args.now,
    updatedAt: doc.updatedAt,
  });
}

export async function upsertGitHubSkillContentHandler(
  ctx: MutationCtx,
  args: {
    skillId: Id<"skills">;
    sourceId: Id<"githubSkillSources">;
    discovered: DiscoveredGitHubSkill;
    commit: string;
    now?: number;
  },
) {
  const skill = await ctx.db.get(args.skillId);
  if (
    !skill ||
    skill.installKind !== "github" ||
    skill.githubSourceId !== args.sourceId ||
    skill.githubPath !== args.discovered.path ||
    skill.githubCurrentCommit !== args.commit ||
    skill.githubCurrentContentHash !== args.discovered.contentHash ||
    skill.githubCurrentStatus !== "present"
  ) {
    return { ok: true as const, skipped: "stale-current-pointer" as const };
  }
  await upsertGitHubSkillContent(ctx, {
    skillId: args.skillId,
    sourceId: args.sourceId,
    discovered: args.discovered,
    commit: args.commit,
    now: args.now ?? Date.now(),
  });
  return { ok: true as const };
}

export const upsertGitHubSkillContentInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    sourceId: v.id("githubSkillSources"),
    discovered: discoveredSkillContentValidator,
    commit: v.string(),
    now: v.optional(v.number()),
  },
  handler: upsertGitHubSkillContentHandler,
});

export async function upsertGitHubSkillCandidateContentHandler(
  ctx: MutationCtx,
  args: {
    candidateId: Id<"githubSkillCandidates">;
    discovered: DiscoveredGitHubSkill;
    commit: string;
    now?: number;
  },
) {
  const candidate = await ctx.db.get(args.candidateId);
  const skill = candidate ? await ctx.db.get(candidate.skillId) : null;
  if (
    !candidate ||
    !skill ||
    skill.githubPendingCandidateId !== candidate._id ||
    candidate.githubPath !== args.discovered.path ||
    candidate.githubCommit !== args.commit ||
    candidate.githubContentHash !== args.discovered.contentHash
  ) {
    return { ok: true as const, skipped: "stale-candidate" as const };
  }
  const now = args.now ?? Date.now();
  await ctx.db.patch(candidate._id, {
    skillMarkdownPath: args.discovered.skillMarkdownPath,
    skillMarkdown: args.discovered.skillMarkdown,
    skillCardMarkdownPath: args.discovered.skillCardMarkdownPath,
    skillCardMarkdown: args.discovered.skillCardMarkdown,
    updatedAt: now,
  });
  if (candidate.scanStatus === "clean" || candidate.scanStatus === "suspicious") {
    return await applyGitHubSkillVerificationResultHandler(ctx, {
      skillId: candidate.skillId,
      contentHash: candidate.githubContentHash,
      githubSkillScanId: candidate.verdictSourceScanId,
      scanStatus: candidate.scanStatus,
      now,
    });
  }
  return { ok: true as const };
}

export const upsertGitHubSkillCandidateContentInternal = internalMutation({
  args: {
    candidateId: v.id("githubSkillCandidates"),
    discovered: discoveredSkillContentValidator,
    commit: v.string(),
    now: v.optional(v.number()),
  },
  handler: upsertGitHubSkillCandidateContentHandler,
});

async function scheduleGitHubSkillVerification(
  ctx: MutationCtx,
  args: {
    skillId: Id<"skills">;
    contentHash: string;
    scanStatus: unknown;
    now: number;
    candidateId?: Id<"githubSkillCandidates">;
  },
): Promise<Id<"githubSkillScans"> | null> {
  const scan = await ctx.db
    .query("githubSkillScans")
    .withIndex("by_skill_and_content_hash", (q) =>
      q.eq("skillId", args.skillId).eq("contentHash", args.contentHash),
    )
    .unique();
  if (args.scanStatus !== "pending") {
    if (scan?.status !== "pending") {
      if (scan && scan.status === args.scanStatus) return scan._id;
      await applyGitHubSkillVerificationResultHandler(ctx, {
        skillId: args.skillId,
        contentHash: args.contentHash,
        scanStatus: "pending",
      });
    }
  }
  if (scan?.status === "pending" && scan.skillScanRequestId) {
    const request = await ctx.db.get(scan.skillScanRequestId);
    const job = request?.securityScanJobId ? await ctx.db.get(request.securityScanJobId) : null;
    if (job?.status === "queued" || job?.status === "running") return scan._id;
    if (request && request.updatedAt > args.now - GITHUB_SKILL_SCAN_ACTION_LEASE_MS)
      return scan._id;
  }
  if (
    scan?.status === "pending" &&
    !scan.skillScanRequestId &&
    scan.updatedAt > args.now - GITHUB_SKILL_SCAN_ACTION_LEASE_MS
  ) {
    return scan._id;
  }
  const skill = await ctx.db.get(args.skillId);
  if (!skill) return null;
  const candidate = args.candidateId ? await ctx.db.get(args.candidateId) : null;
  const target =
    candidate &&
    skill.githubPendingCandidateId === candidate._id &&
    candidate.githubContentHash === args.contentHash
      ? {
          sourceId: candidate.githubSourceId,
          path: candidate.githubPath,
          commit: candidate.githubCommit,
        }
      : skill.installKind === "github" &&
          skill.githubSourceId &&
          skill.githubPath &&
          skill.githubCurrentStatus === "present" &&
          skill.githubCurrentCommit &&
          skill.githubCurrentContentHash === args.contentHash
        ? {
            sourceId: skill.githubSourceId,
            path: skill.githubPath,
            commit: skill.githubCurrentCommit,
          }
        : null;
  if (!target) return null;
  const pendingScanInsert = {
    githubSourceId: target.sourceId,
    commit: target.commit,
    path: target.path,
    status: "pending" as const,
    updatedAt: args.now,
  };
  let scanId: Id<"githubSkillScans">;
  if (scan) {
    scanId = scan._id;
    await ctx.db.patch(scan._id, {
      ...pendingScanInsert,
      skillScanRequestId: undefined,
    });
  } else {
    scanId = await ctx.db.insert("githubSkillScans", {
      skillId: skill._id,
      contentHash: args.contentHash,
      ...pendingScanInsert,
      createdAt: args.now,
    });
  }
  await ctx.scheduler?.runAfter(0, internal.githubSkillSyncNode.verifyGitHubSkillInternal, {
    skillId: args.skillId,
    contentHash: args.contentHash,
  });
  return scanId;
}

export const applyGitHubSkillSourceSyncInternal = internalMutation({
  args: {
    sourceId: v.optional(v.id("githubSkillSources")),
    repo: v.string(),
    ownerUserId: v.id("users"),
    ownerPublisherId: v.optional(v.id("publishers")),
    githubRepositoryId: v.optional(v.string()),
    githubOwnerId: v.optional(v.string()),
    expectedSourceUpdatedAt: v.optional(v.union(v.number(), v.null())),
    skillsShClaimPath: v.optional(v.string()),
    snapshot: sourceSnapshotValidator,
    now: v.optional(v.number()),
  },
  handler: applyGitHubSkillSourceSyncHandler,
});

export async function rollbackGitHubSkillCandidateHandler(
  ctx: MutationCtx,
  args: {
    skillId: Id<"skills">;
    targetCandidateId: Id<"githubSkillCandidates">;
    confirm: string;
    now?: number;
  },
) {
  if (args.confirm !== "rollback-github-skill-candidate") {
    throw new ConvexError("GitHub Skill Sync rollback confirmation required.");
  }
  const [skill, target] = await Promise.all([
    ctx.db.get(args.skillId),
    ctx.db.get(args.targetCandidateId),
  ]);
  if (!skill || !target || target.skillId !== skill._id) {
    throw new ConvexError("GitHub Skill Sync rollback target not found.");
  }
  if (skill.githubCurrentCandidateId === target._id) {
    return {
      ok: true as const,
      rolledBack: false as const,
      reason: "already-current" as const,
    };
  }
  if (
    (target.scanStatus !== "clean" && target.scanStatus !== "suspicious") ||
    !target.verdictSourceScanId ||
    !target.skillMarkdown ||
    !target.skillMarkdownPath
  ) {
    throw new ConvexError("GitHub Skill Sync rollback target lacks its own allowed verdict.");
  }
  const verdictSourceScan = await ctx.db.get(target.verdictSourceScanId);
  if (
    !verdictSourceScan ||
    verdictSourceScan.skillId !== skill._id ||
    verdictSourceScan.contentHash !== target.githubContentHash ||
    verdictSourceScan.status !== target.scanStatus
  ) {
    throw new ConvexError("GitHub Skill Sync rollback verdict no longer matches the target.");
  }
  const source = await ctx.db.get(target.githubSourceId);
  if (!source || source.authorizationStatus === "revoked") {
    throw new ConvexError("GitHub Skill Sync rollback source is not authorized.");
  }

  const now = args.now ?? Date.now();
  const previousSkill = { ...skill };
  const currentCandidate = skill.githubCurrentCandidateId
    ? await ctx.db.get(skill.githubCurrentCandidateId)
    : null;
  const moderation = githubBackedSkillModeration(target.scanStatus);
  await upsertGitHubSkillContent(ctx, {
    skillId: skill._id,
    sourceId: target.githubSourceId,
    discovered: {
      slug: skill.slug,
      displayName: target.displayName,
      summary: target.summary,
      upstreamVersion: target.upstreamVersion,
      path: target.githubPath,
      skillMarkdownPath: target.skillMarkdownPath,
      skillMarkdown: target.skillMarkdown,
      skillCardMarkdownPath: target.skillCardMarkdownPath,
      skillCardMarkdown: target.skillCardMarkdown,
      contentHash: target.githubContentHash,
    },
    commit: target.githubCommit,
    now,
  });
  const patch = {
    displayName: target.displayName,
    summary: target.summary,
    icon: target.icon,
    installKind: "github" as const,
    githubSourceId: target.githubSourceId,
    githubCurrentRepo: target.githubRepo ?? source.repo,
    githubPath: target.githubPath,
    githubHasSkillCard: target.githubHasSkillCard,
    githubCurrentCommit: target.githubCommit,
    githubCurrentContentHash: target.githubContentHash,
    githubCurrentStatus: "present" as const,
    githubCurrentCheckedAt: now,
    githubScanStatus: target.scanStatus,
    githubRemovedAt: undefined,
    githubCurrentCandidateId: target._id,
    githubPendingCandidateId: undefined,
    latestVersionId: undefined,
    latestVersionSummary: latestGitHubVersionSummary(target.upstreamVersion, now),
    softDeletedAt: undefined,
    updatedAt: now,
    ...moderation,
  };
  if (currentCandidate) {
    await ctx.db.patch(currentCandidate._id, {
      lifecycleStatus: "rolled_back",
      rolledBackAt: now,
      updatedAt: now,
    });
  }
  if (skill.githubPendingCandidateId && skill.githubPendingCandidateId !== target._id) {
    await cancelPendingGitHubSkillCandidate(
      ctx,
      skill.githubPendingCandidateId,
      now,
      "github.rollback",
    );
  }
  await ctx.db.patch(target._id, {
    lifecycleStatus: "promoted",
    promotedAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(skill._id, patch);
  const nextSkill = { ...previousSkill, ...patch };
  await syncSkillSearchDigestForSkill(ctx, nextSkill);
  await adjustGlobalPublicCountForSkillChange(ctx, previousSkill, nextSkill, now);
  return { ok: true as const, rolledBack: true as const };
}

export const rollbackGitHubSkillCandidateInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    targetCandidateId: v.id("githubSkillCandidates"),
    confirm: v.string(),
    now: v.optional(v.number()),
  },
  handler: rollbackGitHubSkillCandidateHandler,
});

export type ApplyGitHubSkillVerificationResultArgs = {
  skillId: Id<"skills">;
  contentHash: string;
  githubSkillScanId?: Id<"githubSkillScans">;
  scanStatus: GitHubSkillScanStatus;
  now?: number;
};

export async function applyGitHubSkillVerificationResultHandler(
  ctx: MutationCtx,
  args: ApplyGitHubSkillVerificationResultArgs,
) {
  const skill = await ctx.db.get(args.skillId);
  if (!skill) {
    return { ok: true as const, skipped: "missing-github-skill" as const };
  }
  const candidate = skill.githubPendingCandidateId
    ? await ctx.db.get(skill.githubPendingCandidateId)
    : null;
  if (candidate?.githubContentHash === args.contentHash) {
    const verdictSourceScan = args.githubSkillScanId
      ? await ctx.db.get(args.githubSkillScanId)
      : null;
    const isAllowedVerdict = args.scanStatus === "clean" || args.scanStatus === "suspicious";
    if (isAllowedVerdict && !args.githubSkillScanId) {
      return {
        ok: true as const,
        skipped: candidate.verdictSourceScanId
          ? ("stale-candidate-verdict" as const)
          : ("missing-candidate-verdict" as const),
      };
    }
    if (
      (candidate.verdictSourceScanId && candidate.verdictSourceScanId !== args.githubSkillScanId) ||
      (args.githubSkillScanId &&
        (!verdictSourceScan ||
          verdictSourceScan.skillId !== candidate.skillId ||
          verdictSourceScan.contentHash !== candidate.githubContentHash ||
          verdictSourceScan.status !== args.scanStatus))
    ) {
      return { ok: true as const, skipped: "stale-candidate-verdict" as const };
    }
    const now = args.now ?? Date.now();
    const lifecyclePatch =
      args.scanStatus === "malicious"
        ? { lifecycleStatus: "rejected" as const, rejectedAt: now }
        : args.scanStatus === "failed"
          ? { lifecycleStatus: "failed" as const, failedAt: now }
          : { lifecycleStatus: "pending" as const };
    await ctx.db.patch(candidate._id, {
      scanStatus: args.scanStatus,
      ...(args.githubSkillScanId && !candidate.verdictSourceScanId
        ? { verdictSourceScanId: args.githubSkillScanId }
        : {}),
      ...lifecyclePatch,
      updatedAt: now,
    });
    if (args.scanStatus !== "clean" && args.scanStatus !== "suspicious") {
      if (args.scanStatus === "malicious") {
        await ctx.db.patch(skill._id, {
          githubPendingCandidateId: undefined,
          updatedAt: now,
        });
      }
      return { ok: true as const, promoted: false };
    }
    if (!candidate.skillMarkdown || !candidate.skillMarkdownPath) {
      return {
        ok: true as const,
        skipped: "candidate-content-not-cached" as const,
      };
    }
    const isAutomaticReappearance =
      canAutoReviveGitHubSkill(skill) && skill.moderationReason === "github.upstream.removed";
    if (
      (!isAutomaticReappearance && skill.softDeletedAt) ||
      (!isAutomaticReappearance && skill.moderationStatus === "hidden") ||
      skill.moderationStatus === "removed"
    ) {
      return {
        ok: true as const,
        skipped: "skill-no-longer-eligible" as const,
      };
    }
    const previousSkill = { ...skill };
    const candidateRepo =
      candidate.githubRepo ?? (await ctx.db.get(candidate.githubSourceId))?.repo;
    if (!candidateRepo) {
      return {
        ok: true as const,
        skipped: "candidate-source-missing" as const,
      };
    }
    const moderation = githubBackedSkillModeration(args.scanStatus);
    const patch = {
      displayName: candidate.displayName,
      summary: candidate.summary,
      icon: candidate.icon,
      installKind: "github" as const,
      githubSourceId: candidate.githubSourceId,
      githubCurrentRepo: candidateRepo,
      githubPath: candidate.githubPath,
      githubHasSkillCard: candidate.githubHasSkillCard,
      githubCurrentCommit: candidate.githubCommit,
      githubCurrentContentHash: candidate.githubContentHash,
      githubCurrentStatus: "present" as const,
      githubCurrentCheckedAt: now,
      githubScanStatus: args.scanStatus,
      githubRemovedAt: undefined,
      githubCurrentCandidateId: candidate._id,
      githubPendingCandidateId: undefined,
      latestVersionId: undefined,
      latestVersionSummary: latestGitHubVersionSummary(candidate.upstreamVersion, now),
      softDeletedAt: undefined,
      updatedAt: now,
      ...moderation,
    };
    await upsertGitHubSkillContent(ctx, {
      skillId: skill._id,
      sourceId: candidate.githubSourceId,
      discovered: {
        slug: skill.slug,
        displayName: candidate.displayName,
        summary: candidate.summary,
        upstreamVersion: candidate.upstreamVersion,
        path: candidate.githubPath,
        skillMarkdownPath: candidate.skillMarkdownPath,
        skillMarkdown: candidate.skillMarkdown,
        skillCardMarkdownPath: candidate.skillCardMarkdownPath,
        skillCardMarkdown: candidate.skillCardMarkdown,
        contentHash: candidate.githubContentHash,
      },
      commit: candidate.githubCommit,
      now,
    });
    const previousCandidate = skill.githubCurrentCandidateId
      ? await ctx.db.get(skill.githubCurrentCandidateId)
      : null;
    if (previousCandidate && previousCandidate._id !== candidate._id) {
      await ctx.db.patch(previousCandidate._id, {
        lifecycleStatus: "superseded",
        supersededByCandidateId: candidate._id,
        supersededAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(skill._id, patch);
    const nextSkill = { ...previousSkill, ...patch };
    await syncSkillSearchDigestForSkill(ctx, nextSkill);
    await adjustGlobalPublicCountForSkillChange(ctx, previousSkill, nextSkill, now);
    await ctx.db.patch(candidate._id, {
      lifecycleStatus: "promoted",
      previousCandidateId: skill.githubCurrentCandidateId,
      promotedAt: now,
      updatedAt: now,
    });
    return { ok: true as const, promoted: true };
  }
  if (skill.installKind !== "github") {
    return { ok: true as const, skipped: "missing-github-skill" as const };
  }
  if (
    skill.githubCurrentStatus !== "present" ||
    !skill.githubCurrentCommit ||
    skill.githubCurrentContentHash !== args.contentHash
  ) {
    return {
      ok: true as const,
      skipped: "stale-current-hash" as const,
      currentContentHash: skill.githubCurrentContentHash,
    };
  }

  if (args.githubSkillScanId) {
    const scan = await ctx.db.get(args.githubSkillScanId);
    if (
      !scan ||
      scan.skillId !== skill._id ||
      scan.githubSourceId !== skill.githubSourceId ||
      scan.path !== skill.githubPath ||
      scan.commit !== skill.githubCurrentCommit ||
      scan.contentHash !== skill.githubCurrentContentHash
    ) {
      return { ok: true as const, skipped: "stale-current-scan" as const };
    }
  }

  const now = args.now ?? Date.now();
  const promote = args.scanStatus === "clean";
  const moderation = githubBackedSkillModeration(args.scanStatus);
  const previousSkill = { ...skill };
  const patch = {
    githubScanStatus: args.scanStatus,
    updatedAt: now,
    ...moderation,
  };
  await ctx.db.patch(args.skillId, patch);
  const nextSkill = { ...previousSkill, ...patch };
  await syncSkillSearchDigestForSkill(ctx, nextSkill);
  await adjustGlobalPublicCountForSkillChange(ctx, previousSkill, nextSkill, now);

  return { ok: true as const, promoted: promote };
}

export const applyGitHubSkillVerificationResultInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    contentHash: v.string(),
    githubSkillScanId: v.optional(v.id("githubSkillScans")),
    scanStatus: githubSkillScanStatusValidator,
    now: v.optional(v.number()),
  },
  handler: applyGitHubSkillVerificationResultHandler,
});

export async function verifyGitHubSkillHandler(
  ctx: ActionCtx,
  args: { skillId: Id<"skills">; contentHash: string; force?: boolean },
  fetcher: typeof fetch = fetch,
): Promise<GitHubSkillVerificationResult> {
  const target = (await ctx.runQuery(
    internal.githubSkillSync.getGitHubSkillVerificationTargetInternal,
    { skillId: args.skillId, contentHash: args.contentHash },
  )) as GitHubSkillVerificationTarget | null;
  if (!target) return { ok: true as const, skipped: "stale-or-missing" as const };
  if (
    !getRuntimeRolloutCapabilities().githubSkillSync.runtimeEnabled &&
    target.source.repo.trim().toLowerCase() !== "nvidia/skills"
  ) {
    return { ok: true as const, skipped: "rollout-disabled" as const };
  }

  const { snapshot, entries } = await fetchGitHubSkillSourceSnapshotWithEntries(
    ctx,
    {
      repo: target.source.repo,
      ref: target.skill.githubCurrentCommit,
      defaultBranch: target.source.defaultBranch ?? DEFAULT_BRANCH,
    },
    fetcher,
  );
  const discovered = snapshot.skills.find((skill) => skill.path === target.skill.githubPath);
  if (!discovered || discovered.contentHash !== args.contentHash) {
    return {
      ok: true as const,
      skipped: "upstream-hash-mismatch" as const,
      currentContentHash: discovered?.contentHash,
    };
  }
  if (target.candidateId) {
    await ctx.runMutation(internal.githubSkillSync.upsertGitHubSkillCandidateContentInternal, {
      candidateId: target.candidateId,
      discovered,
      commit: target.skill.githubCurrentCommit,
    });
  }

  const staticScan = runStaticModerationScan({
    slug: target.skill.slug,
    displayName: target.skill.displayName,
    summary: target.skill.summary,
    frontmatter: parseFrontmatter(discovered.skillMarkdown),
    files: listGitHubSkillFiles(entries, discovered.path),
    fileContents: listGitHubSkillTextContents(entries, discovered.path),
  });
  const presentationIcon = iconForDiscoveredGitHubSkill(discovered);

  const prepared = (await ctx.runMutation(
    internal.securityScan.prepareGitHubSkillScanRequestInternal,
    {
      skillId: target.skill._id,
      contentHash: args.contentHash,
      commit: target.skill.githubCurrentCommit,
      ...(args.force ? { force: true } : {}),
      parsed: {
        frontmatter: parseFrontmatter(discovered.skillMarkdown),
        presentation: {
          displayName: discovered.displayName,
          ...(discovered.summary ? { summary: discovered.summary } : {}),
          ...(presentationIcon ? { icon: presentationIcon } : {}),
        },
      },
      staticScan,
    },
  )) as GitHubSkillVerificationResult | undefined;

  if (!prepared?.prepared || !prepared.requestId) {
    if (prepared?.reused && prepared.scanStatus) {
      await ctx.runMutation(internal.githubSkillSync.applyGitHubSkillVerificationResultInternal, {
        skillId: target.skill._id,
        contentHash: args.contentHash,
        githubSkillScanId: prepared.scanId,
        scanStatus: prepared.scanStatus,
      });
    }
    return (
      prepared ?? {
        ok: true as const,
        skipped: "scan-request-not-created" as const,
      }
    );
  }

  let chunkIndex = 0;
  await storeGitHubSkillScanFileChunks(ctx, entries, discovered.path, async (chunk) => {
    await ctx.runMutation(internal.securityScan.appendGitHubSkillScanRequestFilesInternal, {
      requestId: prepared.requestId as Id<"skillScanRequests">,
      chunkIndex,
      files: chunk,
    });
    chunkIndex += 1;
  });
  return (await ctx.runMutation(internal.securityScan.finalizeGitHubSkillScanRequestInternal, {
    requestId: prepared.requestId,
    ...(args.force ? { force: true } : {}),
  })) as typeof prepared;
}

export async function configurePublicGitHubSkillSourceHandler(
  ctx: ActionCtx,
  args: {
    ownerPublisherId: Id<"publishers">;
    repo: string;
    expectedSkillsShSource?: ExpectedSkillsShSource;
  },
  fetcher: typeof fetch = fetch,
  authOverride?: { userId: Id<"users"> },
): Promise<SyncOneResult> {
  if (args.expectedSkillsShSource) {
    const claimPolicy = getSkillsShFixtureEnvironmentPolicy();
    if (!claimPolicy.allowed) {
      throw new ConvexError("skills.sh claiming is enabled only in local development and Test");
    }
  }
  assertGitHubSkillSyncRuntimeEnabled();
  const actor = authOverride ?? (await requireUserFromAction(ctx));
  const metadata = await fetchPublicGitHubRepoMetadata(args.repo, fetcher);
  if (!metadata.repositoryId || !metadata.ownerId) {
    throw new ConvexError("GitHub repo identity lookup failed.");
  }
  const setup = (await ctx.runQuery(
    internal.githubSkillSync.getPublicGitHubSkillSourceSetupContextInternal,
    {
      ownerPublisherId: args.ownerPublisherId,
      actorUserId: actor.userId,
      repo: metadata.repo,
      githubRepositoryId: metadata.repositoryId,
      githubOwnerId: metadata.ownerId,
    },
  )) as GitHubSkillSourceSetupContext;
  const snapshot = await fetchGitHubSkillSourceSnapshot(
    ctx,
    {
      repo: metadata.repo,
      defaultBranch: metadata.defaultBranch,
    },
    fetcher,
  );
  const revalidatedMetadata = await revalidateGitHubRepoMetadata(metadata, fetcher);
  if (args.expectedSkillsShSource) {
    assertExactSkillsShSourceSelection(snapshot, args.expectedSkillsShSource);
  }
  if (snapshot.skills.length === 0) {
    throw new ConvexError("No skills were found in that public GitHub repo.");
  }
  const canonicalRepo = normalizeRepo(revalidatedMetadata.repo).toLowerCase();
  const skillsShClaimPath = args.expectedSkillsShSource
    ? normalizeRepoPath(args.expectedSkillsShSource.path)
    : undefined;
  return await applyFetchedGitHubSkillSourceSnapshot(ctx, {
    sourceId: setup.existingSource?._id,
    repo: canonicalRepo,
    ownerUserId: setup.ownerUserId,
    ownerPublisherId: args.ownerPublisherId,
    githubRepositoryId: revalidatedMetadata.repositoryId,
    githubOwnerId: revalidatedMetadata.ownerId,
    expectedSourceUpdatedAt: setup.existingSource?.updatedAt ?? null,
    ...(args.expectedSkillsShSource
      ? {
          skillsShClaim: {
            ...args.expectedSkillsShSource,
            path: normalizeRepoPath(args.expectedSkillsShSource.path),
          },
        }
      : {}),
    ...(skillsShClaimPath ? { skillsShClaimPath } : {}),
    snapshot,
  });
}

export const configurePublicGitHubSkillSource: ReturnType<typeof action> = action({
  args: {
    ownerPublisherId: v.id("publishers"),
    repo: v.string(),
    expectedSkillsShSource: v.optional(
      v.object({
        repo: v.string(),
        externalId: v.string(),
        path: v.string(),
        commit: v.string(),
        contentHash: v.string(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<SyncOneResult> =>
    configurePublicGitHubSkillSourceHandler(ctx, args),
});

async function applyFetchedGitHubSkillSourceSnapshot(
  ctx: ActionCtx,
  args: {
    sourceId?: Id<"githubSkillSources">;
    repo: string;
    ownerUserId: Id<"users">;
    ownerPublisherId?: Id<"publishers">;
    githubRepositoryId?: string;
    githubOwnerId?: string;
    expectedSourceUpdatedAt?: number | null;
    skillsShClaimPath?: string;
    skillsShClaim?: ExpectedSkillsShSource;
    snapshot: GitHubSkillSourceSnapshot;
  },
) {
  await persistGitHubSkillPresentationAssets(ctx, args.snapshot);
  const syncFunction = args.skillsShClaim
    ? (
        internal as unknown as {
          skillsShClaims: { applyClaimedGitHubSkillSourceSyncInternal: never };
        }
      ).skillsShClaims.applyClaimedGitHubSkillSourceSyncInternal
    : internal.githubSkillSync.applyGitHubSkillSourceSyncInternal;
  const result = (await ctx.runMutation(syncFunction, {
    sourceId: args.sourceId,
    repo: args.repo,
    ownerUserId: args.ownerUserId,
    ownerPublisherId: args.ownerPublisherId,
    githubRepositoryId: args.githubRepositoryId,
    githubOwnerId: args.githubOwnerId,
    expectedSourceUpdatedAt: args.expectedSourceUpdatedAt,
    ...(args.skillsShClaimPath ? { skillsShClaimPath: args.skillsShClaimPath } : {}),
    ...(args.skillsShClaim ? { skillsShClaim: args.skillsShClaim } : {}),
    snapshot: toGitHubSkillSourceMetadataSnapshot(args.snapshot),
  })) as SyncOneResult;
  if (result.skipped === "stale-source-observation") return result;
  await persistGitHubSkillContentsForSnapshot(ctx, result, args.snapshot);
  return result;
}

function toGitHubSkillSourceMetadataSnapshot(
  snapshot: GitHubSkillSourceSnapshot,
): GitHubSkillSourceMetadataSnapshot {
  return {
    ...snapshot,
    skills: snapshot.skills.map(
      ({
        skillMarkdown: _skillMarkdown,
        skillCardMarkdown: _skillCardMarkdown,
        iconBytes: _iconBytes,
        ...skill
      }) => skill,
    ),
  };
}

async function persistGitHubSkillPresentationAssets(
  ctx: ActionCtx,
  snapshot: GitHubSkillSourceSnapshot,
) {
  for (const skill of snapshot.skills) {
    if (!skill.iconAsset || !skill.iconBytes) continue;
    await storeSkillPresentationAsset(ctx, {
      bytes: skill.iconBytes,
      sha256: skill.iconAsset.sha256,
      contentType: skill.iconAsset.contentType as
        | "image/png"
        | "image/jpeg"
        | "image/webp"
        | "image/svg+xml",
    });
  }
}

function iconForDiscoveredGitHubSkill(
  discovered: GitHubSkillSourceMetadataSnapshot["skills"][number],
) {
  return discovered.iconAsset
    ? buildSkillPresentationIconPath(discovered.iconAsset.sha256)
    : undefined;
}

async function persistGitHubSkillContentsForSnapshot(
  ctx: ActionCtx,
  result: SyncOneResult,
  snapshot: GitHubSkillSourceSnapshot,
) {
  if (!result.sourceId) return;
  const targets = (await ctx.runQuery(
    internal.githubSkillSync.listGitHubSkillContentTargetsInternal,
    { sourceId: result.sourceId },
  )) as GitHubSkillContentTarget[];
  const targetByPath = new Map(targets.map((target) => [target.githubPath, target]));
  for (const discovered of snapshot.skills) {
    const target = targetByPath.get(discovered.path);
    if (!target || target.githubCurrentContentHash !== discovered.contentHash) continue;
    if (target.candidateId) {
      await ctx.runMutation(internal.githubSkillSync.upsertGitHubSkillCandidateContentInternal, {
        candidateId: target.candidateId,
        discovered,
        commit: snapshot.commit,
      });
      continue;
    }
    await ctx.runMutation(internal.githubSkillSync.upsertGitHubSkillContentInternal, {
      skillId: target.skillId,
      sourceId: result.sourceId,
      discovered,
      commit: snapshot.commit,
    });
  }
}

export const syncGitHubSkillSource: ReturnType<typeof action> = action({
  args: {
    repo: v.string(),
    ownerPublisherId: v.optional(v.id("publishers")),
    defaultBranch: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SyncOneResult | SyncDryRunResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertAdmin(user);

    const repo = normalizeRepo(args.repo);
    assertGenericGitHubSkillSyncEnabled(repo);
    const source = (await ctx.runQuery(internal.githubSkillSync.getSourceByRepoInternal, {
      repo,
    })) as SourceForSync | null;
    const ownerPublisherId = args.ownerPublisherId ?? source?.ownerPublisherId;
    if (!ownerPublisherId) throw new ConvexError("GitHub source must have an owner publisher");
    const ownerUserId = (await ctx.runQuery(
      internal.githubSkillSync.resolveOwnerUserIdForPublisherInternal,
      { publisherId: ownerPublisherId },
    )) as Id<"users">;
    const metadata = await fetchPublicGitHubRepoMetadata(repo, fetch);
    const snapshot = await fetchGitHubSkillSourceSnapshot(ctx, {
      repo,
      defaultBranch: args.defaultBranch ?? source?.defaultBranch ?? metadata.defaultBranch,
    });
    const revalidatedMetadata = isLegacyNvidiaSkillSource(repo)
      ? metadata
      : await revalidateGitHubRepoMetadata(metadata, fetch);

    if (args.dryRun) {
      return {
        ok: true as const,
        dryRun: true as const,
        repo: revalidatedMetadata.repo,
        sourceId: source?._id,
        commit: snapshot.commit,
        manifestStatus: snapshot.manifestStatus,
        discovered: snapshot.skills.length,
      };
    }

    return await applyFetchedGitHubSkillSourceSnapshot(ctx, {
      sourceId: source?._id,
      repo: revalidatedMetadata.repo,
      ownerUserId,
      ownerPublisherId,
      githubRepositoryId: revalidatedMetadata.repositoryId,
      githubOwnerId: revalidatedMetadata.ownerId,
      expectedSourceUpdatedAt: source?.updatedAt ?? null,
      snapshot,
    });
  },
});

export async function syncGitHubSkillSourcesHandler(
  ctx: ActionCtx,
  args: { cursor?: string | null; batchSize?: number },
  fetcher: typeof fetch = fetch,
): Promise<SyncManyResult> {
  const startedAt = Date.now();
  const batchSize = clampInt(
    args.batchSize ?? DEFAULT_SOURCE_SYNC_BATCH_SIZE,
    1,
    MAX_SOURCE_SYNC_BATCH_SIZE,
  );
  const genericEnabled = getRuntimeRolloutCapabilities().githubSkillSync.runtimeEnabled;
  logEvent(Events.GitHubSkillSourceSyncStarted, {
    startedAt,
    cursor: args.cursor ?? null,
  });
  const page = (await ctx.runQuery(internal.githubSkillSync.listSourcesForSyncInternal, {
    cursor: args.cursor ?? null,
    batchSize,
    legacyOnly: !genericEnabled,
  })) as SourceForSyncPage;
  const sources = page.sources;
  const results: SyncOneResult[] = [];
  let skipped = 0;
  let errors = 0;
  let skillsDiscovered = 0;
  let skillsChanged = 0;
  let skillsRemoved = 0;

  for (const source of sources) {
    if (!source.ownerPublisherId) {
      skipped += 1;
      await ctx.runMutation(internal.githubSkillSync.recordGitHubSkillSourceSyncAttemptInternal, {
        sourceId: source._id,
        status: "skipped",
      });
      continue;
    }
    try {
      const ownerUserId = (await ctx.runQuery(
        internal.githubSkillSync.resolveOwnerUserIdForPublisherInternal,
        { publisherId: source.ownerPublisherId },
      )) as Id<"users">;
      const metadata = await fetchPublicGitHubRepoMetadata(source.repo, fetcher);
      if (
        !isLegacyNvidiaSkillSource(source.repo) &&
        (!source.githubRepositoryId ||
          !source.githubOwnerId ||
          metadata.repositoryId !== source.githubRepositoryId ||
          metadata.ownerId !== source.githubOwnerId)
      ) {
        throw new ConvexError("GitHub repository authorization no longer matches.");
      }
      const snapshot = await fetchGitHubSkillSourceSnapshot(
        ctx,
        {
          repo: metadata.repo,
          defaultBranch: source.defaultBranch ?? metadata.defaultBranch,
        },
        fetcher,
      );
      const revalidatedMetadata = isLegacyNvidiaSkillSource(source.repo)
        ? metadata
        : await revalidateGitHubRepoMetadata(metadata, fetcher);
      const result = await applyFetchedGitHubSkillSourceSnapshot(ctx, {
        sourceId: source._id,
        repo: revalidatedMetadata.repo,
        ownerUserId,
        ownerPublisherId: source.ownerPublisherId,
        githubRepositoryId: revalidatedMetadata.repositoryId,
        githubOwnerId: revalidatedMetadata.ownerId,
        expectedSourceUpdatedAt: source.updatedAt,
        snapshot,
      });
      results.push(result);
      skillsDiscovered += result.stats.discovered;
      skillsChanged += result.stats.changed + result.stats.inserted;
      skillsRemoved += result.stats.removed;
    } catch (error) {
      const message = getErrorMessage(error);
      if (!isLegacyNvidiaSkillSource(source.repo) && isGitHubSourceAuthorizationFailure(message)) {
        await ctx.runMutation(
          internal.githubSkillSync.revokeGitHubSkillSourceAuthorizationInternal,
          {
            sourceId: source._id,
            error: message,
          },
        );
      } else {
        await ctx.runMutation(internal.githubSkillSync.recordGitHubSkillSourceSyncAttemptInternal, {
          sourceId: source._id,
          status: "failed",
          error: message,
        });
      }
      logErrorEvent(Events.GitHubSkillSourceSyncSourceFailed, {
        repo: source.repo,
        sourceId: source._id,
        error: message,
      });
      errors += 1;
    }
  }

  const finishedAt = Date.now();
  logEvent(Events.GitHubSkillSourceSyncCompleted, {
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    sourcesTotal: sources.length,
    sourcesSucceeded: results.length,
    sourcesFailed: errors,
    sourcesSkipped: skipped,
    skillsDiscovered,
    skillsChanged,
    skillsRemoved,
    isDone: page.isDone,
    nextCursor: page.continueCursor,
  });

  let scheduledNext = false;
  if (!page.isDone && page.continueCursor && ctx.scheduler) {
    await ctx.scheduler.runAfter(0, internal.githubSkillSyncNode.syncGitHubSkillSourcesInternal, {
      cursor: page.continueCursor,
      batchSize,
    });
    scheduledNext = true;
  }

  return {
    ok: true,
    synced: results.length,
    skipped,
    errors,
    cursor: page.continueCursor,
    isDone: page.isDone,
    scheduledNext,
    results,
  };
}

async function fetchGitHubSkillSourceSnapshot(
  ctx: Pick<ActionCtx, "runAction">,
  {
    repo,
    defaultBranch,
  }: {
    repo: string;
    defaultBranch: string;
  },
  fetcher: typeof fetch = fetch,
) {
  const { snapshot } = await fetchGitHubSkillSourceSnapshotWithEntries(
    ctx,
    {
      repo,
      ref: defaultBranch,
      defaultBranch,
    },
    fetcher,
  );
  return snapshot;
}

async function fetchGitHubSkillSourceSnapshotWithEntries(
  ctx: Pick<ActionCtx, "runAction">,
  {
    repo,
    ref,
    defaultBranch,
  }: {
    repo: string;
    ref: string;
    defaultBranch: string;
  },
  fetcher: typeof fetch = fetch,
) {
  const normalizedRepo = normalizeRepo(repo);
  const parsed = buildGitHubSourceImport(normalizedRepo, ref);
  const gitHubFetcher = buildGitHubSkillSourceFetch(fetcher);
  const resolved = await resolveGitHubCommit(parsed, gitHubFetcher);
  const zipBytes = await fetchGitHubZipBytes(resolved, gitHubFetcher);
  const entries = stripGitHubZipRoot(unzipToEntries(zipBytes));
  const snapshot = await buildGitHubSkillSourceSnapshot({
    repo: normalizedRepo,
    defaultBranch,
    commit: resolved.commit,
    entries,
    validateRasterIcon: (args) => isDecodableSkillPresentationRaster(ctx, args),
  });
  return { snapshot, entries };
}

function listGitHubSkillFiles(entries: Record<string, Uint8Array>, folderPath: string) {
  return listGitHubSkillFolderEntries(entries, folderPath).map(([path, bytes]) => ({
    path,
    size: bytes.byteLength,
  }));
}

function listGitHubSkillTextContents(entries: Record<string, Uint8Array>, folderPath: string) {
  const textFiles = [];
  for (const [path, bytes] of listGitHubSkillFolderEntries(entries, folderPath)) {
    if (textFiles.length >= MAX_STATIC_SCAN_TEXT_FILES) break;
    const content = decodeBoundedUtf8Text(bytes, MAX_STATIC_SCAN_TEXT_FILE_BYTES);
    if (content === null) continue;
    textFiles.push({
      path,
      content,
    });
  }
  return textFiles;
}

function listGitHubSkillFolderEntries(entries: Record<string, Uint8Array>, folderPath: string) {
  const root = folderPath ? `${folderPath}/` : "";
  return Object.entries(entries)
    .flatMap(([path, bytes]) => {
      if (root) {
        if (!path.startsWith(root)) return [];
        const relativePath = path.slice(root.length);
        return relativePath ? ([[relativePath, bytes]] as Array<[string, Uint8Array]>) : [];
      }
      if (path.includes("/")) return [];
      return [[path, bytes]] as Array<[string, Uint8Array]>;
    })
    .sort(([a], [b]) => a.localeCompare(b));
}

async function storeGitHubSkillScanFileChunks(
  ctx: Pick<ActionCtx, "storage">,
  entries: Record<string, Uint8Array>,
  folderPath: string,
  appendChunk: (
    files: Array<{
      path: string;
      size: number;
      storageId: Id<"_storage">;
      sha256: string;
    }>,
  ) => Promise<void>,
) {
  let pendingChunk: Array<{
    path: string;
    size: number;
    storageId: Id<"_storage">;
    sha256: string;
  }> = [];
  try {
    for (const [path, bytes] of listGitHubSkillFolderEntries(entries, folderPath)) {
      const safeBytes = new Uint8Array(bytes);
      const sha256 = await sha256Hex(safeBytes);
      const storageId = await ctx.storage.store(
        new Blob([safeBytes], { type: "application/octet-stream" }),
      );
      const file = {
        path,
        size: safeBytes.byteLength,
        storageId,
        sha256,
      };
      const nextPendingChunk = [...pendingChunk, file];
      let candidateChunks;
      try {
        candidateChunks = chunkSkillScanRequestFiles(nextPendingChunk);
      } catch (error) {
        pendingChunk = nextPendingChunk;
        throw error;
      }
      if (candidateChunks.length > 1) {
        try {
          await appendChunk(pendingChunk);
        } catch (error) {
          pendingChunk = nextPendingChunk;
          throw error;
        }
        pendingChunk = [file];
      } else {
        pendingChunk = candidateChunks[0] ?? [];
      }
    }
    if (pendingChunk.length > 0) {
      await appendChunk(pendingChunk);
    }
  } catch (error) {
    // Prior chunks are owned by the durable request; only this bounded chunk can be orphaned.
    await deleteStoredGitHubSkillScanFiles(ctx, pendingChunk);
    throw error;
  }
}

async function deleteStoredGitHubSkillScanFiles(
  ctx: Pick<ActionCtx, "storage">,
  files: Array<{ storageId: Id<"_storage"> }>,
) {
  await Promise.allSettled(files.map((file) => ctx.storage.delete(file.storageId)));
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildGitHubSourceImport(repo: string, defaultBranch: string): GitHubImportUrl {
  const normalizedRepo = normalizeRepo(repo);
  const [owner, repoName] = normalizedRepo.split("/") as [string, string];
  return {
    owner,
    repo: repoName,
    ref: defaultBranch,
    originalUrl: `https://github.com/${normalizedRepo}`,
  };
}

async function fetchPublicGitHubRepoMetadata(
  repo: string,
  fetcher: typeof fetch,
): Promise<GitHubRepoMetadata> {
  const normalizedRepo = normalizeRepo(repo);
  const [owner, repoName] = normalizedRepo.split("/") as [string, string];
  const response = await fetcher(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`,
    {
      headers: await buildGitHubSkillSourceHeaders(fetcher, true),
    },
  );
  if (!response.ok) {
    if (response.status === 404) throw new ConvexError(PUBLIC_REPO_ONLY_ERROR);
    throw new ConvexError("GitHub repo lookup failed.");
  }
  const body = (await response.json()) as Record<string, unknown>;
  const ownerData =
    body.owner && typeof body.owner === "object" ? (body.owner as Record<string, unknown>) : null;
  const repositoryId = normalizeGitHubNumericId(body.id);
  const ownerId = normalizeGitHubNumericId(ownerData?.id);
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const visibility = typeof body.visibility === "string" ? body.visibility : "";
  if (body.private !== false || (visibility && visibility !== "public")) {
    throw new ConvexError(PUBLIC_REPO_ONLY_ERROR);
  }
  if (body.disabled === true) throw new ConvexError("GitHub repo is disabled.");
  if ((!repositoryId || !ownerId) && !isLegacyNvidiaSkillSource(normalizedRepo)) {
    throw new ConvexError("GitHub repo identity lookup failed.");
  }
  const defaultBranch =
    typeof body.default_branch === "string" && body.default_branch.trim()
      ? body.default_branch.trim()
      : DEFAULT_BRANCH;
  return {
    ...(repositoryId ? { repositoryId } : {}),
    ...(ownerId ? { ownerId } : {}),
    repo: normalizeRepo(fullName || normalizedRepo),
    defaultBranch,
  };
}

function normalizeGitHubNumericId(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function isGitHubSourceAuthorizationFailure(message: string) {
  return (
    message.includes("GitHub repository authorization no longer matches") ||
    message.includes(PUBLIC_REPO_ONLY_ERROR) ||
    message.includes("GitHub repo is disabled")
  );
}

async function revalidateGitHubRepoMetadata(expected: GitHubRepoMetadata, fetcher: typeof fetch) {
  if (!expected.repositoryId || !expected.ownerId) {
    throw new ConvexError("GitHub repository authorization no longer matches.");
  }
  const current = await fetchPublicGitHubRepoMetadata(expected.repo, fetcher);
  if (current.repositoryId !== expected.repositoryId || current.ownerId !== expected.ownerId) {
    throw new ConvexError("GitHub repository authorization no longer matches.");
  }
  return current;
}

async function buildGitHubSkillSourceHeaders(
  fetcher: typeof fetch,
  useOAuthAppClientCredentials = false,
) {
  return await buildGitHubApiHeaders({
    userAgent: "clawhub/github-skill-source",
    fetchImpl: fetcher,
    // Installation tokens are repository-scoped and cannot reliably read an
    // arbitrary public repository selected by a publisher.
    useGitHubApp: false,
    useOAuthAppClientCredentials,
  });
}

function buildGitHubSkillSourceFetch(fetcher: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const hostname = getGitHubSkillSourceHostname(input);
    if (!hostname) return fetcher(input, init);
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(
      await buildGitHubSkillSourceHeaders(fetcher, hostname === "api.github.com"),
    )) {
      if (!headers.has(key)) headers.set(key, value);
    }
    return fetcher(input, { ...init, headers });
  }) as typeof fetch;
}

function getGitHubSkillSourceHostname(input: RequestInfo | URL) {
  const urlString =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    const url = new URL(urlString);
    return url.hostname === "api.github.com" || url.hostname === "codeload.github.com"
      ? url.hostname
      : null;
  } catch {
    return null;
  }
}

function unzipToEntries(zipBytes: Uint8Array) {
  const limits = createZipEntryLimitFilter();
  const entries = unzipSync(zipBytes, {
    filter: (file) => limits.accept(file),
  });
  const out: Record<string, Uint8Array> = {};
  let totalBytes = 0;
  for (const [rawPath, bytes] of Object.entries(entries)) {
    const normalizedPath = normalizeRepoPath(rawPath);
    if (!normalizedPath) throw new ConvexError("Repo archive contains an invalid path");
    if (!bytes) continue;
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_UNZIPPED_BYTES) throw new ConvexError("Repo archive is too large");
    out[normalizedPath] = new Uint8Array(bytes);
  }
  return out;
}

function createZipEntryLimitFilter() {
  let fileCount = 0;
  let totalBytes = 0;
  return {
    accept(file: UnzipFileInfo) {
      fileCount += 1;
      if (fileCount > MAX_FILE_COUNT) throw new ConvexError("Repo archive has too many files");
      if (file.name.endsWith("/")) return false;

      const normalizedPath = normalizeRepoPath(file.name);
      if (!normalizedPath) throw new ConvexError("Repo archive contains an invalid path");
      if (isMacJunkPath(normalizedPath)) return false;

      if (file.originalSize > MAX_SINGLE_FILE_BYTES) {
        throw new ConvexError("Repo archive contains a file that is too large");
      }
      totalBytes += file.originalSize;
      if (totalBytes > MAX_UNZIPPED_BYTES) throw new ConvexError("Repo archive is too large");
      return true;
    },
  };
}

async function adjustGlobalPublicCountForSkillChange(
  ctx: MutationCtx,
  previousSkill: Doc<"skills"> | null | undefined,
  nextSkill: Doc<"skills"> | null | undefined,
  now = Date.now(),
) {
  // Search digests and publisher stats are mutation-triggered in ./functions;
  // the global public skill count is intentionally explicit like normal skill mutations.
  const delta = getPublicSkillVisibilityDelta(previousSkill, nextSkill);
  if (delta === 0) return;
  await adjustGlobalPublicSkillsCount(ctx, delta, now);
}

async function resolveOwnerUserIdForPublisher(ctx: QueryCtx, publisherId: Id<"publishers">) {
  const publisher = await ctx.db.get(publisherId);
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
    throw new ConvexError("GitHub source owner publisher not found");
  }
  if (publisher.linkedUserId) return publisher.linkedUserId;

  const members = await ctx.db
    .query("publisherMembers")
    .withIndex("by_publisher", (q) => q.eq("publisherId", publisherId))
    .take(20);
  const owner =
    members.find((member) => member.role === "owner") ??
    members.find((member) => member.role === "admin") ??
    members[0];
  if (!owner) throw new ConvexError("GitHub source owner publisher has no usable owner user");
  return owner.userId;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

function normalizeRepo(value: string) {
  const trimmed = value
    .trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length !== 2) throw new ConvexError("GitHub repo must be owner/repo");
  return `${parts[0]}/${parts[1]}`;
}

function normalizeRepoPath(path: string) {
  if (path.includes("\u0000")) return "";
  const normalized = path
    .replaceAll("\\", "/")
    .trim()
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (!normalized) return "";
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return "";
  return segments.join("/");
}

function assertExactSkillsShSourceSelection(
  snapshot: GitHubSkillSourceSnapshot,
  expected: ExpectedSkillsShSource,
) {
  const repo = normalizeRepoOrNull(expected.repo);
  const externalSegments = expected.externalId.trim().toLowerCase().split("/").filter(Boolean);
  const path = normalizeRepoPath(expected.path);
  const commit = expected.commit.trim().toLowerCase();
  const contentHash = expected.contentHash.trim().toLowerCase();
  const expectedSlug = externalSegments.length === 3 ? externalSegments[2] : null;
  const matches = snapshot.skills.filter(
    (skill) => skill.path === path && skill.slug.toLowerCase() === expectedSlug,
  );
  if (
    !expectedSlug ||
    !repo ||
    snapshot.repo.trim().toLowerCase() !== repo ||
    !path ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    !/^[a-f0-9]{64}$/.test(contentHash) ||
    snapshot.commit.trim().toLowerCase() !== commit ||
    matches.length !== 1 ||
    matches[0]?.contentHash.trim().toLowerCase() !== contentHash
  ) {
    throw new ConvexError(
      "The GitHub source changed since this skills.sh listing was observed. Refresh the listing before claiming it.",
    );
  }
}

function normalizeRepoOrNull(value: string) {
  try {
    return normalizeRepo(value).toLowerCase();
  } catch {
    return null;
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as Partial<T>;
}

export const __test = {
  assertExactSkillsShSourceSelection,
  buildGitHubSkillSourceFetch,
  buildGitHubSourceImport,
  normalizeRepo,
  unzipToEntries,
};
