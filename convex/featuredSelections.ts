import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { renderFeaturedEvidence } from "./featuredIntelligence";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { assertModerator, requireUser } from "./lib/access";
import { FEATURED_CATALOG_SIZE } from "./lib/featuredPolicy";
import {
  FEATURED_EDITORIAL_SLOTS,
  editorialSelection,
  publishedSelection,
  validateEditorial,
  type EditorialSelection,
} from "./lib/featuredSelections";
import { searchArtifactKind, type SearchCurrentResult } from "./lib/searchInsights";
import { setPackageFeaturedForActor } from "./packages";
import { setSkillFeaturedForActor } from "./skills";

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

const publishArgs = {
  reportId: v.string(),
  artifactKind: searchArtifactKind,
  expectedEditorialRevision: v.number(),
  expectedPublicationAt: v.union(v.number(), v.null()),
  periodStart: v.number(),
  periodEnd: v.number(),
  items: v.array(publishedSelection),
  dryRun: v.boolean(),
};
type PublishInput = {
  reportId: string;
  artifactKind: Kind;
  expectedEditorialRevision: number;
  expectedPublicationAt: number | null;
  periodStart: number;
  periodEnd: number;
  items: NonNullable<Doc<"featuredSelections">["published"]>["items"];
  dryRun: boolean;
};
type PublishResult = {
  ok: true;
  dryRun: boolean;
  artifactKind: Kind;
  identities: string[];
  removed: string[];
  publishedAt: number | null;
};

async function publishForActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  args: PublishInput,
): Promise<PublishResult> {
  const row = await read(ctx, args.artifactKind);
  if ((row?.revision ?? 0) !== args.expectedEditorialRevision)
    throw new ConvexError("Editorial revision changed. Generate and review a new proposal.");
  if ((row?.published?.at ?? null) !== args.expectedPublicationAt)
    throw new ConvexError("Featured publication changed. Reload and review before publishing.");
  const DAY = 86_400_000;
  if (
    !Number.isSafeInteger(args.periodStart) ||
    !Number.isSafeInteger(args.periodEnd) ||
    args.periodStart % DAY ||
    args.periodEnd % DAY ||
    args.periodEnd - args.periodStart !== 30 * DAY ||
    args.periodEnd > Math.floor(Date.now() / DAY) * DAY
  )
    throw new ConvexError("Use exactly 30 completed UTC days for publication evidence.");
  if (
    args.items.length !== FEATURED_CATALOG_SIZE ||
    new Set(args.items.map((item) => item.id)).size !== args.items.length
  )
    throw new ConvexError("Publish exactly sixteen distinct reviewed selections.");
  const editorial = args.artifactKind === "plugin" ? (row?.editorial ?? []) : [];
  if (args.artifactKind === "plugin" && editorial.length !== FEATURED_EDITORIAL_SLOTS)
    throw new ConvexError("Save all eight editorial reservations before publishing plugins.");
  const { evidence: saved, reportHash } = await ctx.runQuery(
    internal.searchReports.evidenceInternal,
    { reportId: args.reportId, now: Date.now() },
  );
  if (
    saved.view !== "recommendations" ||
    saved.evidence.searchReport.artifactKind !== args.artifactKind
  )
    throw new ConvexError("Use a saved recommendation report for this catalog.");
  const report = renderFeaturedEvidence(saved.evidence, FEATURED_CATALOG_SIZE);
  const lineup = report.recommendations.lineup;
  // The stored cohort owns evidence and ordering. A refreshed eligibility view
  // cannot silently substitute for the frozen proposal that staff approved.
  if (
    lineup.editorialRevision !== args.expectedEditorialRevision ||
    report.adoption.periodStart !== args.periodStart ||
    report.adoption.periodEnd !== args.periodEnd ||
    lineup.proposed.length !== args.items.length ||
    lineup.proposed.some((candidate, index) => {
      const item = args.items[index];
      return (
        candidate.id !== item.id ||
        candidate.version !== item.version ||
        candidate.selectionBasis !== item.selectionBasis ||
        candidate.reason !== item.reason ||
        candidate.adoption?.installs30d !== item.installs30d ||
        candidate.adoption?.installs7d !== item.installs7d
      );
    })
  )
    throw new ConvexError(
      "Selection changed from the saved report evidence. Generate and review a new report.",
    );
  // All eligibility reads and badge changes belong to one transaction. A scan,
  // version, editorial edit or competing publication cannot race this approval.
  const current: SearchCurrentResult[] = await ctx.runQuery(
    internal.featuredArtifacts.readInternal,
    { identities: args.items.map((item) => item.id) },
  );
  const artifacts = new Map(current.map((item) => [item.id, item]));
  for (const item of args.items) {
    const artifact = artifacts.get(item.id);
    if (!artifact?.eligibleForFeatured)
      throw new ConvexError(
        `${item.id} is not eligible: ${artifact?.eligibilityReasons.join(", ") ?? "not-in-public-catalog"}`,
      );
    if (artifact.version !== item.version)
      throw new ConvexError(
        `${item.id} version changed: reviewed ${item.version}, current ${artifact.version}. Review it before publishing.`,
      );
  }
  const baseline = await ctx.runQuery(internal.featuredArtifacts.readCurrentFeaturedInternal, {
    artifactKind: args.artifactKind,
  });
  const selected = new Set(args.items.map((item) => item.id));
  const removed = baseline.filter((item) => !selected.has(item.id)).map((item) => item.id);
  const result = {
    ok: true as const,
    dryRun: args.dryRun,
    artifactKind: args.artifactKind,
    identities: args.items.map((item) => item.id),
    removed,
  };
  if (args.dryRun) return { ...result, publishedAt: null };
  for (const id of [...removed, ...selected]) {
    const featured = selected.has(id);
    if (args.artifactKind === "plugin") {
      const pkg = await ctx.db
        .query("packages")
        .withIndex("by_name", (q) => q.eq("normalizedName", id.slice(7)))
        .unique();
      if (!pkg) throw new ConvexError(`Missing catalog entry: ${id}`);
      await setPackageFeaturedForActor(ctx, actor, pkg, featured);
    } else {
      const skillId = ctx.db.normalizeId("skills", id.slice(8));
      const skill = skillId ? await ctx.db.get(skillId) : null;
      if (!skill) throw new ConvexError(`Missing catalog entry: ${id}`);
      // Publishing the reviewed set is curation, not authorization to send messages.
      await setSkillFeaturedForActor(
        ctx,
        actor,
        skill,
        featured ? "highlighted" : undefined,
        false,
      );
    }
  }
  const now = Math.max(Date.now(), (row?.published?.at ?? 0) + 1);
  const published = {
    reportId: args.reportId,
    reportHash,
    items: args.items,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    at: now,
    byUserId: actor._id,
  };
  if (row) await ctx.db.patch(row._id, { published, updatedAt: now, updatedBy: actor._id });
  else
    await ctx.db.insert("featuredSelections", {
      artifactKind: args.artifactKind,
      revision: 0,
      editorial: [],
      published,
      updatedAt: now,
      updatedBy: actor._id,
    });
  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "featured.selection.publish",
    targetType: "featuredSelection",
    targetId: args.artifactKind,
    metadata: {
      editorialRevision: args.expectedEditorialRevision,
      before: baseline.map((item) => item.id),
      published,
    },
    createdAt: now,
  });
  return { ...result, publishedAt: now };
}
export const publish = mutation({
  args: publishArgs,
  handler: async (ctx, args): Promise<PublishResult> => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    return publishForActor(ctx, user, args);
  },
});
export const publishForUserInternal = internalMutation({
  args: { ...publishArgs, actorUserId: v.id("users") },
  handler: async (ctx, args): Promise<PublishResult> => {
    return publishForActor(ctx, await requireActor(ctx, args.actorUserId), args);
  },
});
