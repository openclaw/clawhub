import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, query } from "./functions";
import { requireUser } from "./lib/access";
import { requirePublisherRole } from "./lib/publishers";

type PublicGitHubSkillSource = Pick<
  Doc<"githubSkillSources">,
  | "_id"
  | "repo"
  | "defaultBranch"
  | "displayManifestStatus"
  | "displayManifestFetchedAt"
  | "displayManifestCommit"
  | "createdAt"
  | "updatedAt"
>;

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
    return sources
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((source) => ({
        _id: source._id as Id<"githubSkillSources">,
        repo: source.repo,
        defaultBranch: source.defaultBranch,
        displayManifestStatus: source.displayManifestStatus,
        displayManifestFetchedAt: source.displayManifestFetchedAt,
        displayManifestCommit: source.displayManifestCommit,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      }));
  },
});
