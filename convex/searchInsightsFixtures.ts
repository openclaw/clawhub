import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./functions";
import { SEARCH_DAY_MS } from "./lib/searchInsights";

function assertLocal() {
  const origin = process.env.CONVEX_SITE_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
    throw new Error("Search fixtures require a disposable local backend");
}

export const seed = internalAction({
  args: {
    state: v.union(v.literal("empty"), v.literal("typical"), v.literal("dense")),
    apiTokenHash: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ state: string; endDay: number; seededRaw: number }> => {
    assertLocal();
    const storageId = await ctx.storage.store(
      new Blob(["export default {};"], { type: "text/javascript" }),
    );
    const result: { state: string; endDay: number; seededRaw: number } = await ctx.runMutation(
      internal.searchInsightsFixtures.seedInternal,
      { ...args, storageId },
    );
    await ctx.runMutation(internal.searchInsights.aggregateInternal, {});
    if (args.state !== "empty")
      await ctx.runMutation(internal.searchInsights.storeClassificationsInternal, {
        weekStart: result.endDay - 7 * SEARCH_DAY_MS,
        weekEnd: result.endDay,
        processedAt: Date.now(),
        model: "local-fixture",
        modelVersion: "v1",
        expectedQualified: args.state === "dense" ? 24 : 4,
        rows: [
          {
            query: "notion",
            intentKind: "company_product",
            companyProductName: "Notion",
            confidence: 0.96,
          },
          {
            query: "google drive",
            intentKind: "company_product",
            companyProductName: "Google Drive",
            confidence: 0.97,
          },
          { query: "memory", intentKind: "generic_capability", confidence: 0.99 },
          { query: "atlas", intentKind: "ambiguous", confidence: 0.5 },
        ],
      });
    return result;
  },
});
export const seedInternal = internalMutation({
  args: {
    state: v.union(v.literal("empty"), v.literal("typical"), v.literal("dense")),
    storageId: v.id("_storage"),
    apiTokenHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertLocal();
    const endDay = Math.floor(Date.now() / SEARCH_DAY_MS) * SEARCH_DAY_MS;
    for (const table of [
      "pluginSearchObservations",
      "searchDailyAggregates",
      "searchAggregateStates",
      "searchWeeklyClassifications",
      "searchClassificationRuns",
    ] as const) {
      const rows = await ctx.db.query(table).take(1000);
      if (rows.length === 1000) throw new Error("Fixture reset exceeds bounded disposable dataset");
      for (const row of rows) await ctx.db.delete(row._id);
    }
    let user = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", "local"))
      .unique();
    let userId: Id<"users">;
    if (user) {
      userId = user._id;
      await ctx.db.patch(userId, { role: "admin" });
    } else {
      userId = await ctx.db.insert("users", {
        handle: "local",
        displayName: "Local staff fixture",
        role: "admin",
      });
    }
    if (args.apiTokenHash) {
      const existing = await ctx.db
        .query("apiTokens")
        .withIndex("by_hash", (q) => q.eq("tokenHash", args.apiTokenHash!))
        .unique();
      if (!existing)
        await ctx.db.insert("apiTokens", {
          userId,
          label: "Local search proof",
          prefix: "fixture",
          tokenHash: args.apiTokenHash,
          createdAt: Date.now(),
        });
    }
    let seededRaw = 0;
    if (args.state !== "empty") {
      const packageName = "notion-search-proof";
      let pkg = await ctx.db
        .query("packages")
        .withIndex("by_name", (q) => q.eq("normalizedName", packageName))
        .unique();
      if (!pkg) {
        const packageId = await ctx.db.insert("packages", {
          name: packageName,
          normalizedName: packageName,
          displayName: "Notion workspace connector",
          ownerUserId: userId,
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          tags: {},
          scanStatus: "clean",
          stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
          createdAt: endDay,
          updatedAt: endDay,
        });
        const releaseId = await ctx.db.insert("packageReleases", {
          packageId,
          version: "1.0.0",
          changelog: "Local fixture",
          distTags: ["latest"],
          files: [
            { path: "index.js", size: 18, storageId: args.storageId, sha256: "a".repeat(64) },
          ],
          integritySha256: "a".repeat(64),
          verification: { tier: "structural", scope: "artifact-only", scanStatus: "clean" },
          createdBy: userId,
          createdAt: endDay,
        });
        await ctx.db.patch(packageId, { latestReleaseId: releaseId, tags: { latest: releaseId } });
      }
      const rows = [
        { query: "notion", count: 12, previous: 4, older: 5 },
        { query: "google drive", count: 9, previous: 12, older: 7 },
        { query: "memory", count: 7, previous: 3, older: 9 },
        { query: "atlas", count: 4, previous: 0, older: 0 },
      ];
      if (args.state === "dense")
        for (let i = 0; i < 20; i++)
          rows.push({
            query: `workspace automation for cross-functional research and product planning ${i + 1}`,
            count: 3,
            previous: 1,
            older: 2,
          });
      const rawRows: Array<Omit<Doc<"pluginSearchObservations">, "_id" | "_creationTime">> = [];
      for (const row of rows)
        for (const [count, age] of [
          [row.count, 1],
          [row.previous, 8],
          [row.older, 20],
        ]) {
          for (let i = 0; i < count; i++) {
            rawRows.push({
              normalizedQuery: row.query,
              observedAt: endDay - age * SEARCH_DAY_MS,
              source: i % 3 ? "clawhub-web" : "openclaw-control-ui",
              artifactKind: "plugin",
              resultCount: row.query === "notion" ? 1 : 0,
              officialResultCount: 0,
            });
          }
        }
      for (const raw of rawRows.sort((a, b) => a.observedAt - b.observedAt)) {
        await ctx.db.insert("pluginSearchObservations", raw);
        seededRaw++;
      }
    }
    return { state: args.state, endDay, seededRaw };
  },
});

// Disposable local data for the same staff workflow used in production. Keeping
// this in the existing fixture owner makes populated dashboard proof repeatable.
export const seedFeaturedLineup = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    fixture: string;
    actorUserId: Id<"users">;
    editorialRevision: number;
    pluginIds: string[];
    skillIds: string[];
    periodEnd: number;
  }> => {
    assertLocal();
    const storageId = await ctx.storage.store(new Blob(["x"]));
    const seeded = await ctx.runMutation(
      internal.searchInsightsFixtures.seedFeaturedLineupInternal,
      { storageId },
    );
    const current = await ctx.runQuery(internal.featuredSelections.readEditorialInternal, {
      artifactKind: "plugin",
    });
    const saved = await ctx.runMutation(internal.featuredSelections.saveEditorialForUserInternal, {
      actorUserId: seeded.actorUserId,
      expectedRevision: current.revision,
      items: seeded.editorial,
    });
    return {
      fixture: seeded.fixture,
      actorUserId: seeded.actorUserId,
      editorialRevision: saved.revision,
      pluginIds: seeded.pluginIds,
      skillIds: seeded.skillIds,
      periodEnd: seeded.periodEnd,
    };
  },
});
export const seedFeaturedLineupInternal = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    assertLocal();
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", {
      handle: `lineup-fixture-${now}`,
      role: "admin",
    });
    const file = { path: "index.js", size: 1, storageId, sha256: "a".repeat(64) };
    const periodEnd = Math.floor(now / SEARCH_DAY_MS) * SEARCH_DAY_MS;
    const endDay = periodEnd / SEARCH_DAY_MS;
    const pluginIds: string[] = [];
    const skillIds: string[] = [];
    for (let index = 0; index < 20; index++) {
      const name = `monthly-lineup-${now}-plugin-${index}`;
      const packageId = await ctx.db.insert("packages", {
        name,
        normalizedName: name,
        displayName: `Local monthly tool ${index + 1}`,
        summary: "Disposable monthly install evidence fixture.",
        ownerUserId: ownerId,
        family: "code-plugin",
        channel: "community",
        isOfficial: index % 2 === 0,
        categories: [index === 18 ? "channels" : "developer-tools"],
        tags: {},
        scanStatus: "clean",
        stats: { downloads: index * 1000, installs: 100 - index * 3, stars: 0, versions: 1 },
        createdAt: now - (index === 0 ? 1 : 100) * SEARCH_DAY_MS,
        updatedAt: now,
      });
      const releaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version: "1.0.0",
        changelog: "Local monthly fixture",
        distTags: ["latest"],
        files: [file],
        integritySha256: "a".repeat(64),
        verification: {
          tier: "structural",
          scope: "artifact-only",
          scanStatus: index === 19 ? "suspicious" : "clean",
        },
        createdBy: ownerId,
        createdAt: now,
      });
      await ctx.db.patch(packageId, { latestReleaseId: releaseId, tags: { latest: releaseId } });
      for (const [age, installs] of [
        [20, 70 - index * 2],
        [1, index >= 18 ? 1000 : 30 - index],
      ])
        await ctx.db.insert("packageDailyStats", {
          packageId,
          day: endDay - age,
          installs,
          downloads: index * 1000,
          updatedAt: now,
        });
      if (index === 0 || index === 16)
        await ctx.db.insert("packageBadges", {
          packageId,
          kind: "highlighted",
          byUserId: ownerId,
          at: now - index,
        });
      pluginIds.push(`plugin:${name}`);
      const slug = `monthly-lineup-${now}-skill-${index}`;
      const skillId = await ctx.db.insert("skills", {
        slug,
        displayName: `Local monthly skill ${index + 1}`,
        summary: "Disposable skill monthly install evidence.",
        ownerUserId: ownerId,
        tags: {},
        stats: { downloads: index * 1000, stars: 0, versions: 1, comments: 0 },
        createdAt: now,
        updatedAt: now,
      });
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.0.0",
        changelog: "Local monthly fixture",
        files: [{ ...file, path: "SKILL.md" }],
        parsed: { frontmatter: {} },
        createdBy: ownerId,
        createdAt: now,
        llmAnalysis: { status: index >= 18 ? "suspicious" : "clean", checkedAt: now },
      });
      await ctx.db.patch(skillId, { latestVersionId: versionId });
      for (const [age, installs] of [
        [20, 70 - index * 2],
        [1, index >= 18 ? 1000 : 30 - index],
      ])
        await ctx.db.insert("skillDailyStats", {
          skillId,
          day: endDay - age,
          installs,
          downloads: index * 1000,
          updatedAt: now,
        });
      skillIds.push(`clawhub:${skillId}`);
    }
    const editorial = [
      ...pluginIds.slice(0, 5),
      ...Array.from({ length: 3 }, (_, index) => `plugin:monthly-pending-${now}-${index}`),
    ].map((id, index) => ({
      id,
      name: id.slice(7),
      displayName: `Local editorial ${index + 1}`,
      reason: index < 5 ? "Reviewed local workflow" : "Awaiting a public release",
    }));
    return {
      fixture: "local-monthly-featured-lineup",
      actorUserId: ownerId,
      editorial,
      pluginIds,
      skillIds,
      periodEnd,
    };
  },
});
