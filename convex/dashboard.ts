import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./functions";
import { getOptionalActiveAuthUserId } from "./lib/access";
import {
  ACTIVITY_TREND_DAYS,
  buildDailyMetricTrends,
  clampActivityTrendEndDay,
  getActivityTrendRangeForEndDay,
} from "./lib/downloadTrend";
import { normalizePackageName } from "./lib/packageRegistry";
import { canAccessPublisherOwnerScope } from "./lib/publishers";
import { readPublicDownloads } from "./lib/skillStats";

const dashboardMetricSelectionValidator = v.union(
  v.object({ kind: v.literal("skill"), slug: v.string() }),
  v.object({ kind: v.literal("plugin"), name: v.string() }),
);

type MetricPoint = { day: number; value: number };

function emptyPoints(endDay: number): MetricPoint[] {
  return buildDailyMetricTrends([], endDay).downloads.points;
}

function addPoints(target: MetricPoint[], source: MetricPoint[]) {
  for (let index = 0; index < target.length; index += 1) {
    target[index].value += source[index]?.value ?? 0;
  }
}

async function aggregateSkillDownloads(ctx: QueryCtx, skills: Doc<"skills">[], endDay: number) {
  const { startDay } = getActivityTrendRangeForEndDay(endDay);
  const points = emptyPoints(endDay);
  const trends = await Promise.all(
    skills.map(async (skill) => {
      const rows = await ctx.db
        .query("skillDailyStats")
        .withIndex("by_skill_day", (q) =>
          q.eq("skillId", skill._id).gte("day", startDay).lte("day", endDay),
        )
        .take(ACTIVITY_TREND_DAYS);
      return buildDailyMetricTrends(rows, endDay).downloads.points;
    }),
  );
  for (const trend of trends) addPoints(points, trend);
  return {
    allTimeDownloads: skills.reduce((sum, skill) => sum + readPublicDownloads(skill), 0),
    points,
  };
}

async function aggregatePluginDownloads(
  ctx: QueryCtx,
  packages: Doc<"packages">[],
  endDay: number,
) {
  const { startDay } = getActivityTrendRangeForEndDay(endDay);
  const points = emptyPoints(endDay);
  const trends = await Promise.all(
    packages.map(async (pkg) => {
      const rows = await ctx.db
        .query("packageDailyStats")
        .withIndex("by_package_day", (q) =>
          q.eq("packageId", pkg._id).gte("day", startDay).lte("day", endDay),
        )
        .take(ACTIVITY_TREND_DAYS);
      return buildDailyMetricTrends(rows, endDay).downloads.points;
    }),
  );
  for (const trend of trends) addPoints(points, trend);
  return {
    allTimeDownloads: packages.reduce((sum, pkg) => sum + Math.max(0, pkg.stats.downloads), 0),
    points,
  };
}

async function listPublisherSkills(
  ctx: QueryCtx,
  publisher: Doc<"publishers">,
  userId: Id<"users">,
) {
  const legacyOwnerUserId = legacyPersonalOwnerUserId(publisher, userId);

  if (legacyOwnerUserId) {
    const skills = await ctx.db
      .query("skills")
      .withIndex("by_owner_active_updated", (q) =>
        q.eq("ownerUserId", legacyOwnerUserId).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .collect();
    return skills.filter(
      (skill) => !skill.ownerPublisherId || skill.ownerPublisherId === publisher._id,
    );
  }

  return await ctx.db
    .query("skills")
    .withIndex("by_owner_publisher_active_updated", (q) =>
      q.eq("ownerPublisherId", publisher._id).eq("softDeletedAt", undefined),
    )
    .order("desc")
    .collect();
}

function uniquePackages(packages: Doc<"packages">[]) {
  const seen = new Set<Id<"packages">>();
  const unique: Doc<"packages">[] = [];
  for (const pkg of packages) {
    if (seen.has(pkg._id)) continue;
    seen.add(pkg._id);
    unique.push(pkg);
  }
  return unique;
}

function legacyPersonalOwnerUserId(publisher: Doc<"publishers">, userId: Id<"users">) {
  return publisher.kind === "user" ? (publisher.linkedUserId ?? userId) : undefined;
}

function isOwnedByDashboardPublisher(
  item: { ownerUserId: Id<"users">; ownerPublisherId?: Id<"publishers"> },
  publisher: Doc<"publishers">,
  userId: Id<"users">,
) {
  if (item.ownerPublisherId === publisher._id) return true;
  const legacyOwnerUserId = legacyPersonalOwnerUserId(publisher, userId);
  return Boolean(
    legacyOwnerUserId && item.ownerUserId === legacyOwnerUserId && !item.ownerPublisherId,
  );
}

async function listPublisherPackages(
  ctx: QueryCtx,
  publisher: Doc<"publishers">,
  userId: Id<"users">,
) {
  const packages = await ctx.db
    .query("packages")
    .withIndex("by_owner_publisher_active_updated", (q) =>
      q.eq("ownerPublisherId", publisher._id).eq("softDeletedAt", undefined),
    )
    .order("desc")
    .collect();

  const legacyOwnerUserId = legacyPersonalOwnerUserId(publisher, userId);
  if (legacyOwnerUserId) {
    const legacyPackages = await ctx.db
      .query("packages")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", legacyOwnerUserId))
      .order("desc")
      .collect();
    packages.push(
      ...legacyPackages.filter(
        (pkg) => !pkg.softDeletedAt && isOwnedByDashboardPublisher(pkg, publisher, userId),
      ),
    );
  }

  return uniquePackages(packages);
}

export const getDownloadMetrics = query({
  args: {
    publisherId: v.id("publishers"),
    endDay: v.number(),
    selection: v.optional(dashboardMetricSelectionValidator),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalActiveAuthUserId(ctx);
    if (!userId) throw new ConvexError("Unauthorized");
    const publisher = await ctx.db.get(args.publisherId);
    const canAccess = await canAccessPublisherOwnerScope(ctx, {
      publisher,
      userId,
      legacyOwnerUserId: userId,
    });
    if (!publisher || !canAccess) throw new ConvexError("Forbidden");

    const endDay = clampActivityTrendEndDay(args.endDay, Date.now());
    let skills: Doc<"skills">[] = [];
    let packages: Doc<"packages">[] = [];

    const selection = args.selection;
    if (selection?.kind === "skill") {
      const publisherOwned = await ctx.db
        .query("skills")
        .withIndex("by_owner_publisher_slug", (q) =>
          q.eq("ownerPublisherId", publisher._id).eq("slug", selection.slug),
        )
        .take(10);
      const legacyOwnerUserId = legacyPersonalOwnerUserId(publisher, userId);
      const legacyOwned = legacyOwnerUserId
        ? await ctx.db
            .query("skills")
            .withIndex("by_owner_slug", (q) =>
              q.eq("ownerUserId", legacyOwnerUserId).eq("slug", selection.slug),
            )
            .take(10)
        : [];
      const candidates = [...publisherOwned, ...legacyOwned];
      skills = candidates.filter(
        (skill, index, all) =>
          !skill.softDeletedAt &&
          isOwnedByDashboardPublisher(skill, publisher, userId) &&
          all.findIndex((candidate) => candidate._id === skill._id) === index,
      );
    } else if (selection?.kind === "plugin") {
      const pkg = await ctx.db
        .query("packages")
        .withIndex("by_name", (q) => q.eq("normalizedName", normalizePackageName(selection.name)))
        .unique();
      if (pkg && !pkg.softDeletedAt && isOwnedByDashboardPublisher(pkg, publisher, userId)) {
        packages = [pkg];
      }
    } else {
      [skills, packages] = await Promise.all([
        listPublisherSkills(ctx, publisher, userId),
        listPublisherPackages(ctx, publisher, userId),
      ]);
    }

    const [skillMetrics, pluginMetrics] = await Promise.all([
      aggregateSkillDownloads(ctx, skills, endDay),
      aggregatePluginDownloads(ctx, packages, endDay),
    ]);
    return {
      endDay,
      allTimeDownloads: skillMetrics.allTimeDownloads + pluginMetrics.allTimeDownloads,
      skills: skillMetrics,
      plugins: pluginMetrics,
    };
  },
});
