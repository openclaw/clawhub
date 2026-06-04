import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalQuery, mutation, query } from "./functions";
import { requireUser } from "./lib/access";
import { adjustGlobalPublicSkillsCount, getPublicSkillVisibilityDelta } from "./lib/globalStats";
import { requirePublisherRole } from "./lib/publishers";

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
  | "lastSyncInvalidSkills"
  | "createdAt"
  | "updatedAt"
> & {
  skills: Array<
    Pick<Doc<"skills">, "_id" | "slug" | "displayName" | "githubPath" | "githubCurrentStatus">
  >;
};

export const getByIdInternal = internalQuery({
  args: { sourceId: v.id("githubSkillSources") },
  handler: async (ctx, args) => ctx.db.get(args.sourceId),
});

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
    const sortedSources = sources.sort((a, b) => b.updatedAt - a.updatedAt);
    return await Promise.all(
      sortedSources.map(async (source) => {
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

        return {
          _id: source._id as Id<"githubSkillSources">,
          repo: source.repo,
          defaultBranch: source.defaultBranch,
          lastSyncStatus: source.lastSyncStatus,
          lastSyncError: source.lastSyncError,
          lastSyncErrorAt: source.lastSyncErrorAt,
          displayManifestStatus: source.displayManifestStatus,
          displayManifestFetchedAt: source.displayManifestFetchedAt,
          displayManifestCommit: source.displayManifestCommit,
          lastSyncInvalidSkills: source.lastSyncInvalidSkills,
          createdAt: source.createdAt,
          updatedAt: source.updatedAt,
          skills: visibleGitHubSkills,
        };
      }),
    );
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

  const now = args.now ?? Date.now();
  const contents = await ctx.db
    .query("githubSkillContents")
    .withIndex("by_github_source", (q) => q.eq("githubSourceId", args.sourceId))
    .collect();
  for (const content of contents) {
    await ctx.db.delete(content._id);
  }

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
    deletedSkills += 1;
  }

  if (publicSkillDelta !== 0) {
    await adjustGlobalPublicSkillsCount(ctx, publicSkillDelta, now);
  }
  await ctx.db.delete(args.sourceId);

  return { ok: true as const, deletedSkills };
}

export const deleteForPublisher: ReturnType<typeof mutation> = mutation({
  args: {
    ownerPublisherId: v.id("publishers"),
    sourceId: v.id("githubSkillSources"),
  },
  handler: async (ctx, args) => deleteForPublisherHandler(ctx, args),
});
