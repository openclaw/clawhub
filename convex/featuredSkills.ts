import { isSkillCategorySlug, normalizeCatalogTopic } from "clawhub-schema/catalogMetadata";
import { ConvexError, v } from "convex/values";
import { api } from "./_generated/api";
import { internalMutation, query } from "./functions";
import { assertModerator } from "./lib/access";
import {
  assertFeaturedCapacity,
  FEATURED_CATALOG_SIZE,
  getExternalFeaturedSkills,
} from "./lib/featuredPolicy";
import { buildUnclaimedSkillsShInstallResolution } from "./lib/skillsShMirrorPublic";
import { getSkillsShPublicCatalogEnabledHandler } from "./rolloutCapabilities";
import { buildExternalCanonicalResult } from "./search";
import type { PublicSkillEntry } from "./skills";

type ExternalFeaturedSkill = {
  external: NonNullable<ReturnType<typeof buildExternalCanonicalResult>>;
  searchScore: number;
  categories: string[];
};
type FeaturedSkill = PublicSkillEntry | ExternalFeaturedSkill;
type FeaturedPage = { page: FeaturedSkill[]; hasMore: false; nextCursor: null };

export const listPublic = query({
  args: {
    categorySlug: v.optional(v.string()),
    topic: v.optional(v.string()),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<FeaturedPage> => {
    const categorySlug = args.categorySlug?.trim().toLowerCase();
    if (args.categorySlug !== undefined && (!categorySlug || !isSkillCategorySlug(categorySlug)))
      return { page: [], hasMore: false, nextCursor: null };
    const topic = args.topic === undefined ? undefined : normalizeCatalogTopic(args.topic);
    if (args.topic !== undefined && !topic) return { page: [], hasMore: false, nextCursor: null };
    const native = await ctx.runQuery(api.skills.listPublicPageV4, {
      numItems: FEATURED_CATALOG_SIZE,
      highlightedOnly: true,
      categorySlug,
      topic,
    });
    const items: { entry: FeaturedSkill; at: number }[] = native.page.map((entry) => ({
      entry,
      at: entry.skill.badges?.highlighted?.at ?? 0,
    }));
    if (await getSkillsShPublicCatalogEnabledHandler(ctx)) {
      for (const selection of await getExternalFeaturedSkills(ctx)) {
        const digest = await ctx.db
          .query("skillsShMirrorDigests")
          .withIndex("by_external_id", (q) => q.eq("externalId", selection.externalId))
          .unique();
        // Selection never grants visibility or bypasses the exact-source install gate.
        if (!digest || !buildUnclaimedSkillsShInstallResolution(digest)) continue;
        if (categorySlug && !digest.inferredCategories?.includes(categorySlug)) continue;
        if (topic && !digest.inferredTopics?.includes(topic)) continue;
        const result = buildExternalCanonicalResult(digest, digest.slug);
        if (result)
          items.push({
            entry: {
              external: { ...result, featured: true },
              searchScore: result.score,
              categories: digest.inferredCategories ?? [],
            },
            at: selection.at,
          });
      }
    }
    const tokens = args.query?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    const page = items
      .filter(({ entry }) => {
        const item = "external" in entry ? entry.external : entry.skill;
        const owner = "external" in entry ? entry.external.ownerHandle : entry.ownerHandle;
        const text = [item.slug, item.displayName, item.summary, owner].join(" ").toLowerCase();
        return tokens.every((token) => text.includes(token));
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, FEATURED_CATALOG_SIZE)
      .map((item) => item.entry);
    return { page, hasMore: false, nextCursor: null };
  },
});

export const setExternalForUserInternal = internalMutation({
  args: { actorUserId: v.id("users"), externalId: v.string(), featured: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertModerator(actor);
    const externalId = args.externalId.trim().toLowerCase();
    const parts = externalId.split("/");
    if (
      parts.length !== 3 ||
      parts.some((part) => !/^[a-z0-9][a-z0-9._-]*$/.test(part) || part.includes(".."))
    ) {
      throw new ConvexError("Invalid skills.sh identity");
    }
    const row = await ctx.db
      .query("featuredSelections")
      .withIndex("by_artifact_kind", (q) => q.eq("artifactKind", "skill"))
      .unique();
    const selections = row?.externalSkills ?? [];
    const previous = selections.find((item) => item.externalId === externalId);
    const result = {
      ok: true as const,
      featured: args.featured,
      externalId,
      slug: parts[2]!,
      ownerHandle: parts[0]!,
    };
    if (args.featured === Boolean(previous)) return result;
    if (args.featured) {
      const digest = await ctx.db
        .query("skillsShMirrorDigests")
        .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
        .unique();
      if (
        !(await getSkillsShPublicCatalogEnabledHandler(ctx)) ||
        !digest ||
        !buildUnclaimedSkillsShInstallResolution(digest)
      ) {
        throw new ConvexError("Only publicly installable skills.sh entries can be featured");
      }
      await assertFeaturedCapacity(ctx, "skill");
    }
    const now = Date.now();
    const externalSkills = args.featured
      ? [...selections, { externalId, at: now, byUserId: actor._id }]
      : selections.filter((item) => item.externalId !== externalId);
    const fields = {
      externalSkills,
      revision: (row?.revision ?? 0) + 1,
      updatedAt: now,
      updatedBy: actor._id,
    };
    if (row) await ctx.db.patch(row._id, fields);
    else
      await ctx.db.insert("featuredSelections", {
        ...fields,
        artifactKind: "skill",
        editorial: [],
      });
    await ctx.db.insert("auditLogs", {
      actorUserId: actor._id,
      action: "badge.highlighted",
      targetType: "skills-sh",
      targetId: externalId,
      metadata: { highlighted: args.featured },
      createdAt: now,
    });
    return result;
  },
});
