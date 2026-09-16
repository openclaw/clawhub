import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerWorkpool } from "@convex-dev/workpool/test";
/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { FeaturedIntelligenceReportSchema } from "../packages/clawhub/src/schema/searchInsights";
import { api, internal } from "./_generated/api";
import { CANONICAL_TRENDING_RANKING_VERSION } from "./lib/canonicalTrending";
import { getCompletedRolling24HourWindow } from "./lib/skillHourlyStats";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const DAY = 86_400_000;
afterEach(() => vi.useRealTimers());

it("serves existing package adoption without search history and rechecks current Featured eligibility", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const now = Date.UTC(2026, 8, 15, 12);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const ids = await t.run(async (ctx) => {
    const staff = await ctx.db.insert("users", { handle: "author", role: "moderator" });
    const pkg = await ctx.db.insert("packages", {
      name: "calendar",
      normalizedName: "calendar",
      displayName: "Calendar",
      ownerUserId: staff,
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      tags: {},
      scanStatus: "clean",
      stats: { downloads: 40, installs: 3, stars: 0, versions: 1 },
      createdAt: now - DAY,
      updatedAt: now,
    });
    const release = await ctx.db.insert("packageReleases", {
      packageId: pkg,
      version: "1.0.0",
      changelog: "Initial",
      distTags: ["latest"],
      files: [
        {
          path: "index.js",
          size: 1,
          storageId: await ctx.storage.store(new Blob(["x"])),
          sha256: "a".repeat(64),
        },
      ],
      integritySha256: "a".repeat(64),
      verification: { tier: "structural", scope: "artifact-only", scanStatus: "clean" },
      createdBy: staff,
      createdAt: now,
    });
    await ctx.db.patch(pkg, { latestReleaseId: release, tags: { latest: release } });
    await ctx.db.insert("packageLeaderboards", {
      kind: "package_trending",
      generatedAt: now,
      rangeStartDay: Math.floor(now / DAY) - 6,
      rangeEndDay: Math.floor(now / DAY),
      items: [{ packageId: pkg, score: 49, installs: 3, downloads: 40 }],
    });
    await ctx.db.insert("apiTokens", {
      userId: staff,
      label: "fixture",
      prefix: "fixture",
      tokenHash: await hashToken("featured-api-fixture"),
      createdAt: now,
    });
    return { staff, pkg };
  });
  const report = await t.withIdentity({ subject: ids.staff }).action(api.featuredIntelligence.get, {
    artifactKind: "plugin",
  });
  expect(report.searchReport.totalSearches7d).toBe(0);
  const response = await t.fetch(
    "/api/v1/search-insights?view=recommendations&artifactKind=plugin",
    {
      headers: { Authorization: "Bearer featured-api-fixture" },
    },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(FeaturedIntelligenceReportSchema.assert(await response.json())).toEqual(report);
  expect((await t.fetch("/api/v1/search-insights?view=recommendations")).status).toBe(401);
  expect(report.recommendations.candidates).toMatchObject([
    {
      id: "plugin:calendar",
      support: "adoption-only",
      search: null,
      adoption: {
        rank: 1,
        downloads: 40,
        installs: 3,
        periodEnd: now,
        rankingVersion: "unversioned",
      },
    },
  ]);
  await t.run(async (ctx) => {
    await ctx.db.insert("packageBadges", {
      packageId: ids.pkg,
      kind: "highlighted",
      byUserId: ids.staff,
      at: now,
    });
  });
  const changed = await t.action(internal.featuredIntelligence.getInternal, {
    artifactKind: "plugin",
  });
  expect(changed.recommendations.lineup.proposed).toMatchObject([
    { id: "plugin:calendar", change: "retain" },
  ]);
  expect(changed.recommendations.lineup.baseline).toEqual([
    { id: "plugin:calendar", version: "1.0.0", featuredAt: now },
  ]);
  expect(changed.recommendations.excluded).toEqual([]);
  // An old unfiltered snapshot must not let setup entries consume the first
  // 100 discovery slots, and membership remains visible beyond that limit.
  const setupIds = await t.run(async (ctx) => {
    const source = await ctx.db.get(ids.pkg);
    const { _id, _creationTime, latestReleaseId: _release, ...fields } = source!;
    const packages = [];
    for (let index = 0; index < 100; index++)
      packages.push(
        await ctx.db.insert("packages", {
          ...fields,
          tags: {},
          name: `setup-${index}`,
          normalizedName: `setup-${index}`,
          categories: ["channels"],
        }),
      );
    const snapshot = await ctx.db.query("packageLeaderboards").unique();
    await ctx.db.patch(snapshot!._id, {
      items: [
        ...packages.map((packageId) => ({ packageId, score: 100, downloads: 90, installs: 3 })),
        ...snapshot!.items,
      ],
    });
    return packages;
  });
  const filtered = await t.action(internal.featuredIntelligence.getInternal, {
    artifactKind: "plugin",
  });
  expect(filtered.recommendations.lineup.proposed).toMatchObject([
    { id: "plugin:calendar", adoption: { rank: 101 }, change: "retain" },
  ]);
  await t.run(async (ctx) => {
    for (const packageId of setupIds)
      await ctx.db.patch(packageId, { categories: ["productivity"] });
  });
  const beyondLimit = await t.action(internal.featuredIntelligence.getInternal, {
    artifactKind: "plugin",
  });
  expect(beyondLimit.adoption).toMatchObject({
    inspectedItems: 100,
    totalItems: 101,
    truncated: true,
  });
  expect(beyondLimit.recommendations.lineup.proposed).toMatchObject([
    { id: "plugin:calendar", support: "current-only", adoption: null, change: "retain" },
  ]);
  expect(beyondLimit.recommendations.lineup.shortfall).toBe(7);
  await t.run(async (ctx) => {
    const source = await ctx.db.get(ids.pkg);
    const { _id, _creationTime, ...fields } = source!;
    for (let index = 0; index < 101; index++) {
      const packageId = await ctx.db.insert("packages", {
        ...fields,
        family: "claw",
        name: `claw-${index}`,
        normalizedName: `claw-${index}`,
      });
      await ctx.db.insert("packageBadges", {
        packageId,
        kind: "highlighted",
        byUserId: ids.staff,
        at: now + index + 1,
      });
    }
  });
  const withoutClaws = await t.query(internal.featuredArtifacts.readCurrentFeaturedInternal, {
    artifactKind: "plugin",
  });
  expect(withoutClaws.map((entry) => entry.id)).toEqual(["plugin:calendar"]);

  expect(await t.run((ctx) => ctx.db.query("searchWeeklyDigests").collect())).toEqual([]);
});

it("reuses canonical skill ranks and exact completed-hour periods, and refuses stale public snapshots", async () => {
  const t = convexTest(schema, modules);
  registerWorkpool(t, "searchReports");
  const now = Date.UTC(2026, 8, 15, 12, 30);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const window = getCompletedRolling24HourWindow(now);
  const skillId = await t.run(async (ctx) => {
    const author = await ctx.db.insert("users", { handle: "author" });
    const skill = await ctx.db.insert("skills", {
      slug: "calendar",
      displayName: "Calendar",
      summary:
        "Manage your calendar events and schedule meetings with clear reminders for your team.",
      ownerUserId: author,
      tags: {},
      stats: { downloads: 60, stars: 2, versions: 1, comments: 0 },
      createdAt: now,
      updatedAt: now,
    });
    const version = await ctx.db.insert("skillVersions", {
      skillId: skill,
      version: "1.0.0",
      changelog: "Initial",
      files: [
        {
          path: "SKILL.md",
          size: 1,
          storageId: await ctx.storage.store(new Blob(["x"])),
          sha256: "b".repeat(64),
        },
      ],
      parsed: { frontmatter: {} },
      createdBy: author,
      createdAt: now,
      llmAnalysis: { status: "clean", checkedAt: now },
    });
    await ctx.db.patch(skill, { latestVersionId: version });
    await ctx.db.insert("skillSearchDigest", {
      skillId: skill,
      slug: "calendar",
      displayName: "Calendar",
      summary:
        "Manage your calendar events and schedule meetings with clear reminders for your team.",
      ownerUserId: author,
      ownerHandle: "author",
      ownerKind: "user",
      ownerName: "author",
      ownerDisplayName: "author",
      latestVersionId: version,
      latestVersionSkillId: skill,
      publicVersion: { status: "available", versionId: version },
      tags: {},
      stats: { downloads: 60, stars: 2, versions: 1, comments: 0 },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("canonicalTrendingSnapshots", {
      snapshotId: "skills-observed",
      kind: "skills",
      status: "ready",
      rankingVersion: CANONICAL_TRENDING_RANKING_VERSION,
      generatedAt: now,
      expiresAt: now + DAY,
      windowHours: 24,
      windowStartDay: Math.floor(now / DAY) - 1,
      windowEndDay: Math.floor(now / DAY),
      windowStartHour: window.startHour,
      windowEndHour: window.endHour,
      writtenItems: 1,
      totalItems: 1,
    });
    const id = `clawhub:${skill}`;
    await ctx.db.insert("canonicalTrendingItems", {
      snapshotId: "skills-observed",
      position: 0,
      lane: "clawhub-rising",
      sourceRef: { kind: "clawhub", skillId: skill },
      expiresAt: now + DAY,
      card: {
        id,
        source: "clawhub",
        slug: "calendar",
        displayName: "Calendar",
        summary:
          "Manage your calendar events and schedule meetings with clear reminders for your team.",

        canonicalUrl: "/author/skills/calendar",
        links: { canonical: "/author/skills/calendar", source: null },
        publisher: {
          kind: "user",
          handle: "author",
          displayName: "Author",
          image: null,
          official: false,
        },
        official: false,
        featured: false,
        install: { kind: "clawhub", reference: "author/calendar", sourceUrl: null },
        sourceIdentity: {
          id: String(skill),
          owner: "author",
          repo: null,
          host: null,
          lifetimeInstalls: null,
        },
        trust: {
          visibility: "public",
          installability: "installable",
          clawHubVerdict: null,
          upstreamScanners: null,
          sourceFreshness: "native",
        },
        metrics: {
          trending24hDownloads: 60,
          trending24hInstalls: 4,
          trending24hBookmarks: 2,
          lifetimeInstalls: null,
          lifetimeInstallsPeriod: "lifetime",
          updatedAt: now,
        },
      },
    });
    return skill;
  });
  const report = await t.action(internal.featuredIntelligence.getInternal, {
    artifactKind: "skill",
  });
  expect(report.recommendations.candidates).toMatchObject([
    {
      id: `clawhub:${skillId}`,
      artifactKind: "skill",
      support: "adoption-only",
      adoption: {
        source: "clawhub-rising",
        rank: 1,
        downloads: 60,
        installs: 4,
        bookmarks: 2,
        periodStart: window.startHour * 3_600_000,
        periodEnd: (window.endHour + 1) * 3_600_000,
      },
    },
  ]);
  const queued = await t.mutation(internal.searchReports.startInternal, {
    view: "recommendations",
    artifactKind: "skill",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const saved = await t.action(internal.searchReports.getInternal, { reportId: queued.reportId });
  if (saved.status !== "ready" || saved.view !== "recommendations")
    throw new Error("Expected saved skill evidence");
  expect(saved.report.adoption.status).toBe("available");
  vi.setSystemTime(now + 3 * 3_600_000);
  const stale = await t.action(internal.featuredIntelligence.getInternal, {
    artifactKind: "skill",
  });
  expect(stale.adoption.status).toBe("unavailable");
  expect(stale.recommendations.candidates).toEqual([]);
  const expired = await t.action(internal.searchReports.getInternal, { reportId: queued.reportId });
  if (expired.status !== "ready" || expired.view !== "recommendations")
    throw new Error("Expected retained evidence with stale adoption withheld");
  expect(expired.report.adoption.status).toBe("unavailable");
  expect(expired.report.recommendations.candidates).toEqual([]);
  expect(expired.report.searchReport.generatedAt).toBe(saved.report.searchReport.generatedAt);
});

it("denies anonymous and ordinary users access to candidate evidence", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.action(api.featuredIntelligence.get, { artifactKind: "plugin" }),
  ).rejects.toThrow();
  const user = await t.run((ctx) => ctx.db.insert("users", { role: "user" }));
  await expect(
    t.withIdentity({ subject: user }).action(api.featuredIntelligence.get, {
      artifactKind: "skill",
    }),
  ).rejects.toThrow();
});
