/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const LOCAL_ENV = {
  CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
};

const CANARY_EXTERNAL_ID = "patrick-erichsen/skills/html";
const CANARY_COMMIT = "050daba89f6b6636470add5cb300aac46a412cf8";
const CANARY_CONTENT_HASH = "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f";

const CANARY_CONTROL = {
  actor: "codex-test",
  reason: "exercise the controlled hidden metadata canary",
  confirm: "enable-skills-sh-fixture-control",
  mode: "fixture" as const,
  discoveryEnabled: true,
  writesEnabled: true,
  scanPlanningEnabled: true,
  scanAdmissionEnabled: false,
  maxEntriesPerRun: 1,
  maxEntriesPerBatch: 1,
  maxWritesPerBatch: 2,
  maxPlannedScans: 1,
  maxScanAdmissionsPerBatch: 0,
  maxScanAdmissionsPerRun: 0,
  maxScanAdmissionsPerDay: 0,
  maxCatalogQueued: 0,
  maxCatalogInFlight: 0,
  maxNativeQueued: 0,
  maxNativeInFlight: 0,
  realScanAllowlist: [] as string[],
};

const SOURCE_VERIFICATION = {
  githubOwnerId: 20_157_849,
  githubCommit: CANARY_COMMIT,
  githubContentHash: CANARY_CONTENT_HASH,
  githubCheckedAt: "2026-07-22T05:00:00.000Z",
  githubFetches: 4,
};

type CatalogTest = ReturnType<typeof convexTest>;

function useLocalEnvironment() {
  for (const [name, value] of Object.entries(LOCAL_ENV)) vi.stubEnv(name, value);
}

async function configureCanary(t: CatalogTest) {
  return await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, CANARY_CONTROL);
}

async function runCanary(t: CatalogTest) {
  const started = await t.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
    fixtureId: "patrick-html-canary-v1",
    actor: "codex-test",
    reason: "apply one controlled hidden metadata canary",
    sourceVerification: SOURCE_VERIFICATION,
  });
  const run = await t.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
    runId: started.runId,
  });
  return { runId: started.runId, run };
}

async function seedNativeSkill(
  t: CatalogTest,
  options: {
    exactSource: boolean;
    downloads: number;
  },
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      handle: "native-owner",
      displayName: "Native Owner",
      role: "user",
    });
    let githubSourceId: Id<"githubSkillSources"> | undefined;
    if (options.exactSource) {
      githubSourceId = await ctx.db.insert("githubSkillSources", {
        repo: "Patrick-Erichsen/skills",
        lastSyncStatus: "ok",
        createdAt: 1,
        updatedAt: 1,
      });
    }
    const skillId = await ctx.db.insert("skills", {
      slug: "html",
      displayName: options.exactSource ? "HTML Artifact Chooser" : "Native HTML",
      ownerUserId: userId,
      ...(githubSourceId
        ? {
            installKind: "github" as const,
            githubSourceId,
            githubPath: "skills/html",
            githubCurrentCommit: CANARY_COMMIT,
            githubCurrentContentHash: CANARY_CONTENT_HASH,
            githubCurrentStatus: "present" as const,
            githubCurrentCheckedAt: 1,
            githubScanStatus: "clean" as const,
          }
        : {}),
      tags: {},
      moderationStatus: "active",
      statsDownloads: options.downloads,
      statsStars: 0,
      statsInstallsCurrent: 0,
      statsInstallsAllTime: 0,
      stats: {
        downloads: options.downloads,
        stars: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        versions: 0,
        comments: 0,
      },
      createdAt: 1,
      updatedAt: 1,
    });
    return skillId;
  });
}

describe("skills.sh controlled hidden metadata canary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("records a new external skill without creating native state", async () => {
    useLocalEnvironment();
    const t = convexTest(schema, modules);
    await configureCanary(t);

    const { runId, run } = await runCanary(t);
    const readback = await t.query(internal.skillsShCatalog.getRunReconciliationInternal, {
      runId,
    });

    expect(run).toMatchObject({
      status: "completed",
      counts: {
        observed: 1,
        inserted: 1,
        newExternal: 1,
        exactNativeMatches: 0,
        routeCollisions: 0,
        claimOpportunities: 1,
        scansPlanned: 1,
        scansAdmitted: 0,
      },
    });
    expect(readback).toMatchObject({
      reconciled: true,
      mismatches: [],
      entries: [
        {
          externalId: CANARY_EXTERNAL_ID,
          githubOwnerId: 20_157_849,
          githubPath: "skills/html",
          githubCommit: CANARY_COMMIT,
          githubContentHash: CANARY_CONTENT_HASH,
          publicVisible: false,
          reconciliation: {
            kind: "new",
            claimOpportunity: true,
            claimPublisherHandle: "patrick-erichsen",
          },
          resolution: {
            installable: false,
          },
        },
      ],
    });
    expect(await t.run(async (ctx) => await ctx.db.query("skills").collect())).toHaveLength(0);
    expect(
      await t.run(async (ctx) => await ctx.db.query("securityScanJobs").collect()),
    ).toHaveLength(0);
  });

  it("records an exact native match and preserves its downloads", async () => {
    useLocalEnvironment();
    const t = convexTest(schema, modules);
    const nativeSkillId = await seedNativeSkill(t, { exactSource: true, downloads: 143 });
    await configureCanary(t);

    const { runId, run } = await runCanary(t);
    const readback = await t.query(internal.skillsShCatalog.getRunReconciliationInternal, {
      runId,
    });
    const native = await t.run(async (ctx) => await ctx.db.get(nativeSkillId));

    expect(run.counts).toMatchObject({
      newExternal: 0,
      exactNativeMatches: 1,
      routeCollisions: 0,
    });
    expect(readback.entries[0]).toMatchObject({
      reconciliation: {
        kind: "exact-native",
        nativeSkillId,
        nativeStatsDownloads: 143,
        claimOpportunity: true,
      },
    });
    expect(native).toMatchObject({
      _id: nativeSkillId,
      statsDownloads: 143,
      stats: { downloads: 143 },
      githubCurrentCommit: CANARY_COMMIT,
      githubCurrentContentHash: CANARY_CONTENT_HASH,
    });
  });

  it("records a route collision without changing or attaching the native skill", async () => {
    useLocalEnvironment();
    const t = convexTest(schema, modules);
    const nativeSkillId = await seedNativeSkill(t, { exactSource: false, downloads: 77 });
    await configureCanary(t);

    const { runId, run } = await runCanary(t);
    const readback = await t.query(internal.skillsShCatalog.getRunReconciliationInternal, {
      runId,
    });
    const native = await t.run(async (ctx) => await ctx.db.get(nativeSkillId));

    expect(run.counts).toMatchObject({
      newExternal: 0,
      exactNativeMatches: 0,
      routeCollisions: 1,
    });
    expect(readback.entries[0]).toMatchObject({
      reconciliation: {
        kind: "route-collision",
        nativeSkillId,
        nativeStatsDownloads: 77,
        claimOpportunity: true,
      },
    });
    expect(native).toMatchObject({
      _id: nativeSkillId,
      statsDownloads: 77,
      stats: { downloads: 77 },
    });
    expect(native?.ownerPublisherId).toBeUndefined();
  });

  it("reruns idempotently and rolls back only the hidden canary metadata", async () => {
    useLocalEnvironment();
    const t = convexTest(schema, modules);
    const nativeSkillId = await seedNativeSkill(t, { exactSource: false, downloads: 91 });
    await configureCanary(t);

    const first = await runCanary(t);
    const repeated = await runCanary(t);
    expect(repeated.run.counts).toMatchObject({
      observed: 1,
      inserted: 0,
      updated: 0,
      unchanged: 1,
      scansPlanned: 0,
      routeCollisions: 1,
    });

    const rollback = await t.mutation(internal.skillsShCatalog.rollbackFixtureRunInternal, {
      runId: repeated.runId,
      actor: "codex-test",
      reason: "remove only the controlled canary metadata",
      confirm: "rollback-skills-sh-controlled-canary",
    });
    const native = await t.run(async (ctx) => await ctx.db.get(nativeSkillId));
    const catalogEntries = await t.run(
      async (ctx) => await ctx.db.query("skillsShCatalogEntries").collect(),
    );

    expect(rollback).toMatchObject({
      fixtureId: "patrick-html-canary-v1",
      deletedEntries: 1,
      nativeSkillsChanged: 0,
    });
    expect(catalogEntries).toHaveLength(0);
    expect(native).toMatchObject({
      _id: nativeSkillId,
      statsDownloads: 91,
      stats: { downloads: 91 },
    });
    expect(first.runId).not.toBe(repeated.runId);
  });
});
