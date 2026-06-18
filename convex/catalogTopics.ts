import {
  getCatalogTopicSlugs,
  isPluginCategorySlug,
  isSkillCategorySlug,
  resolveStoredSkillCategories,
} from "clawhub-schema";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./functions";
import { isPublicPluginDoc, isPublicSkillDoc } from "./lib/globalStats";

const TOP_CATEGORY_TOPIC_LIMIT = 5;
const TOP_CATEGORY_TOPIC_SAMPLE_LIMIT = 240;
const TOP_SKILL_CATEGORY_TOPIC_SCAN_LIMIT = TOP_CATEGORY_TOPIC_SAMPLE_LIMIT * 10;

type CatalogTopicSource = {
  topics?: readonly string[] | null;
};

export function rankTopCatalogTopics(
  sources: readonly CatalogTopicSource[],
  selectedCategory: string,
  limit = TOP_CATEGORY_TOPIC_LIMIT,
) {
  const counts = new Map<string, { count: number; firstSeen: number }>();
  let firstSeen = 0;

  for (const source of sources) {
    for (const topic of getCatalogTopicSlugs(source.topics)) {
      if (topic === selectedCategory) continue;
      const existing = counts.get(topic);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(topic, { count: 1, firstSeen });
        firstSeen += 1;
      }
    }
  }

  return [...counts.entries()]
    .sort(
      ([leftTopic, left], [rightTopic, right]) =>
        right.count - left.count ||
        left.firstSeen - right.firstSeen ||
        leftTopic.localeCompare(rightTopic),
    )
    .slice(0, Math.max(0, limit))
    .map(([topic]) => topic);
}

async function listTopSkillTopics(ctx: QueryCtx, category: string) {
  if (!isSkillCategorySlug(category)) return [];
  const digests = await ctx.db
    .query("skillSearchDigest")
    .withIndex("by_active_recommended_score", (q) => q.eq("softDeletedAt", undefined))
    .order("desc")
    .take(TOP_SKILL_CATEGORY_TOPIC_SCAN_LIMIT);
  const matching: Doc<"skillSearchDigest">[] = [];
  // Skill categories are multi-valued, so collect a bounded category sample from the ranked digest.
  for (const digest of digests) {
    if (!isPublicSkillDoc(digest)) continue;
    if (!resolveStoredSkillCategories(digest).includes(category)) continue;
    matching.push(digest);
    if (matching.length >= TOP_CATEGORY_TOPIC_SAMPLE_LIMIT) break;
  }
  return rankTopCatalogTopics(matching, category);
}

async function listTopPluginTopics(ctx: QueryCtx, category: string) {
  if (!isPluginCategorySlug(category)) return [];
  const digests: Doc<"packagePluginCategorySearchDigest">[] = await ctx.db
    .query("packagePluginCategorySearchDigest")
    .withIndex("by_active_category_installs", (q) =>
      q.eq("softDeletedAt", undefined).eq("pluginCategory", category),
    )
    .order("desc")
    .take(TOP_CATEGORY_TOPIC_SAMPLE_LIMIT);
  return rankTopCatalogTopics(digests.filter(isPublicPluginDoc), category);
}

export const listTopByCategory = query({
  args: {
    kind: v.union(v.literal("skill"), v.literal("plugin")),
    category: v.string(),
  },
  handler: async (ctx, args) => {
    return args.kind === "skill"
      ? await listTopSkillTopics(ctx, args.category)
      : await listTopPluginTopics(ctx, args.category);
  },
});
