import { ConvexError, v } from "convex/values";
import { unzipSync, type UnzipFileInfo } from "fflate";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery } from "./functions";
import { assertAdmin, requireUserFromAction } from "./lib/access";
import { buildGitHubApiHeaders } from "./lib/githubAuth";
import {
  fetchGitHubZipBytes,
  type GitHubImportUrl,
  resolveGitHubCommit,
  stripGitHubZipRoot,
} from "./lib/githubImport";
import {
  buildGitHubSkillSourceSnapshot,
  buildGitHubSkillSyncPlan,
  type DiscoveredGitHubSkill,
  type DisplayManifestStatus,
  githubBackedSkillModeration,
  normalizeSelectedSkillPaths,
  type GitHubSkillScanStatus,
  type GitHubSkillSourceMetadataSnapshot,
  type GitHubSkillSourceSnapshot,
} from "./lib/githubSkillSync";
import { adjustGlobalPublicSkillsCount, getPublicSkillVisibilityDelta } from "./lib/globalStats";
import { runStaticModerationScan } from "./lib/moderationEngine";
import { Events, logErrorEvent, logEvent } from "./lib/observabilityEvents";
import { isOfficialPublisher } from "./lib/officialPublishers";
import { requirePublisherRole } from "./lib/publishers";
import { isMacJunkPath, isTextFile, parseFrontmatter } from "./lib/skills";
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
  "_id" | "repo" | "ownerPublisherId" | "defaultBranch" | "selectedSkillPaths"
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
  repo: string;
  defaultBranch: string;
};

type GitHubSkillSourceSetupContext = {
  ownerUserId: Id<"users">;
  existingSource: SourceForSync | null;
  official: boolean;
};

type GitHubSkillSourcePreview = {
  ok: true;
  repo: string;
  defaultBranch: string;
  commit: string;
  manifestStatus: DisplayManifestStatus;
  existingSourceId?: Id<"githubSkillSources">;
  selectedSkillPaths?: string[];
  skills: Array<{
    slug: string;
    displayName: string;
    summary?: string;
    path: string;
    skillCardMarkdownPath?: string;
    contentHash: string;
  }>;
};

type GitHubSkillVerificationTarget = {
  skill: Pick<Doc<"skills">, "_id" | "slug" | "displayName" | "summary"> & {
    githubPath: string;
    githubCurrentCommit: string;
    githubCurrentContentHash: string;
    githubCurrentStatus: "present";
  };
  source: Pick<Doc<"githubSkillSources">, "_id" | "repo" | "defaultBranch">;
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
  },
  handler: listSourcesForSyncHandler,
});

export async function listSourcesForSyncHandler(
  ctx: QueryCtx,
  args: { cursor?: string | null; batchSize?: number },
): Promise<SourceForSyncPage> {
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
    const skills = await ctx.db
      .query("skills")
      .withIndex("by_github_source", (q) => q.eq("githubSourceId", args.sourceId))
      .collect();
    return skills.flatMap((skill) => {
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
  },
  handler: async (ctx, args): Promise<GitHubSkillSourceSetupContext> => {
    const { publisher } = await requirePublisherRole(ctx, {
      publisherId: args.ownerPublisherId,
      userId: args.actorUserId,
      allowed: ["admin"],
    });
    const official = await isOfficialPublisher(ctx, publisher);
    const repo = normalizeRepo(args.repo);
    const existingSource = await ctx.db
      .query("githubSkillSources")
      .withIndex("by_repo", (q) => q.eq("repo", repo))
      .unique();
    if (
      existingSource?.ownerPublisherId &&
      existingSource.ownerPublisherId !== args.ownerPublisherId
    ) {
      throw new ConvexError("GitHub repo is already configured for another publisher.");
    }
    const ownerUserId = await resolveOwnerUserIdForPublisher(ctx, args.ownerPublisherId);
    return { ownerUserId, existingSource, official };
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

export const getGitHubSkillVerificationTargetInternal = internalQuery({
  args: { skillId: v.id("skills"), contentHash: v.string() },
  handler: async (ctx, args): Promise<GitHubSkillVerificationTarget | null> => {
    const skill = await ctx.db.get(args.skillId);
    if (
      !skill ||
      skill.installKind !== "github" ||
      skill.githubCurrentStatus !== "present" ||
      !skill.githubCurrentCommit ||
      !skill.githubCurrentContentHash ||
      skill.githubCurrentContentHash !== args.contentHash ||
      !skill.githubSourceId ||
      !skill.githubPath
    ) {
      return null;
    }
    const source = await ctx.db.get(skill.githubSourceId);
    if (!source) return null;
    return {
      skill: {
        _id: skill._id,
        slug: skill.slug,
        displayName: skill.displayName,
        summary: skill.summary,
        githubPath: skill.githubPath,
        githubCurrentCommit: skill.githubCurrentCommit,
        githubCurrentContentHash: skill.githubCurrentContentHash,
        githubCurrentStatus: skill.githubCurrentStatus,
      },
      source: {
        _id: source._id,
        repo: source.repo,
        defaultBranch: source.defaultBranch,
      },
    };
  },
});

export type ApplyGitHubSkillSourceSyncArgs = {
  sourceId?: Id<"githubSkillSources">;
  repo: string;
  ownerUserId: Id<"users">;
  ownerPublisherId?: Id<"publishers">;
  selectedSkillPaths?: string[];
  snapshot: GitHubSkillSourceMetadataSnapshot;
  now?: number;
};

export async function applyGitHubSkillSourceSyncHandler(
  ctx: MutationCtx,
  args: ApplyGitHubSkillSourceSyncArgs,
): Promise<SyncOneResult> {
  const now = args.now ?? Date.now();
  const repo = normalizeRepo(args.repo);
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
  const selectedSkillPaths =
    normalizeSelectedSkillPaths(args.selectedSkillPaths) ??
    normalizeSelectedSkillPaths(existingSource?.selectedSkillPaths);
  const sourceId =
    existingSource?._id ??
    (await ctx.db.insert(
      "githubSkillSources",
      stripUndefined({
        repo,
        ownerPublisherId: sourceOwnerPublisherId,
        selectedSkillPaths,
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
    selectedSkillPaths,
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

async function scheduleGitHubSkillVerification(
  ctx: MutationCtx,
  args: {
    skillId: Id<"skills">;
    contentHash: string;
    scanStatus: unknown;
    now: number;
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
  if (
    !skill ||
    skill.installKind !== "github" ||
    !skill.githubSourceId ||
    !skill.githubPath ||
    skill.githubCurrentStatus !== "present" ||
    !skill.githubCurrentCommit ||
    skill.githubCurrentContentHash !== args.contentHash
  ) {
    return;
  }
  const pendingScanInsert = {
    githubSourceId: skill.githubSourceId,
    commit: skill.githubCurrentCommit,
    path: skill.githubPath,
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
    selectedSkillPaths: v.optional(v.array(v.string())),
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
  if (!skill || skill.installKind !== "github") {
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
  args: {
    ownerPublisherId: Id<"publishers">;
    repo: string;
    selectedSkillPaths?: string[];
  },
  fetcher: typeof fetch = fetch,
  authOverride?: { userId: Id<"users"> },
): Promise<SyncOneResult> {
  const actor = authOverride ?? (await requireUserFromAction(ctx));
  const metadata = await fetchPublicGitHubRepoMetadata(args.repo, fetcher);
  const setup = (await ctx.runQuery(
    internal.githubSkillSync.getPublicGitHubSkillSourceSetupContextInternal,
    {
      ownerPublisherId: args.ownerPublisherId,
      actorUserId: actor.userId,
      repo: metadata.repo,
    },
  )) as GitHubSkillSourceSetupContext;
  if (!setup.official) {
    throw new ConvexError("GitHub source sync is only available for official publishers.");
  }
  const snapshot = await fetchGitHubSkillSourceSnapshot(
    {
      repo: metadata.repo,
      defaultBranch: metadata.defaultBranch,
    },
    fetcher,
  );
  if (snapshot.skills.length === 0) {
    throw new ConvexError("No skills were found in that public GitHub repo.");
  }
  const hasExplicitSelection = args.selectedSkillPaths !== undefined;
  const selectedSkillPaths = hasExplicitSelection
    ? normalizeSelectedSkillPaths(args.selectedSkillPaths)
    : normalizeSelectedSkillPaths(setup.existingSource?.selectedSkillPaths);
  if (hasExplicitSelection && !selectedSkillPaths) {
    throw new ConvexError("Select at least one skill before adding this repo.");
  }
  if (!setup.existingSource && !selectedSkillPaths && snapshot.skills.length > 1) {
    throw new ConvexError("Select at least one skill before adding this repo.");
  }
  if (selectedSkillPaths) {
    const discoveredPaths = new Set(snapshot.skills.map((skill) => skill.path));
    const missingPath = selectedSkillPaths.find((path) => !discoveredPaths.has(path));
    if (missingPath) {
      throw new ConvexError(`Selected GitHub skill is not present in the repo: ${missingPath}`);
    }
  }
  const effectiveSelectedSkillPaths =
    !setup.existingSource && !selectedSkillPaths
      ? [snapshot.skills[0]?.path as string]
      : selectedSkillPaths;
  return await applyFetchedGitHubSkillSourceSnapshot(ctx, {
    sourceId: setup.existingSource?._id,
    repo: metadata.repo,
    ownerUserId: setup.ownerUserId,
    ownerPublisherId: args.ownerPublisherId,
    selectedSkillPaths: effectiveSelectedSkillPaths,
    snapshot,
  });
}

export async function previewPublicGitHubSkillSourceHandler(
  ctx: ActionCtx,
  args: { ownerPublisherId: Id<"publishers">; repo: string },
  fetcher: typeof fetch = fetch,
  authOverride?: { userId: Id<"users"> },
): Promise<GitHubSkillSourcePreview> {
  const actor = authOverride ?? (await requireUserFromAction(ctx));
  const metadata = await fetchPublicGitHubRepoMetadata(args.repo, fetcher);
  const setup = (await ctx.runQuery(
    internal.githubSkillSync.getPublicGitHubSkillSourceSetupContextInternal,
    {
      ownerPublisherId: args.ownerPublisherId,
      actorUserId: actor.userId,
      repo: metadata.repo,
    },
  )) as GitHubSkillSourceSetupContext;
  if (!setup.official) {
    throw new ConvexError("GitHub source sync is only available for official publishers.");
  }
  const snapshot = await fetchGitHubSkillSourceSnapshot(
    { repo: metadata.repo, defaultBranch: metadata.defaultBranch },
    fetcher,
  );
  if (snapshot.skills.length === 0) {
    throw new ConvexError("No skills were found in that public GitHub repo.");
  }
  return {
    ok: true,
    repo: metadata.repo,
    defaultBranch: metadata.defaultBranch,
    commit: snapshot.commit,
    manifestStatus: snapshot.manifestStatus,
    existingSourceId: setup.existingSource?._id,
    selectedSkillPaths: normalizeSelectedSkillPaths(setup.existingSource?.selectedSkillPaths),
    skills: snapshot.skills.map(
      ({ skillMarkdown: _skillMarkdown, skillCardMarkdown: _skillCardMarkdown, ...skill }) => skill,
    ),
  };
}

export const configurePublicGitHubSkillSource: ReturnType<typeof action> = action({
  args: {
    ownerPublisherId: v.id("publishers"),
    repo: v.string(),
    selectedSkillPaths: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<SyncOneResult> =>
    configurePublicGitHubSkillSourceHandler(ctx, args),
});

export const previewPublicGitHubSkillSource: ReturnType<typeof action> = action({
  args: {
    ownerPublisherId: v.id("publishers"),
    repo: v.string(),
  },
  handler: async (ctx, args): Promise<GitHubSkillSourcePreview> =>
    previewPublicGitHubSkillSourceHandler(ctx, args),
});

async function applyFetchedGitHubSkillSourceSnapshot(
  ctx: ActionCtx,
  args: {
    sourceId?: Id<"githubSkillSources">;
    repo: string;
    ownerUserId: Id<"users">;
    ownerPublisherId?: Id<"publishers">;
    selectedSkillPaths?: string[];
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
      ...(args.selectedSkillPaths ? { selectedSkillPaths: args.selectedSkillPaths } : {}),
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

    if (args.dryRun) {
      return {
        ok: true as const,
        dryRun: true as const,
        repo,
        sourceId: source?._id,
        commit: snapshot.commit,
        manifestStatus: snapshot.manifestStatus,
        discovered: snapshot.skills.length,
      };
    }

    return await applyFetchedGitHubSkillSourceSnapshot(ctx, {
      sourceId: source?._id,
      repo,
      ownerUserId,
      ownerPublisherId,
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
  logEvent(Events.GitHubSkillSourceSyncStarted, { startedAt, cursor: args.cursor ?? null });
  const page = (await ctx.runQuery(internal.githubSkillSync.listSourcesForSyncInternal, {
    cursor: args.cursor ?? null,
    batchSize,
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
      const snapshot = await fetchGitHubSkillSourceSnapshot(
        {
          repo: source.repo,
          defaultBranch: source.defaultBranch ?? metadata.defaultBranch,
        },
        fetcher,
      );
      const result = await applyFetchedGitHubSkillSourceSnapshot(ctx, {
        sourceId: source._id,
        repo: source.repo,
        ownerUserId,
        ownerPublisherId: source.ownerPublisherId,
        snapshot,
      });
      results.push(result);
      skillsDiscovered += result.stats.discovered;
      skillsChanged += result.stats.changed + result.stats.inserted;
      skillsRemoved += result.stats.removed;
    } catch (error) {
      const message = getErrorMessage(error);
      await ctx.runMutation(internal.githubSkillSync.recordGitHubSkillSourceSyncAttemptInternal, {
        sourceId: source._id,
        status: "failed",
        error: message,
      });
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
    if (!isTextFile(path, undefined)) continue;
    textFiles.push({
      path,
      content: new TextDecoder().decode(bytes.slice(0, MAX_STATIC_SCAN_TEXT_FILE_BYTES)),
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
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const visibility = typeof body.visibility === "string" ? body.visibility : "";
  if (body.private !== false || (visibility && visibility !== "public")) {
    throw new ConvexError(PUBLIC_REPO_ONLY_ERROR);
  }
  if (body.disabled === true) throw new ConvexError("GitHub repo is disabled.");
  const defaultBranch =
    typeof body.default_branch === "string" && body.default_branch.trim()
      ? body.default_branch.trim()
      : DEFAULT_BRANCH;
  return {
    repo: normalizeRepo(fullName || normalizedRepo),
    defaultBranch,
  };
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
