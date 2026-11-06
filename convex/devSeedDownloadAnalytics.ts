import { v } from "convex/values";
import { internalMutation } from "./functions";
import { assertLocalDevSeedAllowed } from "./lib/devSeed";

const DAY_MS = 86_400_000;

/** Synthetic, owner-guarded local-only proof corpus; never production telemetry. */
export const seedInternal = internalMutation({
  args: {},
  returns: v.object({
    seededAt: v.number(),
    packageCount: v.number(),
    expectedDownloadsLast24h: v.number(),
    expectedDownloadsAllTime: v.number(),
    scopeNote: v.string(),
  }),
  handler: async (ctx) => {
    assertLocalDevSeedAllowed("admin-download-analytics");
    const deployment =
      process.env.CONVEX_DEPLOYMENT?.trim() || process.env.DEV_AUTH_CONVEX_DEPLOYMENT?.trim() || "";
    if (!deployment.startsWith("local:") && !deployment.startsWith("anonymous:"))
      throw new Error(
        "Analytics proof fixture is local-only; remote dev and production deployments are refused",
      );
    const now = Date.now();
    const handle = "download-analytics-proof";
    const owner = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", handle))
      .unique();
    const ownerUserId =
      owner?._id ?? (await ctx.db.insert("users", { handle, name: "Download analytics proof" }));
    const fixtures = [
      {
        name: "download-analytics-proof-a",
        downloads: 12345,
        recent: 12,
        family: "claw",
        channel: "community",
        deleted: false,
      },
      {
        name: "download-analytics-proof-b",
        downloads: 6789,
        recent: 5,
        family: "claw",
        channel: "community",
        deleted: false,
      },
      {
        name: "download-analytics-proof-private",
        downloads: 99999,
        recent: 9,
        family: "claw",
        channel: "private",
        deleted: false,
      },
      {
        name: "download-analytics-proof-deleted",
        downloads: 99999,
        recent: 9,
        family: "claw",
        channel: "community",
        deleted: true,
      },
      {
        name: "download-analytics-proof-plugin",
        downloads: 99999,
        recent: 9,
        family: "code-plugin",
        channel: "community",
        deleted: false,
      },
    ] as const;
    for (const fixture of fixtures) {
      const existing = await ctx.db
        .query("packages")
        .withIndex("by_name", (q) => q.eq("normalizedName", fixture.name))
        .unique();
      if (existing && existing.ownerUserId !== ownerUserId)
        throw new Error("Analytics fixture owner mismatch");
      const fields = {
        name: fixture.name,
        normalizedName: fixture.name,
        displayName: fixture.name,
        summary: "Synthetic local admin analytics proof fixture, not real download history.",
        ownerUserId,
        family: fixture.family,
        channel: fixture.channel,
        isOfficial: false,
        scanStatus: "clean" as const,
        tags: {},
        softDeletedAt: fixture.deleted ? now - DAY_MS : undefined,
        stats: { downloads: fixture.downloads, installs: 1000, stars: 0, versions: 1 },
        createdAt: now - 30 * DAY_MS,
        updatedAt: now,
      };
      const packageId = existing?._id ?? (await ctx.db.insert("packages", fields));
      if (existing) await ctx.db.patch(packageId, fields);
      const events = await ctx.db
        .query("packageStatEvents")
        .withIndex("by_package", (q) => q.eq("packageId", packageId))
        .take(100);
      if (events.length === 100) throw new Error("Analytics fixture has unexpected event history");
      for (const event of events) await ctx.db.delete(event._id);
      // Leave a one-hour margin for browser setup. Exact millisecond boundaries
      // are separately covered through public API runtime regression tests.
      for (let index = 0; index < fixture.recent; index++) {
        await ctx.db.insert("packageStatEvents", {
          packageId,
          kind: "download",
          occurredAt: now - 60 * 60_000 - index,
          processedAt: now,
        });
      }
      for (const occurredAt of [now - 25 * 60 * 60_000, now - 2 * DAY_MS])
        await ctx.db.insert("packageStatEvents", {
          packageId,
          kind: "download",
          occurredAt,
          processedAt: now,
        });
      for (const kind of ["install", "install_clear"] as const)
        await ctx.db.insert("packageStatEvents", {
          packageId,
          kind,
          occurredAt: now - 60_000,
          processedAt: now,
        });
    }
    return {
      seededAt: now,
      packageCount: fixtures.length,
      expectedDownloadsLast24h: 17,
      expectedDownloadsAllTime: 19134,
      scopeNote:
        "Synthetic fixture contribution only. Other public undeleted Templates in this deployment add to the global summary. Safe only on disposable local deployments.",
    };
  },
});
