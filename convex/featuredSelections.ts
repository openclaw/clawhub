import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { assertModerator, requireUser } from "./lib/access";
import {
  editorialSelection,
  validateEditorial,
  type EditorialSelection,
} from "./lib/featuredSelections";
import { searchArtifactKind, type SearchCurrentResult } from "./lib/searchInsights";

type Kind = "plugin" | "skill";
type SelectionState = {
  artifactKind: Kind;
  revision: number;
  editorial: EditorialSelection[];
  published: Doc<"featuredSelections">["published"] | null;
  reservations: Array<
    EditorialSelection & { currentArtifact: SearchCurrentResult | null; pendingReasons: string[] }
  >;
};

async function read(ctx: Pick<QueryCtx, "db">, artifactKind: Kind) {
  return ctx.db
    .query("featuredSelections")
    .withIndex("by_artifact_kind", (q) => q.eq("artifactKind", artifactKind))
    .unique();
}
async function requireActor(ctx: Pick<QueryCtx, "db">, actorUserId: Id<"users">) {
  const actor = await ctx.db.get(actorUserId);
  if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
  assertModerator(actor);
  return actor;
}
async function getState(ctx: QueryCtx, artifactKind: Kind): Promise<SelectionState> {
  const row = await read(ctx, artifactKind);
  const editorial = row?.editorial ?? [];
  const current: SearchCurrentResult[] = editorial.length
    ? await ctx.runQuery(internal.featuredArtifacts.readInternal, {
        identities: editorial.map((item) => item.id),
      })
    : [];
  const artifacts = new Map(current.map((item) => [item.id, item]));
  return {
    artifactKind,
    revision: row?.revision ?? 0,
    editorial,
    published: row?.published ?? null,
    reservations: editorial.map((item) => {
      const currentArtifact = artifacts.get(item.id) ?? null;
      return {
        ...item,
        currentArtifact,
        pendingReasons: currentArtifact?.eligibilityReasons ?? ["not-in-public-catalog"],
      };
    }),
  };
}
export const get = query({
  args: { artifactKind: searchArtifactKind },
  handler: async (ctx, { artifactKind }): Promise<SelectionState> => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    return getState(ctx, artifactKind);
  },
});
export const getForUserInternal = internalQuery({
  args: { actorUserId: v.id("users"), artifactKind: searchArtifactKind },
  handler: async (ctx, args): Promise<SelectionState> => {
    await requireActor(ctx, args.actorUserId);
    return getState(ctx, args.artifactKind);
  },
});
export const readEditorialInternal = internalQuery({
  args: { artifactKind: searchArtifactKind },
  handler: async (
    ctx,
    { artifactKind },
  ): Promise<{ revision: number; items: EditorialSelection[] }> => {
    const row = await read(ctx, artifactKind);
    return { revision: row?.revision ?? 0, items: row?.editorial ?? [] };
  },
});
const saveArgs = { expectedRevision: v.number(), items: v.array(editorialSelection) };
async function save(
  ctx: MutationCtx,
  actorUserId: Id<"users">,
  args: { expectedRevision: number; items: EditorialSelection[] },
): Promise<{ revision: number }> {
  validateEditorial(args.items);
  const row = await read(ctx, "plugin");
  if ((row?.revision ?? 0) !== args.expectedRevision)
    throw new ConvexError("Editorial revision changed. Reload before saving.");
  const revision = args.expectedRevision + 1;
  const now = Date.now();
  const fields = {
    artifactKind: "plugin" as const,
    revision,
    editorial: args.items,
    updatedAt: now,
    updatedBy: actorUserId,
  };
  if (row) await ctx.db.patch(row._id, fields);
  else await ctx.db.insert("featuredSelections", fields);
  await ctx.db.insert("auditLogs", {
    actorUserId,
    action: "featured.editorial.save",
    targetType: "featuredSelection",
    targetId: "plugin",
    metadata: { revision, before: row?.editorial ?? [], after: args.items },
    createdAt: now,
  });
  return { revision };
}
export const saveEditorial = mutation({
  args: saveArgs,
  handler: async (ctx, args): Promise<{ revision: number }> => {
    const { userId, user } = await requireUser(ctx);
    assertModerator(user);
    return save(ctx, userId, args);
  },
});
export const saveEditorialForUserInternal = internalMutation({
  args: { ...saveArgs, actorUserId: v.id("users") },
  handler: async (ctx, args): Promise<{ revision: number }> => {
    await requireActor(ctx, args.actorUserId);
    return save(ctx, args.actorUserId, args);
  },
});
