import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { requireUser } from "./lib/access";
import { deleteGitHubSkillScansForSource } from "./lib/githubSkillScans";
import { adjustGlobalPublicSkillsCount, getPublicSkillVisibilityDelta } from "./lib/globalStats";
import { isOfficialPublisher } from "./lib/officialPublishers";
import {
  getPersonalPublisherForUserOrFallback,
  isPublisherActive,
  isPublisherRoleAllowed,
  requirePublisherRole,
} from "./lib/publishers";
import {
  assertGenericGitHubSkillSyncEnabled,
  getRuntimeRolloutCapabilities,
  isLegacyNvidiaSkillSource,
} from "./lib/rolloutCapabilities";
import { syncSkillSearchDigestForSkill } from "./lib/skillSearchDigest";

const GITHUB_SKILL_SCAN_CLEANUP_BATCH_SIZE = 25;

type PublicGitHubSkillSource = Pick<
  Doc<"githubSkillSources">,
  | "_id"
  | "repo"
  | "defaultBranch"
  | "lastSyncStatus"
  | "lastSyncError"
  | "lastSyncErrorAt"
  | "displayManifestStatus"
  | "displayManifestFetchedAt"
  | "displayManifestCommit"
  | "lastSyncIssues"
  | "lastSyncInvalidSkills"
  | "createdAt"
  | "updatedAt"
> & {
  ownerPublisher: Pick<Doc<"publishers">, "_id" | "handle" | "displayName"> | null;
  skills: Array<
    Pick<Doc<"skills">, "_id" | "slug" | "displayName" | "githubPath" | "githubCurrentStatus">
  >;
};

export const getByIdInternal = internalQuery({
  args: { sourceId: v.id("githubSkillSources") },
  handler: async (ctx, args) => ctx.db.get(args.sourceId),
});

async function toPublicGitHubSkillSource(
  ctx: Pick<QueryCtx, "db">,
  source: Doc<"githubSkillSources">,
): Promise<PublicGitHubSkillSource> {
  const skills = await ctx.db
    .query("skills")
    .withIndex("by_github_source", (q) => q.eq("githubSourceId", source._id))
    .collect();
  const visibleGitHubSkills = skills
    .filter((skill) => skill.installKind === "github" && !skill.softDeletedAt)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((skill) => ({
      _id: skill._id,
      slug: skill.slug,
      displayName: skill.displayName,
      githubPath: skill.githubPath,
      githubCurrentStatus: skill.githubCurrentStatus,
    }));
  const ownerPublisher = source.ownerPublisherId ? await ctx.db.get(source.ownerPublisherId) : null;

  return {
    _id: source._id as Id<"githubSkillSources">,
    repo: source.repo,
    ownerPublisher: ownerPublisher
      ? {
          _id: ownerPublisher._id,
          handle: ownerPublisher.handle,
          displayName: ownerPublisher.displayName,
        }
      : null,
    defaultBranch: source.defaultBranch,
    lastSyncStatus: source.lastSyncStatus,
    lastSyncError: source.lastSyncError,
    lastSyncErrorAt: source.lastSyncErrorAt,
    displayManifestStatus: source.displayManifestStatus,
    displayManifestFetchedAt: source.displayManifestFetchedAt,
    displayManifestCommit: source.displayManifestCommit,
    lastSyncIssues: source.lastSyncIssues,
    lastSyncInvalidSkills: source.lastSyncInvalidSkills,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    skills: visibleGitHubSkills,
  };
}

export const listForPublisher = query({
  args: { ownerPublisherId: v.id("publishers") },
  handler: async (ctx, args): Promise<PublicGitHubSkillSource[]> => {
    const { userId } = await requireUser(ctx);
    await requirePublisherRole(ctx, {
      publisherId: args.ownerPublisherId,
      userId,
      allowed: ["admin"],
    });
    const sources = await ctx.db
      .query("githubSkillSources")
      .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", args.ownerPublisherId))
      .collect();
    const visibleSources = getRuntimeRolloutCapabilities().githubSkillSync.runtimeEnabled
      ? sources
      : sources.filter((source) => isLegacyNvidiaSkillSource(source.repo));
    const sortedSources = visibleSources.sort((a, b) => b.updatedAt - a.updatedAt);
    return await Promise.all(sortedSources.map((source) => toPublicGitHubSkillSource(ctx, source)));
  },
});

export const listForManageableOfficialPublishers = query({
  args: {},
  handler: async (ctx): Promise<PublicGitHubSkillSource[]> => {
    const { userId, user } = await requireUser(ctx);
    const memberships = await ctx.db
      .query("publisherMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const ownerPublisherIds = new Set<Id<"publishers">>();
    for (const membership of memberships) {
      if (!isPublisherRoleAllowed(membership.role, ["admin"])) continue;
      const publisher = await ctx.db.get(membership.publisherId);
      if (
        !publisher ||
        !isPublisherActive(publisher) ||
        !(await isOfficialPublisher(ctx, publisher))
      ) {
        continue;
      }
      ownerPublisherIds.add(publisher._id);
    }
    const personalPublisher = await getPersonalPublisherForUserOrFallback(ctx, user);
    if (
      personalPublisher &&
      isPublisherActive(personalPublisher) &&
      (await isOfficialPublisher(ctx, personalPublisher))
    ) {
      ownerPublisherIds.add(personalPublisher._id);
    }
    const sourceGroups = await Promise.all(
      [...ownerPublisherIds].map((ownerPublisherId) =>
        ctx.db
          .query("githubSkillSources")
          .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", ownerPublisherId))
          .collect(),
      ),
    );
    const sources = sourceGroups.flat();
    const visibleSources = getRuntimeRolloutCapabilities().githubSkillSync.runtimeEnabled
      ? sources
      : sources.filter((source) => isLegacyNvidiaSkillSource(source.repo));
    const sortedSources = visibleSources.sort((a, b) => b.updatedAt - a.updatedAt);
    return await Promise.all(sortedSources.map((source) => toPublicGitHubSkillSource(ctx, source)));
  },
});

export async function deleteForPublisherHandler(
  ctx: MutationCtx,
  args: {
    ownerPublisherId: Id<"publishers">;
    sourceId: Id<"githubSkillSources">;
    now?: number;
  },
) {
  const { userId } = await requireUser(ctx);
  await requirePublisherRole(ctx, {
    publisherId: args.ownerPublisherId,
    userId,
    allowed: ["admin"],
  });

  const source = await ctx.db.get(args.sourceId);
  if (!source || source.ownerPublisherId !== args.ownerPublisherId) {
    throw new ConvexError("GitHub source not found.");
  }
  assertGenericGitHubSkillSyncEnabled(source.repo);

  const now = args.now ?? Date.now();
  const contents = await ctx.db
    .query("githubSkillContents")
    .withIndex("by_github_source", (q) => q.eq("githubSourceId", args.sourceId))
    .collect();
  for (const content of contents) {
    await ctx.db.delete(content._id);
  }
  await ctx.scheduler.runAfter(0, internal.githubSkillSources.cleanupDeletedSourceScansInternal, {
    sourceId: args.sourceId,
  });

  const skills = await ctx.db
    .query("skills")
    .withIndex("by_github_source", (q) => q.eq("githubSourceId", args.sourceId))
    .collect();
  let deletedSkills = 0;
  let publicSkillDelta = 0;
  for (const skill of skills) {
    if (skill.installKind !== "github") continue;

    const nextSkill: Doc<"skills"> = {
      ...skill,
      softDeletedAt: skill.softDeletedAt ?? now,
      githubCurrentStatus: "missing",
      githubRemovedAt: skill.githubRemovedAt ?? now,
      updatedAt: now,
    };
    publicSkillDelta += getPublicSkillVisibilityDelta(skill, nextSkill);
    await ctx.db.patch(skill._id, {
      softDeletedAt: nextSkill.softDeletedAt,
      githubCurrentStatus: nextSkill.githubCurrentStatus,
      githubRemovedAt: nextSkill.githubRemovedAt,
      updatedAt: now,
    });
    await syncSkillSearchDigestForSkill(ctx, nextSkill);
    deletedSkills += 1;
  }

  if (publicSkillDelta !== 0) {
    await adjustGlobalPublicSkillsCount(ctx, publicSkillDelta, now);
  }
  await ctx.db.delete(args.sourceId);

  return { ok: true as const, deletedSkills };
}

export async function cleanupDeletedSourceScansHandler(
  ctx: MutationCtx,
  args: { sourceId: Id<"githubSkillSources"> },
) {
  const deleted = await deleteGitHubSkillScansForSource(
    ctx,
    args.sourceId,
    GITHUB_SKILL_SCAN_CLEANUP_BATCH_SIZE,
  );
  const done = deleted < GITHUB_SKILL_SCAN_CLEANUP_BATCH_SIZE;
  if (deleted > 0) {
    await ctx.scheduler.runAfter(0, internal.securityScan.pruneExpiredSkillScanRequestsInternal, {
      batchSize: 10,
    });
  }
  if (!done) {
    await ctx.scheduler.runAfter(
      0,
      internal.githubSkillSources.cleanupDeletedSourceScansInternal,
      args,
    );
  }
  return { ok: true as const, deleted, done };
}

export const cleanupDeletedSourceScansInternal = internalMutation({
  args: { sourceId: v.id("githubSkillSources") },
  handler: cleanupDeletedSourceScansHandler,
});

export const deleteForPublisher: ReturnType<typeof mutation> = mutation({
  args: {
    ownerPublisherId: v.id("publishers"),
    sourceId: v.id("githubSkillSources"),
  },
  handler: async (ctx, args) => deleteForPublisherHandler(ctx, args),
});
