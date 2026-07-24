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
import { isMacJunkPath, parseFrontmatter } from "./lib/skills";
import {
  getSkillBySlugForPublisher,
  getSkillSlugAliasBySlugForPublisher,
} from "./lib/skills/slugResolution";
import { chunkSkillScanRequestFiles } from "./lib/skillScanRequestFiles";
import { syncSkillSearchDigestForSkill } from "./lib/skillSearchDigest";
import { assertValidSkillSlug } from "./lib/skillSlugValidator";

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
  "_id" | "repo" | "ownerPublisherId" | "githubRepositoryId" | "githubOwnerId" | "defaultBranch"
>;

type SourceForSyncPage = {
  sources: SourceForSync[];
  continueCursor: string | null;
  isDone: boolean;
};

type SyncOneResult = {
  ok: true;
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
  contentHash: v.string(),
});

const sourceSnapshotValidator = v.object({
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

export const getArchiveScanBySkillAndContentHashInternal = internalQuery({
  args: {
    skillId: v.id("skills"),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("githubSkillScans")
      .withIndex("by_skill_and_content_hash", (q) =>
        q.eq("skillId", args.skillId).eq("contentHash", args.contentHash),
      )
      .unique();
  },
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
    const [skills, candidates] = await Promise.all([
      ctx.db
        .query("skills")
        .withIndex("by_github_source", (q) => q.eq("githubSourceId", args.sourceId))
        .collect(),
      ctx.db
        .query("githubSkillCandidates")
        .withIndex("by_github_source", (q) => q.eq("githubSourceId", args.sourceId))
        .collect(),
    ]);
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
    const candidateTargets = candidates.map((candidate) => ({
      skillId: candidate.skillId,
      githubPath: candidate.githubPath,
      githubCurrentContentHash: candidate.githubContentHash,
      candidateId: candidate._id,
    }));
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

export async function revokeGitHubSkillSourceAuthorizationHandler(
  ctx: MutationCtx,
  args: { sourceId: Id<"githubSkillSources">; error: string; now?: number },
) {
  const source = await ctx.db.get(args.sourceId);
  if (!source || isLegacyNvidiaSkillSource(source.repo)) {
    return { ok: true as const, skipped: "missing-or-legacy-source" as const };
  }
  const now = args.now ?? Date.now();
  const candidates = await ctx.db
    .query("githubSkillCandidates")
    .withIndex("by_github_source", (q) => q.eq("githubSourceId", source._id))
    .collect();
  for (const candidate of candidates) {
    const skill = await ctx.db.get(candidate.skillId);
    if (skill?.githubPendingCandidateId === candidate._id) {
      await ctx.db.patch(skill._id, {
        githubPendingCandidateId: undefined,
        updatedAt: now,
      });
    }
    await ctx.db.delete(candidate._id);
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
        repo: source.repo,
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
      const nextSkillSnapshot = { ...previousSkillSnapshot, ...skillPatch.patch };
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
      const nextSkillSnapshot = { ...previousSkillSnapshot, ...patch } as Doc<"skills">;
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
    const insertedSkill = { ...doc, _id: skillId, _creationTime: now } as Doc<"skills">;
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
    existingSource?.ownerPublisherId &&
    existingSource.ownerPublisherId !== args.ownerPublisherId
  ) {
    throw new ConvexError("GitHub source is already configured for another publisher.");
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
  const publisher = await ctx.db.get(args.ownerPublisherId);
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
    throw new ConvexError("GitHub source owner publisher not found.");
  }
  await ctx.db.patch(sourceId, {
    repo: args.repo,
    ownerPublisherId: args.ownerPublisherId,
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
    updatedAt: args.now,
  });

  const sourceSkills = await ctx.db
    .query("skills")
    .withIndex("by_github_source", (q) => q.eq("githubSourceId", sourceId))
    .collect();
  const sourceCandidates = await ctx.db
    .query("githubSkillCandidates")
    .withIndex("by_github_source", (q) => q.eq("githubSourceId", sourceId))
    .collect();
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
        ownerUserId: args.ownerUserId,
        ownerPublisherId: args.ownerPublisherId,
        installKind: "github",
        githubSourceId: sourceId,
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
      await scheduleGitHubSkillVerification(ctx, {
        skillId,
        contentHash: discovered.contentHash,
        scanStatus: "pending",
        now: args.now,
      });
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

    if (skill.softDeletedAt && !canAutoReviveGitHubSkill(skill)) {
      stats.unchanged += 1;
      continue;
    }

    if (sameCurrentContent) {
      const previousSkill = { ...skill };
      const patch = {
        displayName: discovered.displayName,
        summary: discovered.summary,
        ownerUserId: args.ownerUserId,
        ownerPublisherId: args.ownerPublisherId,
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

    if (hasAllowedGitHubSource || hasAllowedHostedSource) {
      const candidateId = await upsertGitHubSkillCandidate(ctx, {
        skill,
        sourceId,
        discovered,
        commit: args.snapshot.commit,
        now: args.now,
      });
      matchedCandidateIds.add(candidateId);
      stats.changed += 1;
      continue;
    }

    const previousSkill = { ...skill };
    if (skill.githubPendingCandidateId) {
      await ctx.db.delete(skill.githubPendingCandidateId);
    }
    const moderation = githubBackedSkillModeration("pending");
    const patch = {
      displayName: discovered.displayName,
      summary: discovered.summary,
      ownerUserId: args.ownerUserId,
      ownerPublisherId: args.ownerPublisherId,
      installKind: "github" as const,
      githubSourceId: sourceId,
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
    await scheduleGitHubSkillVerification(ctx, {
      skillId: skill._id,
      contentHash: discovered.contentHash,
      scanStatus: "pending",
      now: args.now,
    });
    if (skill.softDeletedAt) stats.revived += 1;
    else stats.changed += 1;
  }

  for (const skill of sourceSkills) {
    if (matchedSkillIds.has(skill._id)) continue;
    const previousSkill = { ...skill };
    if (skill.githubPendingCandidateId) await ctx.db.delete(skill.githubPendingCandidateId);
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
    }
    await ctx.db.delete(candidate._id);
  }

  await ctx.db.patch(sourceId, {
    lastSyncIssues: issues,
    lastSyncInvalidSkills: invalidSkills,
    updatedAt: args.now,
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
    discovered: GitHubSkillSourceMetadataSnapshot["skills"][number];
    commit: string;
    now: number;
  },
) {
  const existing = args.skill.githubPendingCandidateId
    ? await ctx.db.get(args.skill.githubPendingCandidateId)
    : await ctx.db
        .query("githubSkillCandidates")
        .withIndex("by_skill", (q) => q.eq("skillId", args.skill._id))
        .unique();
  const reusableScan = await ctx.db
    .query("githubSkillScans")
    .withIndex("by_skill_and_content_hash", (q) =>
      q.eq("skillId", args.skill._id).eq("contentHash", args.discovered.contentHash),
    )
    .unique();
  const scanStatus = reusableScan?.status ?? "pending";
  const doc = {
    skillId: args.skill._id,
    githubSourceId: args.sourceId,
    githubPath: args.discovered.path,
    githubHasSkillCard: Boolean(args.discovered.skillCardMarkdownPath),
    githubCommit: args.commit,
    githubContentHash: args.discovered.contentHash,
    displayName: args.discovered.displayName,
    summary: args.discovered.summary,
    upstreamVersion: args.discovered.upstreamVersion,
    skillMarkdownPath: undefined,
    skillMarkdown: undefined,
    skillCardMarkdownPath: undefined,
    skillCardMarkdown: undefined,
    scanStatus,
    updatedAt: args.now,
  };
  let candidateId: Id<"githubSkillCandidates">;
  if (existing) {
    candidateId = existing._id;
    await ctx.db.patch(existing._id, doc);
  } else {
    candidateId = await ctx.db.insert("githubSkillCandidates", {
      ...stripUndefined(doc),
      createdAt: args.now,
    } as Omit<Doc<"githubSkillCandidates">, "_id" | "_creationTime">);
  }
  await ctx.db.patch(args.skill._id, {
    githubPendingCandidateId: candidateId,
    updatedAt: args.now,
  });
  if (scanStatus === "pending" || scanStatus === "clean" || scanStatus === "suspicious") {
    await scheduleGitHubSkillVerification(ctx, {
      skillId: args.skill._id,
      contentHash: args.discovered.contentHash,
      scanStatus,
      now: args.now,
      candidateId,
    });
  }
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
) {
  const scan = await ctx.db
    .query("githubSkillScans")
    .withIndex("by_skill_and_content_hash", (q) =>
      q.eq("skillId", args.skillId).eq("contentHash", args.contentHash),
    )
    .unique();
  if (args.scanStatus !== "pending") {
    if (scan?.status !== "pending") {
      if (scan) return;
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
    if (job?.status === "queued" || job?.status === "running") return;
    if (request && request.updatedAt > args.now - GITHUB_SKILL_SCAN_ACTION_LEASE_MS) return;
  }
  if (
    scan?.status === "pending" &&
    !scan.skillScanRequestId &&
    scan.updatedAt > args.now - GITHUB_SKILL_SCAN_ACTION_LEASE_MS
  ) {
    return;
  }
  const skill = await ctx.db.get(args.skillId);
  if (!skill) return;
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
  if (!target) return;
  const pendingScanInsert = {
    githubSourceId: target.sourceId,
    commit: target.commit,
    path: target.path,
    status: "pending" as const,
    updatedAt: args.now,
  };
  if (scan) {
    await ctx.db.patch(scan._id, {
      ...pendingScanInsert,
      skillScanRequestId: undefined,
    });
  } else {
    await ctx.db.insert("githubSkillScans", {
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
}

export const applyGitHubSkillSourceSyncInternal = internalMutation({
  args: {
    sourceId: v.optional(v.id("githubSkillSources")),
    repo: v.string(),
    ownerUserId: v.id("users"),
    ownerPublisherId: v.optional(v.id("publishers")),
    githubRepositoryId: v.optional(v.string()),
    githubOwnerId: v.optional(v.string()),
    snapshot: sourceSnapshotValidator,
    now: v.optional(v.number()),
  },
  handler: applyGitHubSkillSourceSyncHandler,
});

export type ApplyGitHubSkillVerificationResultArgs = {
  skillId: Id<"skills">;
  contentHash: string;
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
    const now = args.now ?? Date.now();
    await ctx.db.patch(candidate._id, {
      scanStatus: args.scanStatus,
      updatedAt: now,
    });
    if (args.scanStatus !== "clean" && args.scanStatus !== "suspicious") {
      return { ok: true as const, promoted: false };
    }
    if (!candidate.skillMarkdown || !candidate.skillMarkdownPath) {
      return { ok: true as const, skipped: "candidate-content-not-cached" as const };
    }
    if (
      skill.softDeletedAt ||
      skill.moderationStatus === "hidden" ||
      skill.moderationStatus === "removed"
    ) {
      return { ok: true as const, skipped: "skill-no-longer-eligible" as const };
    }
    const previousSkill = { ...skill };
    const moderation = githubBackedSkillModeration(args.scanStatus);
    const patch = {
      displayName: candidate.displayName,
      summary: candidate.summary,
      installKind: "github" as const,
      githubSourceId: candidate.githubSourceId,
      githubPath: candidate.githubPath,
      githubHasSkillCard: candidate.githubHasSkillCard,
      githubCurrentCommit: candidate.githubCommit,
      githubCurrentContentHash: candidate.githubContentHash,
      githubCurrentStatus: "present" as const,
      githubCurrentCheckedAt: now,
      githubScanStatus: args.scanStatus,
      githubRemovedAt: undefined,
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
    await ctx.db.patch(skill._id, patch);
    const nextSkill = { ...previousSkill, ...patch };
    await syncSkillSearchDigestForSkill(ctx, nextSkill);
    await adjustGlobalPublicCountForSkillChange(ctx, previousSkill, nextSkill, now);
    await ctx.db.delete(candidate._id);
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

  const prepared = (await ctx.runMutation(
    internal.securityScan.prepareGitHubSkillScanRequestInternal,
    {
      skillId: target.skill._id,
      contentHash: args.contentHash,
      commit: target.skill.githubCurrentCommit,
      ...(args.force ? { force: true } : {}),
      parsed: { frontmatter: parseFrontmatter(discovered.skillMarkdown) },
      staticScan,
    },
  )) as GitHubSkillVerificationResult | undefined;

  if (!prepared?.prepared || !prepared.requestId) {
    if (prepared?.reused && prepared.scanStatus) {
      await ctx.runMutation(internal.githubSkillSync.applyGitHubSkillVerificationResultInternal, {
        skillId: target.skill._id,
        contentHash: args.contentHash,
        scanStatus: prepared.scanStatus,
      });
    }
    return prepared ?? { ok: true as const, skipped: "scan-request-not-created" as const };
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
  args: { ownerPublisherId: Id<"publishers">; repo: string },
  fetcher: typeof fetch = fetch,
  authOverride?: { userId: Id<"users"> },
): Promise<SyncOneResult> {
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
    {
      repo: metadata.repo,
      defaultBranch: metadata.defaultBranch,
    },
    fetcher,
  );
  const revalidatedMetadata = await revalidateGitHubRepoMetadata(metadata, fetcher);
  if (snapshot.skills.length === 0) {
    throw new ConvexError("No skills were found in that public GitHub repo.");
  }
  return await applyFetchedGitHubSkillSourceSnapshot(ctx, {
    sourceId: setup.existingSource?._id,
    repo: revalidatedMetadata.repo,
    ownerUserId: setup.ownerUserId,
    ownerPublisherId: args.ownerPublisherId,
    githubRepositoryId: revalidatedMetadata.repositoryId,
    githubOwnerId: revalidatedMetadata.ownerId,
    snapshot,
  });
}

export const configurePublicGitHubSkillSource: ReturnType<typeof action> = action({
  args: {
    ownerPublisherId: v.id("publishers"),
    repo: v.string(),
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
    snapshot: GitHubSkillSourceSnapshot;
  },
) {
  const result = (await ctx.runMutation(
    internal.githubSkillSync.applyGitHubSkillSourceSyncInternal,
    {
      sourceId: args.sourceId,
      repo: args.repo,
      ownerUserId: args.ownerUserId,
      ownerPublisherId: args.ownerPublisherId,
      githubRepositoryId: args.githubRepositoryId,
      githubOwnerId: args.githubOwnerId,
      snapshot: toGitHubSkillSourceMetadataSnapshot(args.snapshot),
    },
  )) as SyncOneResult;
  await persistGitHubSkillContentsForSnapshot(ctx, result, args.snapshot);
  return result;
}

function toGitHubSkillSourceMetadataSnapshot(
  snapshot: GitHubSkillSourceSnapshot,
): GitHubSkillSourceMetadataSnapshot {
  return {
    ...snapshot,
    skills: snapshot.skills.map(
      ({ skillMarkdown: _skillMarkdown, skillCardMarkdown: _skillCardMarkdown, ...skill }) => skill,
    ),
  };
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
    const snapshot = await fetchGitHubSkillSourceSnapshot({
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
  logEvent(Events.GitHubSkillSourceSyncStarted, { startedAt, cursor: args.cursor ?? null });
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
      headers: await buildGitHubSkillSourceHeaders(fetcher),
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

async function buildGitHubSkillSourceHeaders(fetcher: typeof fetch) {
  return await buildGitHubApiHeaders({
    userAgent: "clawhub/github-skill-source",
    fetchImpl: fetcher,
  });
}

function buildGitHubSkillSourceFetch(fetcher: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!shouldAttachGitHubSkillSourceHeaders(input)) return fetcher(input, init);
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(await buildGitHubSkillSourceHeaders(fetcher))) {
      if (!headers.has(key)) headers.set(key, value);
    }
    return fetcher(input, { ...init, headers });
  }) as typeof fetch;
}

function shouldAttachGitHubSkillSourceHeaders(input: RequestInfo | URL) {
  const urlString =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    const url = new URL(urlString);
    return url.hostname === "api.github.com" || url.hostname === "codeload.github.com";
  } catch {
    return false;
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

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as Partial<T>;
}

export const __test = {
  buildGitHubSkillSourceFetch,
  buildGitHubSourceImport,
  normalizeRepo,
  unzipToEntries,
};
