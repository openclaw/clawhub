/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const modules = import.meta.glob("./**/*.ts");
const path = "/api/v1/skills-sh/humanlayer/skills/show-me/featured";
beforeEach(() => {
  vi.stubEnv("CLAWHUB_ENV", "test");
  vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const data = await t.run(async (ctx) => {
    const actor = await ctx.db.insert("users", { handle: "curator", role: "moderator" });
    const reader = await ctx.db.insert("users", { handle: "reader", role: "user" });
    for (const [userId, token] of [
      [actor, "staff-fixture"],
      [reader, "reader-fixture"],
    ] as const) {
      await ctx.db.insert("apiTokens", {
        userId,
        label: "fixture",
        prefix: "fixture",
        tokenHash: await hashToken(token),
        createdAt: 1,
      });
    }
    const control = await ctx.db.insert("skillsShCatalogControls", {
      key: "global",
      mode: "staging-live",
      discoveryEnabled: true,
      writesEnabled: false,
      scanPlanningEnabled: false,
      scanAdmissionEnabled: false,
      publicVisibilityEnabled: false,
      mirrorPublicVisibilityEnabled: true,
      paused: false,
      maxEntriesPerRun: 100,
      maxEntriesPerBatch: 10,
      maxWritesPerBatch: 100,
      maxPlannedScans: 0,
      maxScanAdmissionsPerBatch: 0,
      maxScanAdmissionsPerRun: 0,
      maxScanAdmissionsPerDay: 0,
      maxCatalogQueued: 0,
      maxCatalogInFlight: 0,
      maxNativeQueued: 0,
      maxNativeInFlight: 0,
      realScanAllowlist: [],
      updatedBy: "fixture",
      reason: "fixture",
      updatedAt: 1,
    });
    const run = await ctx.db.insert("skillsShMirrorRuns", {
      snapshotId: "fixture",
      status: "completed",
      sourceTotal: 1,
      sourcePageSize: 1,
      sourceMeasuredAt: "2026-09-25T00:00:00Z",
      page: 0,
      offset: 0,
      counts: {
        observed: 1,
        inserted: 1,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        conflicts: 0,
        detailsInserted: 1,
        detailsUpdated: 0,
        detailsUnchanged: 0,
        detailsMissing: 0,
        detailsTruncated: 0,
        tombstoned: 0,
        reactivated: 0,
        scansPlanned: 0,
        scansAdmitted: 0,
      },
      operations: { functionCalls: 1, dbReads: 0, dbWrites: 1, sourceRequests: 1, sourceBytes: 1 },
      actor: "fixture",
      reason: "fixture",
      startedAt: 1,
      updatedAt: 1,
    });
    const digest = await ctx.db.insert("skillsShMirrorDigests", {
      externalId: "humanlayer/skills/show-me",
      sourceType: "github",
      owner: "humanlayer",
      repo: "skills",
      slug: "show-me",
      normalizedSlug: "show-me",
      normalizedSlugFirstToken: "show",
      displayName: "show-me",
      normalizedDisplayName: "show-me",
      normalizedDisplayNameFirstToken: "show",
      searchSummary: "Explain code visually",
      searchText: "show-me humanlayer skills explain code visually",
      sourceUrl: "https://skills.sh/humanlayer/skills/show-me",
      canonicalRepoUrl: "https://github.com/humanlayer/skills",
      githubPath: "plugins/show-me/skills/show-me",
      githubCommit: "a".repeat(40),
      sourceContentHash: "b".repeat(64),
      upstreamInstalls: 21827,
      upstreamScanners: {
        genAgentTrustHub: { status: "pass" },
        socket: { status: "pass" },
        snyk: { status: "pass" },
      },
      inferredCategories: ["developer-tools"],
      inferredTopics: ["visualization"],
      sourceFreshnessStatus: "observed-only",
      detailStatus: "available",
      observationFingerprint: "fixture",
      sourceSnapshotId: "fixture",
      lastObservedRunId: run,
      active: true,
      publicVisible: true,
      installable: true,
      firstObservedAt: 1,
      lastObservedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return { actor, digest, control };
  });
  const set = (featured: boolean, token = "staff-fixture") =>
    t.fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ featured }),
    });
  return { t, set, ...data };
}

it("staff can feature an existing skills.sh entry without republishing it, and unfeature it", async () => {
  const { t, set } = await fixture();
  const response = await set(true);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    featured: true,
    externalId: "humanlayer/skills/show-me",
  });
  const featured = (await t.query(api.featuredSkills.listPublic, {})).page;
  expect(featured).toHaveLength(1);
  expect(featured[0]).toMatchObject({
    external: {
      source: "skills-sh",
      featured: true,
      canonicalUrl: "/skills-sh/humanlayer/skills/show-me",
    },
  });
  const selectedAt = await t.run(
    async (ctx) => (await ctx.db.query("featuredSelections").first())?.externalSkills?.[0].at,
  );
  expect((await set(true)).status).toBe(200);
  expect(
    await t.run(
      async (ctx) => (await ctx.db.query("featuredSelections").first())?.externalSkills?.[0].at,
    ),
  ).toBe(selectedAt);
  expect((await set(false)).status).toBe(200);
  expect((await t.query(api.featuredSkills.listPublic, {})).page).toEqual([]);
});

async function seedNative(
  t: Awaited<ReturnType<typeof fixture>>["t"],
  actor: Awaited<ReturnType<typeof fixture>>["actor"],
  count: number,
) {
  const ids = await t.run(async (ctx) => {
    const seededIds = [];
    for (let i = 0; i < count; i++) {
      const skillId = await ctx.db.insert("skills", {
        slug: `native-${i}`,
        displayName: `Native ${i}`,
        ownerUserId: actor,
        moderationStatus: "active",
        tags: {},
        badges: {},
        stats: { comments: 0, downloads: 1, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.0.0",
        changelog: "Fixture",
        files: [],
        parsed: { frontmatter: {} },
        createdBy: actor,
        createdAt: 1,
        llmAnalysis: { status: "clean", checkedAt: 1 },
      });
      await ctx.db.patch(skillId, { latestVersionId: versionId, tags: { latest: versionId } });
      seededIds.push(skillId);
    }
    return seededIds;
  });
  const staff = t.withIdentity({ subject: `${actor}|session` });
  for (const skillId of ids)
    await staff.mutation(api.skills.setBatch, { skillId, batch: "highlighted" });
  return ids;
}

it("requires staff and never lets a selection override source visibility", async () => {
  const { t, set, digest, control } = await fixture();
  expect((await set(true, "unknown-fixture")).status).toBe(401);
  expect((await set(true, "reader-fixture")).status).toBe(403);
  await t.run((ctx) => ctx.db.patch(digest, { githubPath: undefined }));
  expect((await set(true)).status).toBe(400);
  await t.run((ctx) => ctx.db.patch(digest, { githubPath: "plugins/show-me/skills/show-me" }));
  expect((await set(true)).status).toBe(200);
  await t.run((ctx) => ctx.db.patch(digest, { publicVisible: false }));
  expect((await t.query(api.featuredSkills.listPublic, {})).page).toEqual([]);
  await t.run((ctx) => ctx.db.patch(digest, { publicVisible: true }));
  await t.run((ctx) => ctx.db.patch(control, { mirrorPublicVisibilityEnabled: false }));
  expect((await t.query(api.featuredSkills.listPublic, {})).page).toEqual([]);
  expect((await set(false)).status).toBe(200);
});

it("shares the sixteen-slot limit and orders new external selections before older native selections", async () => {
  const { t, set, actor } = await fixture();
  const ids = await seedNative(t, actor, 16);
  const full = await set(true);
  expect(full.status).toBe(400);
  expect(await full.text()).toContain("limited to 16");
  const staff = t.withIdentity({ subject: `${actor}|session` });
  await staff.mutation(api.skills.setBatch, { skillId: ids[0], batch: undefined });
  expect((await set(true)).status).toBe(200);
  const entries = (await t.query(api.featuredSkills.listPublic, {})).page;
  expect(entries).toHaveLength(16);
  expect(entries[0]).toMatchObject({ external: { id: "skills-sh:humanlayer/skills/show-me" } });
  await expect(
    staff.mutation(api.skills.setBatch, { skillId: ids[0], batch: "highlighted" }),
  ).rejects.toThrow("limited to 16");
  expect(
    (await t.query(api.featuredSkills.listPublic, { query: "show-me" })).page.map((item) =>
      "external" in item ? item.external.slug : item.skill.slug,
    ),
  ).toEqual(["show-me"]);
  expect((await t.query(api.featuredSkills.listPublic, { categorySlug: "writing" })).page).toEqual(
    [],
  );
  const hits = await t.query(internal.search.getExternalSkillSearchCandidates, {
    query: "show-me",
    highlightedOnly: true,
  });
  expect(hits).toHaveLength(1);
  expect(hits[0].featured).toBe(true);
  expect((await set(false)).status).toBe(200);
  expect(
    await t.query(internal.search.getExternalSkillSearchCandidates, {
      query: "show-me",
      highlightedOnly: true,
    }),
  ).toEqual([]);
});
