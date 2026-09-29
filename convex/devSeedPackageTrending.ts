import { v } from "convex/values";
import { internalMutation } from "./functions";
import { assertLocalDevSeedAllowed } from "./lib/devSeed";
import { getCompletedRolling24HourWindow } from "./lib/skillHourlyStats";

// Reusable local proof: a former weekly leader, a recent leader, and enough
// current plugins to exercise homepage pagination without production data.
export const seedInternal = internalMutation({
  args: {},
  returns: v.object({ startAt: v.number(), endAt: v.number(), count: v.number() }),
  handler: async (ctx) => {
    assertLocalDevSeedAllowed("plugin-trending");
    const now = Date.now();
    const { startAt, endAt } = getCompletedRolling24HourWindow(now);
    const handle = "trending-proof";
    const owner = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", handle))
      .unique();
    const ownerUserId =
      owner?._id ?? (await ctx.db.insert("users", { handle, name: "Trending proof" }));
    for (let index = 0; index < 26; index++) {
      const old = index === 25;
      const name = old
        ? "trending-proof-weekly-leader"
        : `trending-proof-${String(index).padStart(2, "0")}`;
      const existing = await ctx.db
        .query("packages")
        .withIndex("by_name", (q) => q.eq("normalizedName", name))
        .unique();
      if (existing && existing.ownerUserId !== ownerUserId)
        throw new Error("Trending fixture owner mismatch");
      const packageId =
        existing?._id ??
        (await ctx.db.insert("packages", {
          name,
          normalizedName: name,
          displayName: old
            ? "Former Weekly Leader"
            : index === 0
              ? "Recent Calendar Leader"
              : `Trending Research Plugin ${index}`,
          summary:
            "Search the web and summarize research findings with citations to original sources.",
          ownerUserId,
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          categories: ["memory"],
          scanStatus: "clean",
          tags: {},
          stats: { downloads: old ? 10000 : 1000 + index, installs: 0, stars: 0, versions: 1 },
          createdAt: now - 7 * 86400000,
          updatedAt: now,
        }));
      if (!existing) {
        const releaseId = await ctx.db.insert("packageReleases", {
          packageId,
          version: "1.0.0",
          publicationStatus: "published",
          changelog: "Proof fixture",
          distTags: ["latest"],
          files: [],
          integritySha256: "a".repeat(64),
          createdAt: now,
          createdBy: ownerUserId,
          verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
        });
        await ctx.db.patch(packageId, {
          latestReleaseId: releaseId,
          tags: { latest: releaseId },
          latestVersionSummary: { version: "1.0.0", createdAt: now, changelog: "Proof fixture" },
        });
      }
      const events = await ctx.db
        .query("packageStatEvents")
        .withIndex("by_package", (q) => q.eq("packageId", packageId))
        .take(100);
      if (events.length === 100) throw new Error("Trending fixture has unexpected event history");
      for (const event of events) await ctx.db.delete(event._id);
      const count = old ? 40 : 25 - index;
      const day = Math.floor((old ? startAt - 1 : startAt) / 86400000);
      const daily = await ctx.db
        .query("packageDailyStats")
        .withIndex("by_package_day", (q) => q.eq("packageId", packageId).eq("day", day))
        .unique();
      const dailyStats = { packageId, day, downloads: count, installs: 0, updatedAt: now };
      if (daily) await ctx.db.replace(daily._id, dailyStats);
      else await ctx.db.insert("packageDailyStats", dailyStats);
      for (let offset = 0; offset < count; offset++) {
        await ctx.db.insert("packageStatEvents", {
          packageId,
          kind: "download",
          occurredAt: old ? startAt - 1 : startAt + offset,
          processedAt: now,
        });
      }
    }
    return { startAt, endAt, count: 26 };
  },
});
