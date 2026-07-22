/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import canarySkillMarkdown from "./fixtures/patrick-html-canary-SKILL.txt?raw";
import { extractDigestFields } from "./lib/skillSearchDigest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const LOCAL_ENV = {
  CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
};

const TEST_ENV = {
  CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
  CLAWHUB_DISABLE_CRONS: "1",
  CLAWHUB_ENV: "test",
  CONVEX_CLOUD_URL: "https://academic-chihuahua-392.convex.cloud",
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

function useEnvironment(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
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

async function sha256Hex(value: Blob | string) {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(await value.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function storeCanaryArtifact(t: CatalogTest, content = canarySkillMarkdown) {
  const blob = new Blob([content], { type: "text/markdown" });
  const storageId = await t.run(async (ctx) => await ctx.storage.store(blob));
  const sha256 = await sha256Hex(blob);
  return {
    externalId: CANARY_EXTERNAL_ID,
    artifactContentHash: await sha256Hex(`SKILL.md\0${sha256}\n`),
    files: [
      {
        path: "SKILL.md",
        size: blob.size,
        storageId,
        sha256,
        contentType: "text/markdown",
      },
    ],
  };
}

async function prepareScannedCanary(t: CatalogTest) {
  await configureCanary(t);
  await runCanary(t);
  await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
    ...CANARY_CONTROL,
    mode: "staging-live",
    scanAdmissionEnabled: true,
    publicVisibilityEnabled: true,
    maxWritesPerBatch: 7,
    maxScanAdmissionsPerBatch: 1,
    maxScanAdmissionsPerRun: 1,
    maxScanAdmissionsPerDay: 1,
    maxCatalogQueued: 1,
    maxCatalogInFlight: 1,
    realScanAllowlist: [CANARY_EXTERNAL_ID],
  });
  const actorUserId = await t.run(
    async (ctx) =>
      await ctx.db.insert("users", {
        handle: "catalog-test-operator",
        displayName: "Catalog Test Operator",
        role: "admin",
      }),
  );
  const { runId } = await t.mutation(
    internal.skillsShCatalog.startControlledCanaryScanRunInternal,
    {
      actor: "catalog-test-operator",
      reason: "scan one exact controlled canary",
    },
  );
  const artifact = await storeCanaryArtifact(t);
  await t.action(internal.skillsShCatalog.admitRealScansInternal, {
    runId,
    externalIds: [CANARY_EXTERNAL_ID],
    actorUserId,
    artifacts: [artifact],
  });
  const [attempt] = await t.run(async (ctx) =>
    (await ctx.db.query("skillsShCatalogScanAttempts").collect()).filter(
      (candidate) => candidate.runId === runId && candidate.status === "queued",
    ),
  );
  if (!attempt?.skillScanRequestId || !attempt.securityScanJobId || !attempt.artifactContentHash) {
    throw new Error("controlled canary scan admission did not create linked work");
  }
  await t.run(async (ctx) => {
    await ctx.db.patch(attempt._id, { status: "running", updatedAt: Date.now() });
    await ctx.db.patch(attempt.skillScanRequestId!, {
      status: "running",
      updatedAt: Date.now(),
    });
    await ctx.db.patch(attempt.securityScanJobId!, {
      status: "running",
      leaseToken: "canary-lease",
      leaseExpiresAt: Date.now() + 60_000,
      workerId: "canary-worker",
      updatedAt: Date.now(),
    });
  });
  return attempt as Doc<"skillsShCatalogScanAttempts"> & {
    skillScanRequestId: Id<"skillScanRequests">;
    securityScanJobId: Id<"securityScanJobs">;
    artifactContentHash: string;
  };
}

async function completeScannedCanary(
  t: CatalogTest,
  attempt: Awaited<ReturnType<typeof prepareScannedCanary>>,
  verdict: "clean" | "suspicious" | "malicious" | "failed",
) {
  return await t.mutation(internal.securityScan.completeCatalogSkillScanJobInternal, {
    attemptId: attempt._id,
    scanId: attempt.skillScanRequestId,
    jobId: attempt.securityScanJobId,
    leaseToken: "canary-lease",
    artifactContentHash: attempt.artifactContentHash,
    verdict,
    runId: "canary-clawscan-run",
    llmAnalysis: { status: verdict, checkedAt: Date.now() },
  });
}

async function seedNativeSkill(
  t: CatalogTest,
  options: {
    exactSource: boolean;
    downloads: number;
    bookmarks?: number;
    openClawInstalls?: number;
    skillsShInstalls?: number;
    githubStars?: number;
    seedDigest?: boolean;
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
      statsStars: options.bookmarks ?? 0,
      statsInstallsCurrent: options.openClawInstalls ?? 0,
      statsInstallsAllTime: options.openClawInstalls ?? 0,
      statsSkillsShInstalls: options.skillsShInstalls,
      statsGithubStars: options.githubStars,
      stats: {
        downloads: options.downloads,
        stars: options.bookmarks ?? 0,
        installsCurrent: options.openClawInstalls ?? 0,
        installsAllTime: options.openClawInstalls ?? 0,
        versions: 0,
        comments: 0,
      },
      createdAt: 1,
      updatedAt: 1,
    });
    if (options.seedDigest) {
      const skill = await ctx.db.get(skillId);
      if (!skill) throw new Error("seeded native skill missing");
      await ctx.db.insert("skillSearchDigest", {
        ...extractDigestFields(skill),
        ownerHandle: "native-owner",
        ownerKind: "user",
        ownerName: "Native Owner",
        ownerDisplayName: "Native Owner",
      });
    }
    return skillId;
  });
}

describe("skills.sh controlled hidden metadata canary", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("records a new external skill without creating native state", async () => {
    useEnvironment(LOCAL_ENV);
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

  it("attaches upstream metrics to an exact native match without rewriting native counters", async () => {
    vi.useFakeTimers();
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    const nativeSkillId = await seedNativeSkill(t, {
      exactSource: true,
      downloads: 143,
      bookmarks: 5,
      openClawInstalls: 11,
      skillsShInstalls: 2,
      githubStars: 300,
      seedDigest: true,
    });
    await configureCanary(t);

    const { runId, run } = await runCanary(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const readback = await t.query(internal.skillsShCatalog.getRunReconciliationInternal, {
      runId,
    });
    const native = await t.run(async (ctx) => await ctx.db.get(nativeSkillId));
    const digest = await t.run(async (ctx) =>
      ctx.db
        .query("skillSearchDigest")
        .withIndex("by_skill", (q) => q.eq("skillId", nativeSkillId))
        .unique(),
    );

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
      statsStars: 5,
      statsInstallsCurrent: 11,
      statsInstallsAllTime: 11,
      statsSkillsShInstalls: 17,
      statsGithubStars: 321,
      stats: {
        downloads: 143,
        stars: 5,
        installsCurrent: 11,
        installsAllTime: 11,
      },
      githubCurrentCommit: CANARY_COMMIT,
      githubCurrentContentHash: CANARY_CONTENT_HASH,
    });
    expect(digest).toMatchObject({
      statsDownloads: 143,
      statsSkillsShInstalls: 17,
      statsGithubStars: 321,
    });
  });

  it("records a route collision without changing or attaching the native skill", async () => {
    useEnvironment(LOCAL_ENV);
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
    useEnvironment(LOCAL_ENV);
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

  it.each(["clean", "suspicious"] as const)(
    "publishes only the exact %s canary attempt and resolves a pinned GitHub install",
    async (verdict) => {
      useEnvironment(TEST_ENV);
      const t = convexTest(schema, modules);
      const attempt = await prepareScannedCanary(t);

      await expect(completeScannedCanary(t, attempt, verdict)).resolves.toEqual({
        ok: true,
        applied: true,
        publicVisible: true,
      });
      await expect(
        t.query(api.skillsShCatalog.getPublicEntry, {
          owner: "patrick-erichsen",
          repo: "skills",
          slug: "html",
        }),
      ).resolves.toMatchObject({
        ref: "skills-sh/patrick-erichsen/skills/html",
        route: "/skills-sh/patrick-erichsen/skills/html",
        artifact: {
          contentHash: attempt.artifactContentHash,
          files: [
            {
              path: "SKILL.md",
              size: expect.any(Number),
              sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
              contentType: "text/markdown",
            },
          ],
        },
        security: {
          verdict,
          source: "clawhub",
          attemptId: attempt._id,
        },
        install: {
          ok: true,
          slug: "skills-sh/patrick-erichsen/skills/html",
          installKind: "github",
          github: {
            repo: "patrick-erichsen/skills",
            path: "skills/html",
            commit: CANARY_COMMIT,
            contentHash: CANARY_CONTENT_HASH,
          },
        },
      });
    },
  );

  it("omits verification artifacts when the scan request no longer matches the approved attempt", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const attempt = await prepareScannedCanary(t);
    await completeScannedCanary(t, attempt, "clean");
    await t.run(async (ctx) => {
      await ctx.db.patch(attempt.skillScanRequestId, {
        sha256hash: "0".repeat(64),
      });
    });

    await expect(
      t.query(api.skillsShCatalog.getPublicEntry, {
        owner: "patrick-erichsen",
        repo: "skills",
        slug: "html",
      }),
    ).resolves.toMatchObject({
      ref: "skills-sh/patrick-erichsen/skills/html",
      artifact: null,
      security: { attemptId: attempt._id, verdict: "clean" },
    });
  });

  it("reuses an exact completed canary scan without hiding the published entry", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const attempt = await prepareScannedCanary(t);
    await completeScannedCanary(t, attempt, "clean");

    await expect(
      t.mutation(internal.skillsShCatalog.startControlledCanaryScanRunInternal, {
        actor: "catalog-test-operator",
        reason: "repeat the exact approved canary",
      }),
    ).resolves.toEqual({
      runId: attempt.runId,
      externalId: CANARY_EXTERNAL_ID,
      reused: true,
    });
    await expect(
      t.query(api.skillsShCatalog.getPublicEntry, {
        owner: "patrick-erichsen",
        repo: "skills",
        slug: "html",
      }),
    ).resolves.toMatchObject({
      ref: "skills-sh/patrick-erichsen/skills/html",
      security: { attemptId: attempt._id, verdict: "clean" },
    });
    const attempts = await t.run(async (ctx) =>
      ctx.db.query("skillsShCatalogScanAttempts").collect(),
    );
    expect(attempts).toHaveLength(1);
  });

  it("does not reuse or block on an exact deterministic fixture verdict", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    await configureCanary(t);
    const { runId: fixtureRunId } = await runCanary(t);
    await t.run(async (ctx) => {
      const entry = await ctx.db
        .query("skillsShCatalogEntries")
        .withIndex("by_external_id", (q) => q.eq("externalId", CANARY_EXTERNAL_ID))
        .unique();
      if (!entry) throw new Error("controlled canary entry was not created");
      await ctx.db.insert("skillsShCatalogScanAttempts", {
        entryId: entry._id,
        runId: fixtureRunId,
        externalId: entry.externalId,
        githubOwnerId: entry.githubOwnerId,
        owner: entry.owner,
        repo: entry.repo,
        slug: entry.slug,
        githubPath: entry.githubPath,
        githubCommit: entry.githubCommit,
        githubContentHash: entry.githubContentHash,
        sourceContentHash: entry.sourceContentHash,
        source: "skills-sh-catalog-fixture",
        dispatchKind: "deterministic",
        priority: "low",
        status: "succeeded",
        verdict: "clean",
        completedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...CANARY_CONTROL,
      mode: "staging-live",
      scanAdmissionEnabled: true,
      publicVisibilityEnabled: true,
      maxWritesPerBatch: 7,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
      realScanAllowlist: [CANARY_EXTERNAL_ID],
    });
    const actorUserId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          handle: "catalog-test-operator",
          displayName: "Catalog Test Operator",
          role: "admin",
        }),
    );

    const started = await t.mutation(
      internal.skillsShCatalog.startControlledCanaryScanRunInternal,
      {
        actor: "catalog-test-operator",
        reason: "replace deterministic evidence with a real catalog scan",
      },
    );
    expect(started).toMatchObject({
      externalId: CANARY_EXTERNAL_ID,
      reused: false,
    });
    expect(started.runId).not.toBe(fixtureRunId);
    await expect(
      t.action(internal.skillsShCatalog.admitRealScansInternal, {
        runId: started.runId,
        externalIds: [CANARY_EXTERNAL_ID],
        actorUserId,
        artifacts: [await storeCanaryArtifact(t)],
      }),
    ).resolves.toMatchObject({ admitted: 1, skipped: 0 });
  });

  it("does not let a stale real verdict block an exact replacement scan", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    await configureCanary(t);
    const { runId: fixtureRunId } = await runCanary(t);
    await t.run(async (ctx) => {
      const entry = await ctx.db
        .query("skillsShCatalogEntries")
        .withIndex("by_external_id", (q) => q.eq("externalId", CANARY_EXTERNAL_ID))
        .unique();
      if (!entry) throw new Error("controlled canary entry was not created");
      await ctx.db.insert("skillsShCatalogScanAttempts", {
        entryId: entry._id,
        runId: fixtureRunId,
        externalId: entry.externalId,
        githubOwnerId: entry.githubOwnerId,
        owner: entry.owner,
        repo: entry.repo,
        slug: entry.slug,
        githubPath: entry.githubPath,
        githubCommit: "1".repeat(40),
        githubContentHash: entry.githubContentHash,
        sourceContentHash: entry.sourceContentHash,
        source: "skills-sh-catalog-test",
        dispatchKind: "real",
        priority: "low",
        status: "succeeded",
        verdict: "clean",
        completedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...CANARY_CONTROL,
      mode: "staging-live",
      scanAdmissionEnabled: true,
      publicVisibilityEnabled: true,
      maxWritesPerBatch: 7,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 2,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
      realScanAllowlist: [CANARY_EXTERNAL_ID],
    });
    const actorUserId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          handle: "catalog-test-operator",
          displayName: "Catalog Test Operator",
          role: "admin",
        }),
    );
    const started = await t.mutation(
      internal.skillsShCatalog.startControlledCanaryScanRunInternal,
      {
        actor: "catalog-test-operator",
        reason: "replace stale real evidence with an exact scan",
      },
    );

    await expect(
      t.action(internal.skillsShCatalog.admitRealScansInternal, {
        runId: started.runId,
        externalIds: [CANARY_EXTERNAL_ID],
        actorUserId,
        artifacts: [await storeCanaryArtifact(t)],
      }),
    ).resolves.toMatchObject({ admitted: 1, skipped: 0 });
  });

  it("rejects a scan artifact that differs from the authenticated GitHub folder", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    await configureCanary(t);
    await runCanary(t);
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...CANARY_CONTROL,
      mode: "staging-live",
      scanAdmissionEnabled: true,
      publicVisibilityEnabled: true,
      maxWritesPerBatch: 7,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 1,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
      realScanAllowlist: [CANARY_EXTERNAL_ID],
    });
    const actorUserId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          handle: "catalog-test-operator",
          displayName: "Catalog Test Operator",
          role: "admin",
        }),
    );
    const { runId } = await t.mutation(
      internal.skillsShCatalog.startControlledCanaryScanRunInternal,
      {
        actor: "catalog-test-operator",
        reason: "reject changed canary content",
      },
    );
    const changedArtifact = await storeCanaryArtifact(t, `${canarySkillMarkdown}\nchanged\n`);

    await expect(
      t.action(internal.skillsShCatalog.admitRealScansInternal, {
        runId,
        externalIds: [CANARY_EXTERNAL_ID],
        actorUserId,
        artifacts: [changedArtifact],
      }),
    ).rejects.toThrow("real Test scan artifact does not match authenticated GitHub content");
    const attempts = await t.run(async (ctx) =>
      ctx.db.query("skillsShCatalogScanAttempts").collect(),
    );
    expect(attempts).toHaveLength(0);
  });

  it.each(["malicious", "failed"] as const)(
    "keeps a %s canary hidden and non-installable",
    async (verdict) => {
      useEnvironment(TEST_ENV);
      const t = convexTest(schema, modules);
      const attempt = await prepareScannedCanary(t);

      await expect(completeScannedCanary(t, attempt, verdict)).resolves.toEqual({
        ok: true,
        applied: true,
        publicVisible: false,
      });
      await expect(
        t.query(api.skillsShCatalog.getPublicEntry, {
          owner: "patrick-erichsen",
          repo: "skills",
          slug: "html",
        }),
      ).resolves.toBeNull();
    },
  );

  it.each(["malicious", "failed"] as const)(
    "admits a fresh exact attempt after a %s canary scan",
    async (verdict) => {
      useEnvironment(TEST_ENV);
      const t = convexTest(schema, modules);
      const blockedAttempt = await prepareScannedCanary(t);
      await completeScannedCanary(t, blockedAttempt, verdict);
      await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
        ...CANARY_CONTROL,
        mode: "staging-live",
        scanAdmissionEnabled: true,
        publicVisibilityEnabled: true,
        maxWritesPerBatch: 7,
        maxScanAdmissionsPerBatch: 1,
        maxScanAdmissionsPerRun: 1,
        maxScanAdmissionsPerDay: 2,
        maxCatalogQueued: 1,
        maxCatalogInFlight: 1,
        realScanAllowlist: [CANARY_EXTERNAL_ID],
      });
      const retry = await t.mutation(
        internal.skillsShCatalog.startControlledCanaryScanRunInternal,
        {
          actor: "catalog-test-operator",
          reason: `retry the exact canary after a ${verdict} scan`,
        },
      );
      expect(retry).toMatchObject({
        externalId: CANARY_EXTERNAL_ID,
        reused: false,
      });
      expect(retry.runId).not.toBe(blockedAttempt.runId);
      const actorUserId = await t.run(
        async (ctx) =>
          (await ctx.db
            .query("users")
            .filter((q) => q.eq(q.field("handle"), "catalog-test-operator"))
            .unique())!._id,
      );
      const artifact = await storeCanaryArtifact(t);
      await expect(
        t.action(internal.skillsShCatalog.admitRealScansInternal, {
          runId: retry.runId,
          externalIds: [CANARY_EXTERNAL_ID],
          actorUserId,
          artifacts: [artifact],
        }),
      ).resolves.toMatchObject({ admitted: 1, skipped: 0 });
    },
  );

  it.each([
    ["githubPath", "skills/changed"],
    ["githubCommit", "1".repeat(40)],
    ["githubContentHash", "2".repeat(64)],
  ] as const)("rejects a stale callback after the entry %s changes", async (field, value) => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const attempt = await prepareScannedCanary(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(attempt.entryId, { [field]: value, updatedAt: Date.now() });
    });

    await expect(completeScannedCanary(t, attempt, "clean")).resolves.toEqual({
      ok: true,
      applied: false,
      reason: "stale-attempt",
    });
    await expect(
      t.query(api.skillsShCatalog.getPublicEntry, {
        owner: "patrick-erichsen",
        repo: "skills",
        slug: "html",
      }),
    ).resolves.toBeNull();
  });

  it("blocks promotion while paused, then supports idempotent publication rollback", async () => {
    useEnvironment(TEST_ENV);
    const t = convexTest(schema, modules);
    const pausedAttempt = await prepareScannedCanary(t);
    await t.mutation(internal.skillsShCatalog.setCatalogPausedInternal, {
      paused: true,
      actor: "catalog-test-operator",
      reason: "prove catalog-only pause",
      confirm: "set-skills-sh-test-pause",
    });

    await expect(completeScannedCanary(t, pausedAttempt, "clean")).resolves.toEqual({
      ok: true,
      applied: true,
      publicVisible: false,
    });
    await t.mutation(internal.skillsShCatalog.setCatalogPausedInternal, {
      paused: false,
      actor: "catalog-test-operator",
      reason: "resume after paused callback proof",
      confirm: "set-skills-sh-test-pause",
    });
    await expect(
      t.query(api.skillsShCatalog.getPublicEntry, {
        owner: "patrick-erichsen",
        repo: "skills",
        slug: "html",
      }),
    ).resolves.toBeNull();

    await expect(
      t.mutation(internal.skillsShCatalog.startControlledCanaryScanRunInternal, {
        actor: "catalog-test-operator",
        reason: "publish the exact completed canary after resume",
      }),
    ).resolves.toEqual({
      runId: pausedAttempt.runId,
      externalId: CANARY_EXTERNAL_ID,
      reused: true,
    });
    const publishedAttempt = pausedAttempt;
    await expect(
      t.query(api.skillsShCatalog.getPublicEntry, {
        owner: "patrick-erichsen",
        repo: "skills",
        slug: "html",
      }),
    ).resolves.toMatchObject({
      security: { attemptId: publishedAttempt._id, verdict: "clean" },
    });
    await t.mutation(internal.skillsShCatalog.rollbackPublicationInternal, {
      externalId: CANARY_EXTERNAL_ID,
      attemptId: publishedAttempt._id,
      actor: "catalog-test-operator",
      reason: "prove exact publication rollback",
      confirm: "rollback-skills-sh-test-publication",
    });
    await expect(
      t.run(async (ctx) => await ctx.db.get(publishedAttempt._id)),
    ).resolves.toMatchObject({
      publicationRolledBackAt: expect.any(Number),
    });
    await expect(completeScannedCanary(t, publishedAttempt, "clean")).resolves.toEqual({
      ok: true,
      applied: true,
      publicVisible: false,
    });
    await expect(
      t.query(api.skillsShCatalog.getPublicEntry, {
        owner: "patrick-erichsen",
        repo: "skills",
        slug: "html",
      }),
    ).resolves.toBeNull();
    await t.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      ...CANARY_CONTROL,
      mode: "staging-live",
      scanAdmissionEnabled: true,
      publicVisibilityEnabled: true,
      maxWritesPerBatch: 7,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 2,
      maxCatalogQueued: 1,
      maxCatalogInFlight: 1,
      realScanAllowlist: [CANARY_EXTERNAL_ID],
    });
    const replacementRun = await t.mutation(
      internal.skillsShCatalog.startControlledCanaryScanRunInternal,
      {
        actor: "catalog-test-operator",
        reason: "publish a replacement after rollback",
      },
    );
    const actorUserId = await t.run(
      async (ctx) =>
        (await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("handle"), "catalog-test-operator"))
          .first())!._id,
    );
    await t.action(internal.skillsShCatalog.admitRealScansInternal, {
      runId: replacementRun.runId,
      externalIds: [CANARY_EXTERNAL_ID],
      actorUserId,
      artifacts: [await storeCanaryArtifact(t)],
    });
    const replacementAttempt = await t.run(async (ctx) => {
      const attempt = await ctx.db
        .query("skillsShCatalogScanAttempts")
        .withIndex("by_run", (q) => q.eq("runId", replacementRun.runId))
        .unique();
      if (!attempt?.skillScanRequestId || !attempt.securityScanJobId) {
        throw new Error("replacement canary scan admission did not create linked work");
      }
      await ctx.db.patch(attempt._id, { status: "running", updatedAt: Date.now() });
      await ctx.db.patch(attempt.skillScanRequestId, {
        status: "running",
        updatedAt: Date.now(),
      });
      await ctx.db.patch(attempt.securityScanJobId, {
        status: "running",
        leaseToken: "replacement-lease",
        leaseExpiresAt: Date.now() + 60_000,
        workerId: "replacement-worker",
        updatedAt: Date.now(),
      });
      return attempt;
    });
    await t.mutation(internal.securityScan.completeCatalogSkillScanJobInternal, {
      attemptId: replacementAttempt._id,
      scanId: replacementAttempt.skillScanRequestId!,
      jobId: replacementAttempt.securityScanJobId!,
      leaseToken: "replacement-lease",
      artifactContentHash: replacementAttempt.artifactContentHash!,
      verdict: "clean",
      runId: "replacement-clawscan-run",
      llmAnalysis: { status: "clean", checkedAt: Date.now() },
    });

    await expect(
      t.mutation(internal.skillsShCatalog.rollbackPublicationInternal, {
        externalId: CANARY_EXTERNAL_ID,
        attemptId: publishedAttempt._id,
        actor: "catalog-test-operator",
        reason: "retry the old rollback after replacement publication",
        confirm: "rollback-skills-sh-test-publication",
      }),
    ).resolves.toMatchObject({
      externalId: CANARY_EXTERNAL_ID,
      publicVisible: true,
      alreadyRolledBack: true,
    });
    await expect(
      t.query(api.skillsShCatalog.getPublicEntry, {
        owner: "patrick-erichsen",
        repo: "skills",
        slug: "html",
      }),
    ).resolves.toMatchObject({
      security: { attemptId: replacementAttempt._id, verdict: "clean" },
    });
  });
});
