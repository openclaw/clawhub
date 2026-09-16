import { getPluginDiscoveryExclusion } from "clawhub-schema";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { action, internalAction, internalQuery } from "./functions";
import { assertModerator, requireUserFromAction } from "./lib/access";
import {
  recommendFeatured,
  type AdoptionArtifact,
  type AdoptionSummary,
} from "./lib/featuredIntelligence";
import {
  SEARCH_DAY_MS,
  searchArtifactKind,
  searchInsightSource,
  searchScope,
  type SearchArtifactKind,
  type SearchInsightArgs,
  type SearchInsightReport,
} from "./lib/searchInsights";
import { PACKAGE_TRENDING_LEADERBOARD_KIND } from "./packageLeaderboards";

const ADOPTION_INSPECTION_LIMIT = 100;
const args = {
  artifactKind: searchArtifactKind,
  endDay: v.optional(v.number()),
  source: v.optional(searchInsightSource),
  scope: v.optional(searchScope),
  window: v.optional(v.union(v.literal(7), v.literal(30))),
  limit: v.optional(v.number()),
};

export type FeaturedIntelligenceReport = {
  searchReport: SearchInsightReport;
  recommendations: ReturnType<typeof recommendFeatured>;
  adoption: AdoptionSummary;
  metadataCheckedAt: number | null;
};

export const get = action({
  args,
  handler: async (ctx, input): Promise<FeaturedIntelligenceReport> => {
    const { user } = await requireUserFromAction(ctx);
    assertModerator(user);
    return readReport(ctx, input);
  },
});

export const getInternal = internalAction({ args, handler: readReport });

async function readReport(
  ctx: ActionCtx,
  input: SearchInsightArgs & { artifactKind: SearchArtifactKind },
): Promise<FeaturedIntelligenceReport> {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("limit must be between 1 and 100");
  const searchReport = await ctx.runAction(internal.searchInsights.getInternal, {
    ...input,
    includeCurrentResults: true,
    // Candidate coverage is independent of how many cards the caller displays.
    limit: 100,
  });
  const currentMetadataCheckedAt = Date.now();
  const currentFeatured = await ctx.runQuery(
    internal.featuredArtifacts.readCurrentFeaturedInternal,
    { artifactKind: input.artifactKind },
  );
  const adoption = await ctx.runQuery(internal.featuredIntelligence.readAdoptionInternal, {
    artifactKind: input.artifactKind,
  });
  return {
    searchReport,
    recommendations: recommendFeatured({
      rows: searchReport.rows,
      adoption: adoption.artifacts,
      window: searchReport.window,
      coverage: searchReport.coverage,
      limit,
      currentFeatured,
    }),
    adoption: adoption.summary,
    metadataCheckedAt: Math.max(
      currentMetadataCheckedAt,
      adoption.metadataCheckedAt ?? 0,
      searchReport.metadataCheckedAt ?? 0,
    ),
  };
}

type AdoptionReport = {
  summary: AdoptionSummary;
  artifacts: AdoptionArtifact[];
  metadataCheckedAt: number | null;
};

const unavailable: AdoptionReport = {
  summary: {
    status: "unavailable",
    generatedAt: null,
    periodStart: null,
    periodEnd: null,
    snapshotId: null,
    rankingVersion: null,
    totalItems: 0,
    inspectedItems: 0,
    truncated: false,
  },
  artifacts: [],
  metadataCheckedAt: null,
};

export const readAdoptionInternal = internalQuery({
  args: { artifactKind: searchArtifactKind },
  handler: async (ctx, { artifactKind }): Promise<AdoptionReport> =>
    artifactKind === "plugin" ? readPluginAdoption(ctx) : readSkillAdoption(ctx),
});

async function readPluginAdoption(ctx: QueryCtx): Promise<AdoptionReport> {
  const snapshot = await ctx.db
    .query("packageLeaderboards")
    .withIndex("by_kind", (q) => q.eq("kind", PACKAGE_TRENDING_LEADERBOARD_KIND))
    .order("desc")
    .first();
  if (!snapshot) return unavailable;
  // Old snapshots can still contain setup categories. Filter the canonical
  // purpose before the inspection cap so they cannot starve discovery candidates.
  const inspected: Array<{
    item: (typeof snapshot.items)[number];
    rank: number;
    identity: string;
  }> = [];
  let scannedItems = 0;
  for (const [index, item] of snapshot.items.entries()) {
    scannedItems += 1;
    const pkg = await ctx.db.get(item.packageId);
    if (!pkg || getPluginDiscoveryExclusion(pkg.categories)) continue;
    inspected.push({ item, rank: index + 1, identity: `plugin:${pkg.name}` });
    if (inspected.length === ADOPTION_INSPECTION_LIMIT) break;
  }
  const artifacts = await ctx.runQuery(internal.featuredArtifacts.readInternal, {
    identities: inspected.map((entry) => entry.identity),
  });
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const periodStart = snapshot.rangeStartDay * SEARCH_DAY_MS;
  // Package Trending includes the current partial UTC day. Its evidence ends
  // at generation, not at an unobserved future midnight.
  const periodEnd = Math.min((snapshot.rangeEndDay + 1) * SEARCH_DAY_MS, snapshot.generatedAt);
  const rankingVersion = "unversioned";
  const evidence: AdoptionArtifact[] = [];
  inspected.forEach(({ item, rank, identity }) => {
    const artifact = identity ? byId.get(identity) : undefined;
    if (!artifact) return;
    evidence.push({
      artifact,
      evidence: {
        source: "package-trending",
        rank,
        snapshotId: String(snapshot._id),
        rankingVersion,
        periodStart,
        periodEnd,
        generatedAt: snapshot.generatedAt,
        sourceObservedAt: null,
        downloads: item.downloads,
        installs: item.installs,
        bookmarks: null,
        lifetimeInstalls: null,
      },
    });
  });
  return {
    summary: {
      status: "available",
      generatedAt: snapshot.generatedAt,
      periodStart,
      periodEnd,
      snapshotId: String(snapshot._id),
      rankingVersion,
      totalItems: snapshot.items.length,
      inspectedItems: scannedItems,
      truncated: snapshot.items.length > scannedItems,
    },
    artifacts: evidence,
    metadataCheckedAt: Date.now(),
  };
}

async function readSkillAdoption(ctx: QueryCtx): Promise<AdoptionReport> {
  // Use the same serving owner as public Trending, including its freshness,
  // rollout and visibility checks. Do not reconstruct its interleaved ranks.
  const result = await ctx.runQuery(internal.canonicalTrending.getPageInternal, {
    cursor: null,
    limit: ADOPTION_INSPECTION_LIMIT,
  });
  if (result.status !== "ok") return unavailable;
  const page = result.page;
  const snapshot = await ctx.db
    .query("canonicalTrendingSnapshots")
    .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", page.snapshotId))
    .unique();
  const artifacts = await ctx.runQuery(internal.featuredArtifacts.readInternal, {
    identities: page.items.map((item) => item.id),
  });
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const periodStart =
    snapshot?.windowStartHour === undefined ? null : snapshot.windowStartHour * 3_600_000;
  const periodEnd =
    snapshot?.windowEndHour === undefined ? null : (snapshot.windowEndHour + 1) * 3_600_000;
  const generatedAt = Date.parse(page.generatedAt);
  const evidence: AdoptionArtifact[] = [];
  for (const item of page.items) {
    const artifact = byId.get(item.id);
    if (!artifact) continue;
    evidence.push({
      artifact,
      evidence: {
        source: item.lane,
        rank: item.rank,
        snapshotId: page.snapshotId,
        rankingVersion: page.rankingVersion,
        periodStart: item.source === "skills-sh" ? null : periodStart,
        periodEnd: item.source === "skills-sh" ? null : periodEnd,
        generatedAt,
        sourceObservedAt: item.source === "skills-sh" ? item.metrics.updatedAt : null,
        downloads: item.metrics.trending24hDownloads ?? null,
        installs: item.metrics.trending24hInstalls,
        bookmarks: item.metrics.trending24hBookmarks,
        lifetimeInstalls: item.metrics.lifetimeInstalls,
      },
    });
  }
  return {
    summary: {
      status: "available",
      generatedAt,
      periodStart,
      periodEnd,
      snapshotId: page.snapshotId,
      rankingVersion: page.rankingVersion,
      totalItems: page.totalItems,
      inspectedItems: page.items.length,
      truncated: page.nextCursor !== null,
    },
    artifacts: evidence,
    metadataCheckedAt: Date.now(),
  };
}
