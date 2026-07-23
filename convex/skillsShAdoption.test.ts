/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { promoteReadyInternal } from "./skillsShAdoption";

const modules = import.meta.glob("./**/*.ts");

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

const promoteReadyHandler = (
  promoteReadyInternal as unknown as WrappedHandler<{ adoptionId: Id<"skillsShAdoptions"> }>
)._handler;

const LOCAL_ENV = {
  CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
};
const TEST_ENV = {
  CLAWHUB_ENV: "test",
  CLAWHUB_DISABLE_CRONS: "1",
  CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
  CONVEX_CLOUD_URL: "https://academic-chihuahua-392.convex.cloud",
};

type AdoptionFixture = Awaited<ReturnType<typeof seedAdoptionFixture>>;

type PreexistingScanExecution = {
  requestId: Id<"skillScanRequests">;
  jobId: Id<"securityScanJobs">;
  artifactContentHash: string;
};

function useLocalEnvironment() {
  for (const [name, value] of Object.entries(LOCAL_ENV)) vi.stubEnv(name, value);
}

async function seedAdoptionFixture(options: {
  publisherKind?: "user" | "org";
  githubProviderAccountId?: string;
  githubOrgId?: string;
  githubOrgRole?: "admin" | "member";
  githubOrgSyncedAt?: number;
  destination?: "none" | "owned" | "owned-with-alias" | "alias-collision";
}) {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const seeded = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      handle: "alice",
      displayName: "Alice",
      role: "user",
      createdAt: now,
      updatedAt: now,
    });
    const publisherKind = options.publisherKind ?? "user";
    const publisherId = await ctx.db.insert("publishers", {
      kind: publisherKind,
      handle: publisherKind === "org" ? "acme" : "alice",
      displayName: publisherKind === "org" ? "Acme" : "Alice",
      ...(publisherKind === "user"
        ? { linkedUserId: userId }
        : options.githubOrgId
          ? {
              githubHandle: "acme",
              githubOrgId: options.githubOrgId,
              githubVerifiedAt: now,
              githubVerifiedByUserId: userId,
            }
          : {}),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(userId, { personalPublisherId: publisherId });
    await ctx.db.insert("publisherMembers", {
      publisherId,
      userId,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });
    if (options.githubProviderAccountId) {
      await ctx.db.insert("authAccounts", {
        userId,
        provider: "github",
        providerAccountId: options.githubProviderAccountId,
      });
    }
    if (publisherKind === "org" && options.githubOrgId) {
      await ctx.db.insert("githubOrgMemberships", {
        userId,
        githubOrgId: options.githubOrgId,
        login: "acme",
        role: options.githubOrgRole ?? "admin",
        syncedAt: options.githubOrgSyncedAt ?? now,
      });
    }

    const entryId = await ctx.db.insert("skillsShCatalogEntries", {
      externalId: "acme/skills/demo",
      sourceKind: "staging-live",
      githubOwnerId: 42,
      owner: "acme",
      repo: "skills",
      slug: "demo",
      displayName: "Demo",
      sourceUrl: "https://skills.sh/acme/skills/demo",
      githubRepoUrl: "https://github.com/acme/skills",
      githubPath: "skills/demo",
      githubCommit: "a".repeat(40),
      githubContentHash: "b".repeat(64),
      sourceContentHash: "c".repeat(64),
      installs: 123,
      sourceSnapshotId: "snapshot-1",
      publicVisible: false,
      scanStatus: "not-planned",
      firstObservedAt: now,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    let destinationSkillId: Id<"skills"> | null = null;
    if (
      options.destination === "owned" ||
      options.destination === "owned-with-alias" ||
      options.destination === "alias-collision"
    ) {
      destinationSkillId = await ctx.db.insert("skills", {
        slug: options.destination === "alias-collision" ? "other" : "demo",
        displayName: "Existing Demo",
        summary: "Existing active content",
        ownerUserId: userId,
        ownerPublisherId: publisherId,
        tags: {},
        badges: {
          official: { byUserId: userId, at: now - 1_000 },
        },
        moderationStatus: "active",
        installKind: "github",
        githubPath: "skills/existing-demo",
        githubCurrentCommit: "d".repeat(40),
        githubCurrentContentHash: "e".repeat(64),
        githubCurrentStatus: "present",
        statsDownloads: 800,
        statsStars: 90,
        statsInstallsCurrent: 20,
        statsInstallsAllTime: 400,
        stats: {
          downloads: 800,
          stars: 90,
          installsCurrent: 20,
          installsAllTime: 400,
          comments: 7,
          versions: 4,
        },
        createdAt: now - 10_000,
        updatedAt: now - 5_000,
      });
    }
    if (
      (options.destination === "owned-with-alias" || options.destination === "alias-collision") &&
      destinationSkillId
    ) {
      await ctx.db.insert("skillSlugAliases", {
        slug: "demo",
        skillId: destinationSkillId,
        ownerUserId: userId,
        ownerPublisherId: publisherId,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { userId, publisherId, entryId, destinationSkillId, now };
  });
  return { t, ...seeded };
}

async function getPreview(fixture: AdoptionFixture) {
  return await fixture.t
    .withIdentity({ subject: fixture.userId })
    .query(api.skillsShAdoption.getPreview, {
      publisherId: fixture.publisherId,
      externalId: "acme/skills/demo",
    });
}

async function insertMirrorDigest(fixture: AdoptionFixture) {
  return await fixture.t.run(async (ctx) => {
    const runId = await ctx.db.insert("skillsShMirrorRuns", {
      snapshotId: "snapshot-1",
      status: "completed",
      sourceTotal: 1,
      sourcePageSize: 1,
      sourceMeasuredAt: new Date().toISOString(),
      page: 1,
      offset: 1,
      counts: {
        observed: 1,
        inserted: 1,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        conflicts: 0,
        tombstoned: 0,
        reactivated: 0,
        detailsInserted: 0,
        detailsUpdated: 0,
        detailsUnchanged: 0,
        detailsMissing: 1,
        detailsTruncated: 0,
        scansPlanned: 0,
        scansAdmitted: 0,
      },
      operations: {
        functionCalls: 1,
        dbReads: 0,
        dbWrites: 1,
        sourceRequests: 1,
        sourceBytes: 1,
      },
      actor: "test",
      reason: "test",
      startedAt: fixture.now,
      completedAt: fixture.now,
      updatedAt: fixture.now,
    });
    return await ctx.db.insert("skillsShMirrorDigests", {
      externalId: "acme/skills/demo",
      sourceType: "github",
      owner: "acme",
      repo: "skills",
      slug: "demo",
      normalizedSlug: "demo",
      normalizedSlugFirstToken: "demo",
      displayName: "Demo",
      normalizedDisplayName: "demo",
      normalizedDisplayNameFirstToken: "demo",
      searchText: "demo",
      sourceUrl: "https://skills.sh/acme/skills/demo",
      canonicalRepoUrl: "https://github.com/acme/skills",
      githubPath: "skills/demo",
      githubCommit: "a".repeat(40),
      sourceContentHash: "c".repeat(64),
      upstreamInstalls: 123,
      upstreamScanners: {
        genAgentTrustHub: { status: "unavailable" },
        socket: { status: "unavailable" },
        snyk: { status: "unavailable" },
      },
      inferredCategories: ["development"],
      inferredTopics: ["html"],
      inferredCategoryConfidence: "high",
      inferredTopicConfidence: "medium",
      inferredClassifierVersion: "taxonomy-prototype-v9",
      inferredTopicClassifierVersion: "topic-prototype-v1",
      inferredInputHash: "category-input",
      inferredTopicInputHash: "topic-input",
      inferredAt: fixture.now,
      sourceFreshnessStatus: "observed-only",
      detailStatus: "missing",
      observationFingerprint: "fingerprint",
      sourceSnapshotId: "snapshot-1",
      lastObservedRunId: runId,
      active: true,
      publicVisible: false,
      installable: false,
      firstObservedAt: fixture.now,
      lastObservedAt: fixture.now,
      createdAt: fixture.now,
      updatedAt: fixture.now,
    });
  });
}

async function startMirroredAdoption(fixture: AdoptionFixture) {
  await insertMirrorDigest(fixture);
  const preview = await fixture.t.query(internal.skillsShAdoption.getMirroredPreviewInternal, {
    actorUserId: fixture.userId,
    publisherId: fixture.publisherId,
    externalId: "acme/skills/demo",
    githubOwnerId: 42,
    canonicalRepository: "acme/skills",
  });
  if (!preview?.destination.fingerprint) throw new Error("mirrored preview missing");
  return await fixture.t.mutation(internal.skillsShAdoption.materializeMirroredAdoptionInternal, {
    actorUserId: fixture.userId,
    publisherId: fixture.publisherId,
    externalId: "acme/skills/demo",
    sourceContentHash: "c".repeat(64),
    idempotencyKey: preview.idempotencyKey,
    expectedDestinationFingerprint: preview.destination.fingerprint,
    githubOwnerId: 42,
    canonicalRepository: "acme/skills",
    githubPath: "skills/demo",
    githubCommit: "a".repeat(40),
  });
}

async function insertSucceededScan(
  fixture: AdoptionFixture,
  adoptionId: Id<"skillsShAdoptions">,
  verdict: "clean" | "suspicious" | "malicious" | "failed" = "clean",
  preexistingExecution?: PreexistingScanExecution,
) {
  const attemptId = await fixture.t.run(async (ctx) => {
    const adoption = await ctx.db.get(adoptionId);
    if (!adoption) throw new Error("adoption fixture missing");
    const scanCreatedAt = adoption.createdAt;
    const runId = await ctx.db.insert("skillsShCatalogRuns", {
      fixtureId: "skills-sh-test-live-500",
      snapshotId: adoption.sourceSnapshotId,
      sourceKind: "staging-live",
      sourceCapturedAt: new Date().toISOString(),
      snapshotCaptureFetches: 1,
      dryRun: false,
      status: "completed",
      cursor: 1,
      scanCursor: 1,
      fixtureLength: 1,
      counts: {
        observed: 1,
        wouldInsert: 1,
        wouldUpdate: 0,
        inserted: 1,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        newExternal: 1,
        exactNativeMatches: 0,
        routeCollisions: 0,
        claimOpportunities: 1,
        scansPlanned: 1,
        scansAdmitted: 1,
        scansCompleted: 1,
        scansCanceled: 0,
      },
      budgets: {
        maxEntriesPerRun: 1,
        maxEntriesPerBatch: 1,
        maxWritesPerBatch: 10,
        maxPlannedScans: 1,
        maxScanAdmissionsPerBatch: 1,
        maxScanAdmissionsPerRun: 1,
        maxScanAdmissionsPerDay: 1,
      },
      operations: { functionCalls: 1, dbReads: 1, dbWrites: 1 },
      actor: "test",
      reason: "test",
      batchesProcessed: 1,
      scanAdmissionBatches: 1,
      lastBatchWrites: 1,
      lastBatchReads: 1,
      startedAt: fixture.now,
      completedAt: scanCreatedAt + 1,
      updatedAt: scanCreatedAt + 1,
    });
    const artifactContentHash = preexistingExecution?.artifactContentHash ?? "9".repeat(64);
    const terminalStatus = verdict === "failed" ? "failed" : "succeeded";
    const createdAttemptId = await ctx.db.insert("skillsShCatalogScanAttempts", {
      entryId: fixture.entryId,
      runId,
      externalId: adoption.externalId,
      githubOwnerId: adoption.githubOwnerId,
      owner: adoption.owner,
      repo: adoption.repo,
      slug: adoption.slug,
      githubPath: adoption.githubPath,
      githubCommit: adoption.githubCommit,
      githubContentHash: adoption.githubContentHash,
      sourceContentHash: adoption.sourceContentHash,
      artifactContentHash,
      source: "skills-sh-catalog-test",
      dispatchKind: "real",
      priority: "low",
      status: terminalStatus,
      verdict,
      completedAt: scanCreatedAt + 1,
      createdAt: scanCreatedAt,
      updatedAt: scanCreatedAt + 1,
    });
    const requestId =
      preexistingExecution?.requestId ??
      (await ctx.db.insert("skillScanRequests", {
        actorUserId: fixture.userId,
        sourceKind: "skills-sh-catalog",
        update: false,
        writtenBack: false,
        status: terminalStatus,
        requestedJobSource: "skills-sh-catalog-test",
        requestedJobPriority: -100,
        slug: "demo",
        displayName: "Demo",
        skillsShCatalogAttemptId: createdAttemptId,
        files: [],
        sha256hash: artifactContentHash,
        expiresAt: scanCreatedAt + 60_000,
        completedAt: scanCreatedAt + 1,
        createdAt: scanCreatedAt,
        updatedAt: scanCreatedAt + 1,
      }));
    const jobId =
      preexistingExecution?.jobId ??
      (await ctx.db.insert("securityScanJobs", {
        targetKind: "skillScanRequest",
        skillScanRequestId: requestId,
        status: terminalStatus,
        source: "skills-sh-catalog-test",
        priority: -100,
        hasMaliciousSignal: verdict === "malicious",
        waitForVtUntil: scanCreatedAt,
        nextRunAt: scanCreatedAt,
        attempts: 1,
        completedAt: scanCreatedAt + 1,
        createdAt: scanCreatedAt,
        updatedAt: scanCreatedAt + 1,
      }));
    await ctx.db.patch(requestId, {
      securityScanJobId: jobId,
      skillsShCatalogAttemptId: createdAttemptId,
      ...(verdict !== "failed"
        ? {
            llmAnalysis: {
              status: verdict,
              verdict,
              checkedAt: scanCreatedAt + 1,
            },
          }
        : {}),
    });
    await ctx.db.patch(createdAttemptId, {
      skillScanRequestId: requestId,
      securityScanJobId: jobId,
    });
    return createdAttemptId;
  });
  await fixture.t.mutation(internal.skillsShAdoption.bindScanAttemptInternal, {
    adoptionId,
    scanAttemptId: attemptId,
  });
  return attemptId;
}

describe("skills.sh adoption", () => {
  it("does not schedule another static scan when a promotion callback is replayed", async () => {
    const adoptionId = "skillsShAdoptions:replayed" as Id<"skillsShAdoptions">;
    const skillId = "skills:staged" as Id<"skills">;
    const versionId = "skillVersions:staged" as Id<"skillVersions">;
    const runAfter = vi.fn();
    const db = {
      get: vi.fn().mockResolvedValue({
        _id: adoptionId,
        status: "ready_to_promote",
        stagedSkillId: skillId,
        stagedVersionId: versionId,
      }),
      query: vi.fn(),
      normalizeId: vi.fn(),
      insert: vi.fn(),
      patch: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      system: {},
    };

    await expect(
      promoteReadyHandler(
        {
          db,
          scheduler: { runAfter },
        },
        { adoptionId },
      ),
    ).resolves.toEqual({
      status: "ready_to_promote",
      skillId,
      versionId,
      canonicalRef: null,
    });
    expect(runAfter).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("previews the exact candidate and controlled destination replacement", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });

    const preview = await getPreview(fixture);

    expect(preview).toMatchObject({
      canStart: true,
      ownership: { kind: "personal", verified: true },
      source: {
        externalId: "acme/skills/demo",
        githubOwnerId: 42,
        repository: "acme/skills",
        githubPath: "skills/demo",
        githubCommit: "a".repeat(40),
        githubContentHash: "b".repeat(64),
        sourceContentHash: "c".repeat(64),
      },
      destination: {
        kind: "replace",
        skillId: fixture.destinationSkillId,
        route: "/alice/demo",
        activeContentWillBeReplaced: true,
        preserved: {
          identity: true,
          downloads: 800,
          bookmarks: 90,
          comments: 7,
          official: true,
          versions: 4,
          auditHistory: true,
        },
      },
    });
    expect(preview?.idempotencyKey).toContain(
      `${fixture.publisherId}:acme/skills/demo:${"c".repeat(64)}`,
    );
  });

  it("authorizes the immutable canonical GitHub owner while preserving redirected external identity", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    await fixture.t.run(async (ctx) => {
      const runId = await ctx.db.insert("skillsShMirrorRuns", {
        snapshotId: "mirror-snapshot-1",
        status: "completed",
        sourceTotal: 1,
        sourcePageSize: 1,
        sourceMeasuredAt: new Date().toISOString(),
        page: 1,
        offset: 1,
        counts: {
          observed: 1,
          inserted: 1,
          updated: 0,
          unchanged: 0,
          rejected: 0,
          conflicts: 0,
          tombstoned: 0,
          reactivated: 0,
          detailsInserted: 0,
          detailsUpdated: 0,
          detailsUnchanged: 0,
          detailsMissing: 1,
          detailsTruncated: 0,
          scansPlanned: 0,
          scansAdmitted: 0,
        },
        operations: {
          functionCalls: 1,
          dbReads: 0,
          dbWrites: 1,
          sourceRequests: 1,
          sourceBytes: 1,
        },
        actor: "test",
        reason: "test",
        startedAt: fixture.now,
        completedAt: fixture.now,
        updatedAt: fixture.now,
      });
      await ctx.db.insert("skillsShMirrorDigests", {
        externalId: "acme/skills/demo",
        sourceType: "github",
        owner: "acme",
        repo: "skills",
        slug: "demo",
        normalizedSlug: "demo",
        normalizedSlugFirstToken: "demo",
        displayName: "Demo",
        normalizedDisplayName: "demo",
        normalizedDisplayNameFirstToken: "demo",
        searchText: "demo",
        sourceUrl: "https://skills.sh/acme/skills/demo",
        canonicalRepoUrl: "https://github.com/openclaw/openclaw",
        githubPath: "skills/demo",
        githubCommit: "a".repeat(40),
        sourceContentHash: "c".repeat(64),
        upstreamInstalls: 123,
        upstreamScanners: {
          genAgentTrustHub: { status: "unavailable" },
          socket: { status: "unavailable" },
          snyk: { status: "unavailable" },
        },
        sourceFreshnessStatus: "observed-only",
        detailStatus: "missing",
        observationFingerprint: "fingerprint",
        sourceSnapshotId: "mirror-snapshot-1",
        lastObservedRunId: runId,
        active: true,
        publicVisible: false,
        installable: false,
        firstObservedAt: fixture.now,
        lastObservedAt: fixture.now,
        createdAt: fixture.now,
        updatedAt: fixture.now,
      });
    });

    await expect(
      fixture.t.query(internal.skillsShAdoption.getMirroredPreviewInternal, {
        actorUserId: fixture.userId,
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        githubOwnerId: 42,
        canonicalRepository: "openclaw/openclaw",
      }),
    ).resolves.toMatchObject({
      canStart: true,
      source: {
        externalId: "acme/skills/demo",
        repository: "acme/skills",
      },
      ownership: { verified: true },
    });
  });

  it("fails closed when personal GitHub identity is missing or mismatched", async () => {
    useLocalEnvironment();
    const missing = await seedAdoptionFixture({ destination: "none" });
    const mismatched = await seedAdoptionFixture({
      githubProviderAccountId: "41",
      destination: "none",
    });

    await expect(getPreview(missing)).resolves.toMatchObject({
      canStart: false,
      ownership: { kind: "personal", verified: false, reason: "github_identity_missing" },
    });
    await expect(getPreview(mismatched)).resolves.toMatchObject({
      canStart: false,
      ownership: { kind: "personal", verified: false, reason: "github_identity_mismatch" },
    });
  });

  it("fails closed when a mirrored source is no longer freshly observed", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    await insertMirrorDigest(fixture);
    await fixture.t.run(async (ctx) => {
      const digest = await ctx.db
        .query("skillsShMirrorDigests")
        .withIndex("by_external_id", (q) => q.eq("externalId", "acme/skills/demo"))
        .unique();
      if (!digest) throw new Error("mirror digest missing");
      await ctx.db.patch(digest._id, { sourceFreshnessStatus: "stale" });
    });

    await expect(
      fixture.t.query(internal.skillsShAdoption.getMirroredPreviewInternal, {
        actorUserId: fixture.userId,
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        githubOwnerId: 42,
        canonicalRepository: "acme/skills",
      }),
    ).resolves.toBeNull();
  });

  it("does not rewrite frozen promoted provenance during an idempotent mirrored retry", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    await insertMirrorDigest(fixture);
    const preview = await fixture.t.query(internal.skillsShAdoption.getMirroredPreviewInternal, {
      actorUserId: fixture.userId,
      publisherId: fixture.publisherId,
      externalId: "acme/skills/demo",
      githubOwnerId: 42,
      canonicalRepository: "acme/skills",
    });
    if (!preview?.destination.fingerprint) throw new Error("mirrored preview missing");
    const args = {
      actorUserId: fixture.userId,
      publisherId: fixture.publisherId,
      externalId: "acme/skills/demo",
      sourceContentHash: "c".repeat(64),
      idempotencyKey: preview.idempotencyKey,
      expectedDestinationFingerprint: preview.destination.fingerprint,
      githubOwnerId: 42,
      githubPath: "skills/demo",
      githubCommit: "a".repeat(40),
    };
    const first = await fixture.t.mutation(
      internal.skillsShAdoption.materializeMirroredAdoptionInternal,
      {
        ...args,
        canonicalRepository: "acme/skills",
      },
    );
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(first.adoptionId, {
        status: "promoted",
        canonicalRepository: "acme/skills",
      });
    });

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.materializeMirroredAdoptionInternal, {
        ...args,
        canonicalRepository: "openclaw/openclaw",
      }),
    ).resolves.toMatchObject({
      adoptionId: first.adoptionId,
      created: false,
      shouldAdmit: false,
    });
    await expect(
      fixture.t.run(async (ctx) => await ctx.db.get(first.adoptionId)),
    ).resolves.toMatchObject({
      status: "promoted",
      canonicalRepository: "acme/skills",
    });
  });

  it("resets a terminal matching catalog entry before retrying scan admission", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    await insertMirrorDigest(fixture);
    const preview = await fixture.t.query(internal.skillsShAdoption.getMirroredPreviewInternal, {
      actorUserId: fixture.userId,
      publisherId: fixture.publisherId,
      externalId: "acme/skills/demo",
      githubOwnerId: 42,
      canonicalRepository: "acme/skills",
    });
    if (!preview?.destination.fingerprint) throw new Error("mirrored preview missing");
    const args = {
      actorUserId: fixture.userId,
      publisherId: fixture.publisherId,
      externalId: "acme/skills/demo",
      sourceContentHash: "c".repeat(64),
      idempotencyKey: preview.idempotencyKey,
      expectedDestinationFingerprint: preview.destination.fingerprint,
      githubOwnerId: 42,
      canonicalRepository: "acme/skills",
      githubPath: "skills/demo",
      githubCommit: "a".repeat(40),
    };
    const first = await fixture.t.mutation(
      internal.skillsShAdoption.materializeMirroredAdoptionInternal,
      args,
    );
    await fixture.t.run(async (ctx) => {
      const adoption = await ctx.db.get(first.adoptionId);
      if (!adoption) throw new Error("adoption missing");
      await ctx.db.patch(adoption.entryId, { scanStatus: "failed" });
    });

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.materializeMirroredAdoptionInternal, args),
    ).resolves.toMatchObject({
      adoptionId: first.adoptionId,
      created: false,
      shouldAdmit: true,
    });
    await expect(
      fixture.t.run(async (ctx) => {
        const adoption = await ctx.db.get(first.adoptionId);
        return adoption ? await ctx.db.get(adoption.entryId) : null;
      }),
    ).resolves.toMatchObject({ scanStatus: "planned" });
  });

  it("requires a fresh active GitHub organization admin proof", async () => {
    useLocalEnvironment();
    const stale = await seedAdoptionFixture({
      publisherKind: "org",
      githubOrgId: "42",
      githubOrgSyncedAt: Date.now() - 16 * 60 * 1_000,
    });
    const member = await seedAdoptionFixture({
      publisherKind: "org",
      githubOrgId: "42",
      githubOrgRole: "member",
    });
    const mismatched = await seedAdoptionFixture({
      publisherKind: "org",
      githubOrgId: "41",
    });

    await expect(getPreview(stale)).resolves.toMatchObject({
      canStart: false,
      ownership: { kind: "organization", verified: false, reason: "github_org_proof_stale" },
    });
    await expect(getPreview(member)).resolves.toMatchObject({
      canStart: false,
      ownership: { kind: "organization", verified: false, reason: "github_org_admin_required" },
    });
    await expect(getPreview(mismatched)).resolves.toMatchObject({
      canStart: false,
      ownership: { kind: "organization", verified: false, reason: "github_org_mismatch" },
    });
  });

  it("starts idempotently from the bulk-compatible exact-source port and blocks alias collisions", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const preview = await getPreview(fixture);
    expect(preview?.canStart).toBe(true);

    const args = {
      publisherId: fixture.publisherId,
      externalId: "acme/skills/demo",
      sourceContentHash: "c".repeat(64),
      idempotencyKey: preview!.idempotencyKey,
    };
    const actor = fixture.t.withIdentity({ subject: fixture.userId });
    const first = await actor.mutation(api.skillsShAdoption.start, args);
    const second = await actor.mutation(api.skillsShAdoption.start, args);

    expect(first).toMatchObject({
      status: "pending_scan",
      destinationKind: "replace",
      destinationSkillId: fixture.destinationSkillId,
      created: true,
    });
    expect(second).toMatchObject({
      adoptionId: first.adoptionId,
      status: "pending_scan",
      created: false,
    });

    const collision = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "alias-collision",
    });
    const collisionPreview = await getPreview(collision);
    expect(collisionPreview).toMatchObject({
      canStart: false,
      destination: { kind: "conflict", reason: "destination_alias_conflict" },
    });
    await expect(
      collision.t.withIdentity({ subject: collision.userId }).mutation(api.skillsShAdoption.start, {
        publisherId: collision.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: collisionPreview!.idempotencyKey,
      }),
    ).rejects.toThrow(/destination alias conflict/i);
  });

  it("rejects a confirmed start when the destination changes after preview", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const preview = await getPreview(fixture);
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.destinationSkillId!, {
        githubCurrentCommit: "f".repeat(40),
        githubCurrentContentHash: "0".repeat(64),
        updatedAt: fixture.now + 1,
      });
    });

    await expect(
      fixture.t
        .withIdentity({ subject: fixture.userId })
        .mutation(api.skillsShAdoption.startInteractive, {
          publisherId: fixture.publisherId,
          externalId: "acme/skills/demo",
          sourceContentHash: "c".repeat(64),
          idempotencyKey: preview!.idempotencyKey,
          expectedDestinationFingerprint: preview!.destination.fingerprint!,
        }),
    ).rejects.toThrow(/destination changed/i);
  });

  it("rejects a confirmed start when the publisher route changes after preview", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const preview = await getPreview(fixture);
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.publisherId, {
        handle: "alice-renamed",
        updatedAt: fixture.now + 1,
      });
    });

    await expect(
      fixture.t
        .withIdentity({ subject: fixture.userId })
        .mutation(api.skillsShAdoption.startInteractive, {
          publisherId: fixture.publisherId,
          externalId: "acme/skills/demo",
          sourceContentHash: "c".repeat(64),
          idempotencyKey: preview!.idempotencyKey,
          expectedDestinationFingerprint: preview!.destination.fingerprint!,
        }),
    ).rejects.toThrow(/destination changed/i);
  });

  it("blocks every destination alias, including one pointing to the canonical skill", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned-with-alias",
    });

    await expect(getPreview(fixture)).resolves.toMatchObject({
      canStart: false,
      destination: {
        kind: "conflict",
        reason: "destination_alias_conflict",
        skillId: fixture.destinationSkillId,
      },
    });
  });

  it("returns an unavailable preview outside Local and Test", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", "https://production.example");
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });

    await expect(getPreview(fixture)).resolves.toBeNull();
  });

  it("becomes ready only after a newer exact ClawHub scan succeeds", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });

    const attemptId = await insertSucceededScan(fixture, started.adoptionId);

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
        adoptionId: started.adoptionId,
        scanAttemptId: attemptId,
      }),
    ).resolves.toMatchObject({
      status: "ready_to_promote",
      verdict: "clean",
      scanAttemptId: attemptId,
    });
  });

  it("rejects a real-labeled attempt without ClawHub request and job linkage", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(attemptId, {
        skillScanRequestId: undefined,
        securityScanJobId: undefined,
      });
    });

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
        adoptionId: started.adoptionId,
        scanAttemptId: attemptId,
      }),
    ).rejects.toThrow(/scan linkage/i);
  });

  it("rejects a fresh attempt that reuses a pre-adoption scan execution", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    const artifactContentHash = "9".repeat(64);
    const preexistingExecution = await fixture.t.run(async (ctx) => {
      const requestId = await ctx.db.insert("skillScanRequests", {
        actorUserId: fixture.userId,
        sourceKind: "skills-sh-catalog",
        update: false,
        writtenBack: false,
        status: "succeeded",
        requestedJobSource: "skills-sh-catalog-test",
        requestedJobPriority: -100,
        slug: "demo",
        displayName: "Demo",
        files: [],
        sha256hash: artifactContentHash,
        expiresAt: fixture.now + 60_000,
        completedAt: fixture.now + 1,
        createdAt: fixture.now,
        updatedAt: fixture.now + 1,
      });
      const jobId = await ctx.db.insert("securityScanJobs", {
        targetKind: "skillScanRequest",
        skillScanRequestId: requestId,
        status: "succeeded",
        source: "skills-sh-catalog-test",
        priority: -100,
        hasMaliciousSignal: false,
        waitForVtUntil: fixture.now,
        nextRunAt: fixture.now,
        attempts: 1,
        completedAt: fixture.now + 1,
        createdAt: fixture.now,
        updatedAt: fixture.now + 1,
      });
      await ctx.db.patch(requestId, { securityScanJobId: jobId });
      return { requestId, jobId, artifactContentHash };
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const attemptId = await insertSucceededScan(
      fixture,
      started.adoptionId,
      "clean",
      preexistingExecution,
    );

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
        adoptionId: started.adoptionId,
        scanAttemptId: attemptId,
      }),
    ).rejects.toThrow(/scan linkage/i);
  });

  it("keeps a canceled scan retryable and accepts a later linked scan", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    const canceledAttemptId = await insertSucceededScan(fixture, started.adoptionId);
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(canceledAttemptId, {
        status: "canceled",
        verdict: undefined,
      });
    });

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
        adoptionId: started.adoptionId,
        scanAttemptId: canceledAttemptId,
      }),
    ).resolves.toMatchObject({
      status: "pending_scan",
      verdict: null,
      scanAttemptId: null,
    });

    const successfulAttemptId = await insertSucceededScan(fixture, started.adoptionId);
    await expect(
      fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
        adoptionId: started.adoptionId,
        scanAttemptId: successfulAttemptId,
      }),
    ).resolves.toMatchObject({
      status: "ready_to_promote",
      verdict: "clean",
    });
  });

  it("invalidates the request when the frozen destination changes during scanning", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    await fixture.t.run(async (ctx) => {
      const otherPublisherId = await ctx.db.insert("publishers", {
        kind: "org",
        handle: "other",
        displayName: "Other",
        createdAt: fixture.now,
        updatedAt: fixture.now,
      });
      await ctx.db.patch(fixture.destinationSkillId!, {
        ownerPublisherId: otherPublisherId,
        updatedAt: fixture.now + 1,
      });
    });
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
        adoptionId: started.adoptionId,
        scanAttemptId: attemptId,
      }),
    ).resolves.toMatchObject({
      status: "stale",
      verdict: null,
    });
  });

  it("invalidates the request when the destination active content changes in place", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.destinationSkillId!, {
        githubCurrentCommit: "f".repeat(40),
        githubCurrentContentHash: "0".repeat(64),
        updatedAt: fixture.now + 1,
      });
    });
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
        adoptionId: started.adoptionId,
        scanAttemptId: attemptId,
      }),
    ).resolves.toMatchObject({
      status: "stale",
      verdict: null,
    });
  });

  it("allows a fresh confirmed request after destination drift makes the prior request stale", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const preview = await getPreview(fixture);
    const actor = fixture.t.withIdentity({ subject: fixture.userId });
    const args = {
      publisherId: fixture.publisherId,
      externalId: "acme/skills/demo",
      sourceContentHash: "c".repeat(64),
      idempotencyKey: preview!.idempotencyKey,
    };
    const first = await actor.mutation(api.skillsShAdoption.start, args);
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.destinationSkillId!, {
        githubCurrentCommit: "f".repeat(40),
        githubCurrentContentHash: "0".repeat(64),
        updatedAt: fixture.now + 1,
      });
    });
    const attemptId = await insertSucceededScan(fixture, first.adoptionId);
    await fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
      adoptionId: first.adoptionId,
      scanAttemptId: attemptId,
    });

    const second = await actor.mutation(api.skillsShAdoption.start, args);

    expect(second).toMatchObject({
      status: "pending_scan",
      destinationKind: "replace",
      destinationSkillId: fixture.destinationSkillId,
      created: true,
    });
    expect(second.adoptionId).not.toBe(first.adoptionId);
  });

  it("cancels an unbound failed admission so the exact adoption can be retried", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const preview = await getPreview(fixture);
    const args = {
      publisherId: fixture.publisherId,
      externalId: "acme/skills/demo",
      sourceContentHash: "c".repeat(64),
      idempotencyKey: preview!.idempotencyKey,
    };
    const actor = fixture.t.withIdentity({ subject: fixture.userId });
    const first = await actor.mutation(api.skillsShAdoption.start, args);
    const runId = await fixture.t.run(
      async (ctx) =>
        await ctx.db.insert("skillsShCatalogRuns", {
          fixtureId: "skills-sh-test-live-500",
          snapshotId: "snapshot-1",
          sourceKind: "staging-live",
          snapshotCaptureFetches: 0,
          dryRun: false,
          status: "completed",
          cursor: 1,
          scanCursor: 0,
          fixtureLength: 1,
          counts: {
            observed: 1,
            wouldInsert: 0,
            wouldUpdate: 1,
            inserted: 0,
            updated: 1,
            unchanged: 0,
            rejected: 0,
            scansPlanned: 1,
            scansAdmitted: 0,
            scansCompleted: 0,
            scansCanceled: 0,
          },
          budgets: {
            maxEntriesPerRun: 1,
            maxEntriesPerBatch: 1,
            maxWritesPerBatch: 20,
            maxPlannedScans: 1,
            maxScanAdmissionsPerBatch: 1,
            maxScanAdmissionsPerRun: 1,
            maxScanAdmissionsPerDay: 3,
          },
          operations: { functionCalls: 1, dbReads: 4, dbWrites: 2 },
          actor: `skills-sh-adoption:${fixture.userId}`,
          reason: "test retry",
          batchesProcessed: 1,
          scanAdmissionBatches: 0,
          lastBatchWrites: 2,
          lastBatchReads: 4,
          startedAt: fixture.now,
          completedAt: fixture.now,
          updatedAt: fixture.now,
        }),
    );
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(first.adoptionId, { scanRunId: runId });
    });

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.failMirroredStartInternal, {
        adoptionId: first.adoptionId,
        runId,
      }),
    ).resolves.toEqual({ safeToDeleteArtifact: true });
    const second = await actor.mutation(api.skillsShAdoption.start, args);

    expect(second).toMatchObject({ created: true, status: "pending_scan" });
    expect(second.adoptionId).not.toBe(first.adoptionId);
    await expect(
      fixture.t.run(async (ctx) => await ctx.db.get(first.adoptionId)),
    ).resolves.toMatchObject({
      status: "canceled",
      rejectionReason: "scan_admission_failed",
    });
    await expect(fixture.t.run(async (ctx) => await ctx.db.get(runId))).resolves.toMatchObject({
      status: "failed",
      lastError: "skills.sh adoption scan admission failed",
    });
  });

  it("stales an obsolete pending request before accepting a newly confirmed destination", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const firstPreview = await getPreview(fixture);
    const actor = fixture.t.withIdentity({ subject: fixture.userId });
    const first = await actor.mutation(api.skillsShAdoption.startInteractive, {
      publisherId: fixture.publisherId,
      externalId: "acme/skills/demo",
      sourceContentHash: "c".repeat(64),
      idempotencyKey: firstPreview!.idempotencyKey,
      expectedDestinationFingerprint: firstPreview!.destination.fingerprint!,
    });
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.destinationSkillId!, {
        githubCurrentCommit: "f".repeat(40),
        githubCurrentContentHash: "0".repeat(64),
        updatedAt: fixture.now + 1,
      });
    });
    const secondPreview = await getPreview(fixture);

    const second = await actor.mutation(api.skillsShAdoption.startInteractive, {
      publisherId: fixture.publisherId,
      externalId: "acme/skills/demo",
      sourceContentHash: "c".repeat(64),
      idempotencyKey: secondPreview!.idempotencyKey,
      expectedDestinationFingerprint: secondPreview!.destination.fingerprint!,
    });
    const firstRow = await fixture.t.run(async (ctx) => await ctx.db.get(first.adoptionId));

    expect(firstRow).toMatchObject({
      status: "stale",
      rejectionReason: "destination_changed",
    });
    expect(second).toMatchObject({
      status: "pending_scan",
      created: true,
    });
    expect(second.adoptionId).not.toBe(first.adoptionId);
  });

  it("rejects a scan attempt from a different synchronized snapshot", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);
    await fixture.t.run(async (ctx) => {
      const attempt = await ctx.db.get(attemptId);
      if (!attempt) throw new Error("scan attempt missing");
      await ctx.db.patch(attempt.runId, { snapshotId: "snapshot-2" });
    });

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
        adoptionId: started.adoptionId,
        scanAttemptId: attemptId,
      }),
    ).rejects.toThrow(/frozen candidate/i);
  });

  it("rejects an exact candidate when ClawHub returns a blocked verdict", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    const attemptId = await insertSucceededScan(fixture, started.adoptionId, "malicious");

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
        adoptionId: started.adoptionId,
        scanAttemptId: attemptId,
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      verdict: "malicious",
      scanAttemptId: attemptId,
    });
  });

  it("keeps a staged adoption private until its static scan finishes", async () => {
    useLocalEnvironment();
    vi.useFakeTimers();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);
    const storedFile = await fixture.t.run(async (ctx) => {
      const attempt = await ctx.db.get(attemptId);
      if (!attempt?.skillScanRequestId) throw new Error("scan request missing");
      const storageId = await ctx.storage.store(new Blob(["# Demo"], { type: "text/markdown" }));
      await ctx.db.patch(attempt.skillScanRequestId, {
        files: [
          {
            path: "SKILL.md",
            size: 6,
            storageId,
            sha256: "f".repeat(64),
            contentType: "text/markdown",
          },
        ],
      });
      return { requestId: attempt.skillScanRequestId, storageId };
    });

    await fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
      adoptionId: started.adoptionId,
      scanAttemptId: attemptId,
    });
    const staged = await fixture.t.mutation(internal.skillsShAdoption.promoteReadyInternal, {
      adoptionId: started.adoptionId,
    });
    const state = await fixture.t.run(async (ctx) => {
      const adoption = await ctx.db.get(started.adoptionId);
      const skill = adoption?.stagedSkillId ? await ctx.db.get(adoption.stagedSkillId) : null;
      const version = adoption?.stagedVersionId ? await ctx.db.get(adoption.stagedVersionId) : null;
      const request = await ctx.db.get(storedFile.requestId);
      return { adoption, skill, version, request };
    });

    expect(staged).toMatchObject({ status: "ready_to_promote", canonicalRef: null });
    expect(state.adoption).toMatchObject({ status: "ready_to_promote" });
    expect(state.adoption).not.toHaveProperty("canonicalRef");
    expect(state.adoption).not.toHaveProperty("promotedSkillId");
    expect(state.adoption).not.toHaveProperty("promotedVersionId");
    expect(state.version).toMatchObject({ publicationStatus: "pending" });
    expect(state.request).toMatchObject({ skillVersionId: state.version?._id });
    expect(state.skill?.latestVersionId).toBeUndefined();
    await expect(
      fixture.t.query(internal.skillsShAdoption.getPromotedByExternalIdInternal, {
        externalId: "acme/skills/demo",
      }),
    ).resolves.toBeNull();

    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(storedFile.requestId, { expiresAt: 0 });
    });
    await expect(
      fixture.t.mutation(internal.securityScan.pruneExpiredSkillScanRequestsInternal, {
        batchSize: 10,
      }),
    ).resolves.toMatchObject({
      deletedRequests: 0,
      deferredRequests: 1,
      deletedFiles: 0,
    });
    await expect(
      fixture.t.run(async (ctx) => ({
        request: await ctx.db.get(storedFile.requestId),
        hasFile: Boolean(await ctx.storage.get(storedFile.storageId)),
      })),
    ).resolves.toMatchObject({
      request: { skillVersionId: state.version?._id, writtenBack: false },
      hasFile: true,
    });
  });

  it("binds mirrored inference metadata to a newly staged native skill", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    const started = await startMirroredAdoption(fixture);
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);

    await fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
      adoptionId: started.adoptionId,
      scanAttemptId: attemptId,
    });
    await fixture.t.mutation(internal.skillsShAdoption.promoteReadyInternal, {
      adoptionId: started.adoptionId,
    });

    const state = await fixture.t.run(async (ctx) => {
      const adoption = await ctx.db.get(started.adoptionId);
      const skill = adoption?.stagedSkillId ? await ctx.db.get(adoption.stagedSkillId) : null;
      return { adoption, skill };
    });
    expect(state.skill).toMatchObject({
      inferredCategories: ["development"],
      inferredTopics: ["html"],
      inferredFromVersionId: state.adoption?.stagedVersionId,
      inferredCategoryConfidence: "high",
      inferredTopicConfidence: "medium",
      inferredClassifierVersion: "taxonomy-prototype-v9",
      inferredTopicClassifierVersion: "topic-prototype-v1",
      inferredInputHash: "category-input",
      inferredTopicInputHash: "topic-input",
      inferredAt: fixture.now,
    });
    expect(state.skill?.latestVersionId).toBeUndefined();
  });

  it("stales a staged mirrored promotion when its digest advances to another source hash", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    const started = await startMirroredAdoption(fixture);
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);

    await fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
      adoptionId: started.adoptionId,
      scanAttemptId: attemptId,
    });
    await fixture.t.mutation(internal.skillsShAdoption.promoteReadyInternal, {
      adoptionId: started.adoptionId,
    });
    const staged = await fixture.t.run(async (ctx) => {
      const adoption = await ctx.db.get(started.adoptionId);
      if (!adoption?.mirrorDigestId || !adoption.stagedSkillId || !adoption.stagedVersionId) {
        throw new Error("staged mirrored adoption missing");
      }
      await ctx.db.patch(adoption.mirrorDigestId, {
        sourceContentHash: "d".repeat(64),
        displayName: "Newer snapshot",
        inferredCategories: ["operations"],
        inferredTopics: ["newer"],
        upstreamInstalls: 999_999,
      });
      await ctx.db.patch(adoption.stagedVersionId, {
        staticScan: {
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "Clean test fixture",
          engineVersion: "test",
          checkedAt: fixture.now + 1,
        },
      });
      return {
        skillId: adoption.stagedSkillId,
        versionId: adoption.stagedVersionId,
      };
    });

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.finalizeStagedPromotionInternal, {
        adoptionId: started.adoptionId,
      }),
    ).resolves.toMatchObject({
      status: "stale",
      skillId: null,
      versionId: null,
      canonicalRef: null,
    });
    await expect(
      fixture.t.run(async (ctx) => ({
        adoption: await ctx.db.get(started.adoptionId),
        skill: await ctx.db.get(staged.skillId),
        version: await ctx.db.get(staged.versionId),
      })),
    ).resolves.toMatchObject({
      adoption: {
        status: "stale",
        rejectionReason: "catalog_source_changed",
      },
      skill: null,
      version: null,
    });
    const staleAdoption = await fixture.t.run(async (ctx) => await ctx.db.get(started.adoptionId));
    expect(staleAdoption).not.toHaveProperty("stagedSkillId");
    expect(staleAdoption).not.toHaveProperty("stagedVersionId");
    expect(staleAdoption).not.toHaveProperty("stagedVersionCreated");
    await expect(
      fixture.t.mutation(internal.skillsShAdoption.promoteReadyInternal, {
        adoptionId: started.adoptionId,
      }),
    ).rejects.toThrow("skills.sh adoption is not ready to promote");
  });

  it("stales a staged mirrored promotion when its digest is tombstoned", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    const started = await startMirroredAdoption(fixture);
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);

    await fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
      adoptionId: started.adoptionId,
      scanAttemptId: attemptId,
    });
    await fixture.t.mutation(internal.skillsShAdoption.promoteReadyInternal, {
      adoptionId: started.adoptionId,
    });
    await fixture.t.run(async (ctx) => {
      const adoption = await ctx.db.get(started.adoptionId);
      if (!adoption?.mirrorDigestId || !adoption.stagedVersionId) {
        throw new Error("staged mirrored adoption missing");
      }
      await ctx.db.patch(adoption.mirrorDigestId, {
        active: false,
        tombstonedAt: fixture.now + 1,
      });
      await ctx.db.patch(adoption.stagedVersionId, {
        staticScan: {
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "Clean test fixture",
          engineVersion: "test",
          checkedAt: fixture.now + 1,
        },
      });
    });

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.finalizeStagedPromotionInternal, {
        adoptionId: started.adoptionId,
      }),
    ).resolves.toMatchObject({
      status: "stale",
      skillId: null,
      versionId: null,
      canonicalRef: null,
    });
    const adoption = await fixture.t.run(async (ctx) => await ctx.db.get(started.adoptionId));
    expect(adoption).toMatchObject({
      status: "stale",
      rejectionReason: "catalog_source_changed",
    });
    expect(adoption).not.toHaveProperty("stagedSkillId");
    expect(adoption).not.toHaveProperty("stagedVersionId");
  });

  it("does not replace native inference metadata until mirrored promotion succeeds", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.destinationSkillId!, {
        inferredCategories: ["operations"],
        inferredTopics: ["legacy"],
        inferredClassifierVersion: "legacy-v1",
      });
    });
    const started = await startMirroredAdoption(fixture);
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);

    await fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
      adoptionId: started.adoptionId,
      scanAttemptId: attemptId,
    });
    await fixture.t.mutation(internal.skillsShAdoption.promoteReadyInternal, {
      adoptionId: started.adoptionId,
    });
    await expect(
      fixture.t.run(async (ctx) => await ctx.db.get(fixture.destinationSkillId!)),
    ).resolves.toMatchObject({
      inferredCategories: ["operations"],
      inferredTopics: ["legacy"],
      inferredClassifierVersion: "legacy-v1",
    });

    const stagedVersionId = await fixture.t.run(async (ctx) => {
      const adoption = await ctx.db.get(started.adoptionId);
      if (!adoption?.stagedVersionId) throw new Error("staged version missing");
      await ctx.db.patch(adoption.stagedVersionId, {
        staticScan: {
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "Clean test fixture",
          engineVersion: "test",
          checkedAt: fixture.now + 1,
        },
      });
      return adoption.stagedVersionId;
    });
    await expect(
      fixture.t.mutation(internal.skillsShAdoption.finalizeStagedPromotionInternal, {
        adoptionId: started.adoptionId,
      }),
    ).resolves.toMatchObject({
      status: "promoted",
      skillId: fixture.destinationSkillId,
      versionId: stagedVersionId,
    });
    await expect(
      fixture.t.run(async (ctx) => await ctx.db.get(fixture.destinationSkillId!)),
    ).resolves.toMatchObject({
      inferredCategories: ["development"],
      inferredTopics: ["html"],
      inferredFromVersionId: stagedVersionId,
      inferredCategoryConfidence: "high",
      inferredTopicConfidence: "medium",
      inferredClassifierVersion: "taxonomy-prototype-v9",
      inferredTopicClassifierVersion: "topic-prototype-v1",
      inferredInputHash: "category-input",
      inferredTopicInputHash: "topic-input",
      inferredAt: fixture.now,
    });
  });

  it("releases a staged scan request for pruning when the destination becomes stale", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);
    const requestId = await fixture.t.run(async (ctx) => {
      const attempt = await ctx.db.get(attemptId);
      if (!attempt?.skillScanRequestId) throw new Error("scan request missing");
      const storageId = await ctx.storage.store(new Blob(["# Demo"], { type: "text/markdown" }));
      await ctx.db.patch(attempt.skillScanRequestId, {
        files: [
          {
            path: "SKILL.md",
            size: 6,
            storageId,
            sha256: "f".repeat(64),
            contentType: "text/markdown",
          },
        ],
      });
      return attempt.skillScanRequestId;
    });

    await fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
      adoptionId: started.adoptionId,
      scanAttemptId: attemptId,
    });
    await fixture.t.mutation(internal.skillsShAdoption.promoteReadyInternal, {
      adoptionId: started.adoptionId,
    });
    const stagedVersionId = await fixture.t.run(async (ctx) => {
      const adoption = await ctx.db.get(started.adoptionId);
      if (!adoption?.stagedVersionId) throw new Error("staged version missing");
      await ctx.db.patch(adoption.stagedVersionId, {
        staticScan: {
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "Clean test fixture",
          engineVersion: "test",
          checkedAt: fixture.now + 1,
        },
      });
      await ctx.db.patch(fixture.destinationSkillId!, {
        githubCurrentCommit: "f".repeat(40),
        githubCurrentContentHash: "0".repeat(64),
        updatedAt: fixture.now + 1,
      });
      return adoption.stagedVersionId;
    });

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.finalizeStagedPromotionInternal, {
        adoptionId: started.adoptionId,
      }),
    ).resolves.toMatchObject({
      status: "stale",
      skillId: fixture.destinationSkillId,
    });
    const staleState = await fixture.t.run(async (ctx) => ({
      adoption: await ctx.db.get(started.adoptionId),
      request: await ctx.db.get(requestId),
      version: await ctx.db.get(stagedVersionId),
    }));
    expect(staleState.adoption).not.toHaveProperty("stagedSkillId");
    expect(staleState.adoption).not.toHaveProperty("stagedVersionId");
    expect(staleState.adoption).not.toHaveProperty("stagedVersionCreated");
    expect(staleState.request).toMatchObject({ writtenBack: true });
    expect(staleState.request).not.toHaveProperty("skillVersionId");
    expect(staleState.version).toBeNull();
  });

  it("retries staged static scan execution and cleans up after bounded failures", async () => {
    useLocalEnvironment();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    const started = await startMirroredAdoption(fixture);
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);
    await fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
      adoptionId: started.adoptionId,
      scanAttemptId: attemptId,
    });
    await fixture.t.mutation(internal.skillsShAdoption.promoteReadyInternal, {
      adoptionId: started.adoptionId,
    });
    const staged = await fixture.t.run(async (ctx) => {
      const adoption = await ctx.db.get(started.adoptionId);
      const attempt = await ctx.db.get(attemptId);
      if (!adoption?.stagedSkillId || !adoption.stagedVersionId || !attempt?.skillScanRequestId) {
        throw new Error("staged adoption missing");
      }
      return {
        skillId: adoption.stagedSkillId,
        versionId: adoption.stagedVersionId,
        requestId: attempt.skillScanRequestId,
      };
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(
        fixture.t.mutation(internal.skillsShAdoption.beginStagedStaticScanInternal, {
          adoptionId: started.adoptionId,
          skillId: staged.skillId,
          versionId: staged.versionId,
        }),
      ).resolves.toEqual({ shouldRun: true, attempt });
      await expect(
        fixture.t.mutation(internal.skillsShAdoption.recordStagedStaticScanFailureInternal, {
          adoptionId: started.adoptionId,
          skillId: staged.skillId,
          versionId: staged.versionId,
          attempt,
          error: "transient static scanner outage",
        }),
      ).resolves.toEqual({
        retry: attempt < 3,
        canceled: attempt === 3,
      });
    }

    const failureState = await fixture.t.run(async (ctx) => ({
      adoption: await ctx.db.get(started.adoptionId),
      request: await ctx.db.get(staged.requestId),
      skill: await ctx.db.get(staged.skillId),
      version: await ctx.db.get(staged.versionId),
    }));
    expect(failureState).toMatchObject({
      adoption: {
        status: "canceled",
        staticScanAttempts: 3,
        staticScanLastError: "transient static scanner outage",
        rejectionReason: "static_scan_execution_failed",
      },
      request: {
        writtenBack: true,
      },
      skill: null,
      version: null,
    });
    expect(failureState.request).not.toHaveProperty("skillVersionId");
  });

  it("releases a newly created destination when the staged static scan is malicious", async () => {
    useLocalEnvironment();
    vi.useFakeTimers();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "none",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);
    await fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
      adoptionId: started.adoptionId,
      scanAttemptId: attemptId,
    });
    await fixture.t.mutation(internal.skillsShAdoption.promoteReadyInternal, {
      adoptionId: started.adoptionId,
    });
    const staged = await fixture.t.run(async (ctx) => {
      const adoption = await ctx.db.get(started.adoptionId);
      if (!adoption?.stagedSkillId || !adoption.stagedVersionId) {
        throw new Error("staged adoption missing");
      }
      await ctx.db.patch(adoption.stagedVersionId, {
        staticScan: {
          status: "malicious",
          reasonCodes: ["test.malicious"],
          findings: [],
          summary: "Malicious test fixture",
          engineVersion: "test",
          checkedAt: fixture.now + 1,
        },
      });
      const attempt = await ctx.db.get(attemptId);
      if (!attempt?.skillScanRequestId) throw new Error("scan request missing");
      return {
        skillId: adoption.stagedSkillId,
        versionId: adoption.stagedVersionId,
        requestId: attempt.skillScanRequestId,
      };
    });

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.finalizeStagedPromotionInternal, {
        adoptionId: started.adoptionId,
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      skillId: null,
      versionId: null,
    });

    const state = await fixture.t.run(async (ctx) => ({
      adoption: await ctx.db.get(started.adoptionId),
      skill: await ctx.db.get(staged.skillId),
      version: await ctx.db.get(staged.versionId),
      request: await ctx.db.get(staged.requestId),
      fingerprints: await ctx.db
        .query("skillVersionFingerprints")
        .withIndex("by_version", (q) => q.eq("versionId", staged.versionId))
        .collect(),
    }));
    expect(state.adoption).toMatchObject({
      status: "rejected",
      rejectionReason: "static_scan_malicious",
    });
    expect(state.adoption).not.toHaveProperty("stagedSkillId");
    expect(state.adoption).not.toHaveProperty("stagedVersionId");
    expect(state.skill).toBeNull();
    expect(state.version).toBeNull();
    expect(state.request?.skillVersionId).toBeUndefined();
    expect(state.fingerprints).toEqual([]);
    await expect(getPreview(fixture)).resolves.toMatchObject({
      canStart: true,
      destination: { kind: "create" },
    });
  });

  it("blocks a reused malicious version and restores the prior published destination", async () => {
    useLocalEnvironment();
    vi.useFakeTimers();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);
    const exact = await fixture.t.run(async (ctx) => {
      const attempt = await ctx.db.get(attemptId);
      if (!attempt?.skillScanRequestId) throw new Error("scan request missing");
      const storageId = await ctx.storage.store(new Blob(["# Demo"], { type: "text/markdown" }));
      const file = {
        path: "SKILL.md",
        size: 6,
        storageId,
        sha256: "f".repeat(64),
        contentType: "text/markdown",
      };
      await ctx.db.patch(attempt.skillScanRequestId, {
        files: [file],
        llmAnalysis: {
          status: "clean",
          verdict: "clean",
          checkedAt: fixture.now + 1,
        },
      });
      const previousVersionId = await ctx.db.insert("skillVersions", {
        skillId: fixture.destinationSkillId!,
        version: "previous",
        publicationStatus: "published",
        fingerprint: "8".repeat(64),
        changelog: "Previous safe version",
        files: [],
        parsed: { frontmatter: { description: "Previous safe content" } },
        createdBy: fixture.userId,
        createdAt: fixture.now - 1,
        sha256hash: "8".repeat(64),
      });
      for (let index = 0; index < 55; index += 1) {
        await ctx.db.insert("skillVersions", {
          skillId: fixture.destinationSkillId!,
          version: `blocked-${index}`,
          publicationStatus: "blocked",
          fingerprint: String(index).padStart(64, "0"),
          changelog: "Blocked historical version",
          files: [],
          parsed: { frontmatter: {} },
          createdBy: fixture.userId,
          createdAt: fixture.now + index + 1,
          sha256hash: String(index).padStart(64, "0"),
        });
      }
      const versionId = await ctx.db.insert("skillVersions", {
        skillId: fixture.destinationSkillId!,
        version: "a".repeat(40),
        publicationStatus: "published",
        fingerprint: "9".repeat(64),
        changelog: "Existing exact commit",
        sourceProvenance: {
          kind: "github",
          url: `https://github.com/acme/skills/tree/${"a".repeat(40)}/skills/demo`,
          repo: "acme/skills",
          ref: "a".repeat(40),
          commit: "a".repeat(40),
          path: "skills/demo",
          importedAt: fixture.now,
        },
        files: [file],
        parsed: { frontmatter: {} },
        createdBy: fixture.userId,
        createdAt: fixture.now,
        sha256hash: "9".repeat(64),
      });
      return {
        previousVersionId,
        requestId: attempt.skillScanRequestId,
        versionId,
      };
    });

    await fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
      adoptionId: started.adoptionId,
      scanAttemptId: attemptId,
    });
    await fixture.t.mutation(internal.skillsShAdoption.promoteReadyInternal, {
      adoptionId: started.adoptionId,
    });
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.destinationSkillId!, {
        latestVersionId: exact.versionId,
        tags: { latest: exact.versionId, risky: exact.versionId },
        latestVersionSummary: {
          version: "a".repeat(40),
          createdAt: fixture.now,
          changelog: "Existing exact commit",
        },
      });
      await ctx.db.patch(exact.versionId, {
        staticScan: {
          status: "malicious",
          reasonCodes: ["test.malicious"],
          findings: [],
          summary: "Malicious test fixture",
          engineVersion: "test",
          checkedAt: fixture.now + 1,
        },
      });
    });

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.finalizeStagedPromotionInternal, {
        adoptionId: started.adoptionId,
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      skillId: fixture.destinationSkillId,
      versionId: exact.versionId,
    });

    const state = await fixture.t.run(async (ctx) => ({
      adoption: await ctx.db.get(started.adoptionId),
      skill: await ctx.db.get(fixture.destinationSkillId!),
      version: await ctx.db.get(exact.versionId),
      request: await ctx.db.get(exact.requestId),
    }));
    expect(state.adoption).toMatchObject({
      status: "rejected",
      rejectionReason: "static_scan_malicious",
    });
    expect(state.version).toMatchObject({ publicationStatus: "blocked" });
    expect(state.skill).toMatchObject({
      moderationStatus: "active",
      latestVersionId: exact.previousVersionId,
      latestVersionSummary: {
        version: "previous",
        changelog: "Previous safe version",
        description: "Previous safe content",
      },
      tags: { latest: exact.previousVersionId },
    });
    expect(state.request).toMatchObject({ writtenBack: true });
  });

  it("removes tags to a reused malicious historical version without replacing the safe latest", async () => {
    useLocalEnvironment();
    vi.useFakeTimers();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);
    await fixture.t.run(async (ctx) => {
      const attempt = await ctx.db.get(attemptId);
      if (!attempt?.skillScanRequestId) throw new Error("scan request missing");
      const storageId = await ctx.storage.store(new Blob(["# Demo"], { type: "text/markdown" }));
      await ctx.db.patch(attempt.skillScanRequestId, {
        files: [
          {
            path: "SKILL.md",
            size: 6,
            storageId,
            sha256: "f".repeat(64),
            contentType: "text/markdown",
          },
        ],
        llmAnalysis: {
          status: "clean",
          verdict: "clean",
          checkedAt: fixture.now + 1,
        },
      });
    });

    await fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
      adoptionId: started.adoptionId,
      scanAttemptId: attemptId,
    });
    await fixture.t.mutation(internal.skillsShAdoption.promoteReadyInternal, {
      adoptionId: started.adoptionId,
    });
    const staged = await fixture.t.run(async (ctx) => {
      const adoption = await ctx.db.get(started.adoptionId);
      if (!adoption?.stagedVersionId) throw new Error("staged version missing");
      const safeVersionId = await ctx.db.insert("skillVersions", {
        skillId: fixture.destinationSkillId!,
        version: "safe-latest",
        publicationStatus: "published",
        fingerprint: "8".repeat(64),
        changelog: "Safe current version",
        files: [],
        parsed: { frontmatter: { description: "Safe current content" } },
        createdBy: fixture.userId,
        createdAt: fixture.now - 1,
        sha256hash: "8".repeat(64),
      });
      await ctx.db.patch(fixture.destinationSkillId!, {
        latestVersionId: safeVersionId,
        tags: {
          latest: safeVersionId,
          risky: adoption.stagedVersionId,
        },
        latestVersionSummary: {
          version: "safe-latest",
          createdAt: fixture.now - 1,
          changelog: "Safe current version",
          description: "Safe current content",
        },
      });
      await ctx.db.patch(adoption.stagedVersionId, {
        staticScan: {
          status: "malicious",
          reasonCodes: ["test.malicious"],
          findings: [],
          summary: "Malicious test fixture",
          engineVersion: "test",
          checkedAt: fixture.now + 1,
        },
      });
      return { safeVersionId, versionId: adoption.stagedVersionId };
    });

    await expect(
      fixture.t.mutation(internal.skillsShAdoption.finalizeStagedPromotionInternal, {
        adoptionId: started.adoptionId,
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      skillId: fixture.destinationSkillId,
      versionId: staged.versionId,
    });
    await expect(
      fixture.t.run(async (ctx) => ({
        skill: await ctx.db.get(fixture.destinationSkillId!),
        version: await ctx.db.get(staged.versionId),
      })),
    ).resolves.toMatchObject({
      skill: {
        latestVersionId: staged.safeVersionId,
        tags: { latest: staged.safeVersionId },
      },
      version: { publicationStatus: "blocked" },
    });
  });

  it("fails closed when the commit-named destination version has different content", async () => {
    useLocalEnvironment();
    vi.useFakeTimers();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("skillVersions", {
        skillId: fixture.destinationSkillId!,
        version: "a".repeat(40),
        publicationStatus: "published",
        fingerprint: "1".repeat(64),
        changelog: "Conflicting historical version",
        sourceProvenance: {
          kind: "github",
          url: `https://github.com/acme/skills/tree/${"a".repeat(40)}/skills/demo`,
          repo: "acme/skills",
          ref: "a".repeat(40),
          commit: "a".repeat(40),
          path: "skills/demo",
          importedAt: fixture.now,
        },
        files: [],
        parsed: { frontmatter: {} },
        createdBy: fixture.userId,
        createdAt: fixture.now,
        sha256hash: "1".repeat(64),
      });
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);
    await fixture.t.run(async (ctx) => {
      const attempt = await ctx.db.get(attemptId);
      if (!attempt?.skillScanRequestId) throw new Error("scan request missing");
      await ctx.db.patch(attempt.skillScanRequestId, {
        llmAnalysis: {
          status: "clean",
          verdict: "clean",
          checkedAt: fixture.now + 1,
        },
      });
    });

    await fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
      adoptionId: started.adoptionId,
      scanAttemptId: attemptId,
    });
    await fixture.t.finishAllScheduledFunctions(vi.runAllTimers);

    const state = await fixture.t.run(async (ctx) => ({
      adoption: await ctx.db.get(started.adoptionId),
      skill: await ctx.db.get(fixture.destinationSkillId!),
    }));
    expect(state.adoption).toMatchObject({
      status: "stale",
      rejectionReason: "destination_version_conflict",
    });
    expect(state.skill).toMatchObject({ stats: { versions: 4 } });
    expect(state.skill?.latestVersionId).toBeUndefined();
  });

  it("reuses an exact commit version without retaining duplicate scan blobs", async () => {
    useLocalEnvironment();
    vi.useFakeTimers();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);
    const exact = await fixture.t.run(async (ctx) => {
      const attempt = await ctx.db.get(attemptId);
      if (!attempt?.skillScanRequestId) throw new Error("scan request missing");
      const existingStorageId = await ctx.storage.store(
        new Blob(["# Demo"], { type: "text/markdown" }),
      );
      const requestStorageId = await ctx.storage.store(
        new Blob(["# Demo"], { type: "text/markdown" }),
      );
      const file = {
        path: "SKILL.md",
        size: 6,
        sha256: "f".repeat(64),
        contentType: "text/markdown",
      };
      await ctx.db.patch(attempt.skillScanRequestId, {
        files: [{ ...file, storageId: requestStorageId }],
        llmAnalysis: {
          status: "clean",
          verdict: "clean",
          checkedAt: fixture.now + 1,
        },
      });
      const versionId = await ctx.db.insert("skillVersions", {
        skillId: fixture.destinationSkillId!,
        version: "a".repeat(40),
        publicationStatus: "published",
        fingerprint: "9".repeat(64),
        changelog: "Existing exact commit",
        sourceProvenance: {
          kind: "github",
          url: `https://github.com/acme/skills/tree/${"a".repeat(40)}/skills/demo`,
          repo: "acme/skills",
          ref: "a".repeat(40),
          commit: "a".repeat(40),
          path: "skills/demo",
          importedAt: fixture.now,
        },
        files: [{ ...file, storageId: existingStorageId }],
        parsed: { frontmatter: {} },
        createdBy: fixture.userId,
        createdAt: fixture.now,
        sha256hash: "9".repeat(64),
      });
      return { versionId, requestId: attempt.skillScanRequestId };
    });

    await fixture.t.mutation(internal.skillsShAdoption.recordScanOutcomeInternal, {
      adoptionId: started.adoptionId,
      scanAttemptId: attemptId,
    });
    await fixture.t.finishAllScheduledFunctions(vi.runAllTimers);

    const state = await fixture.t.run(async (ctx) => ({
      adoption: await ctx.db.get(started.adoptionId),
      skill: await ctx.db.get(fixture.destinationSkillId!),
      version: await ctx.db.get(exact.versionId),
      request: await ctx.db.get(exact.requestId),
    }));
    expect(state.adoption).toMatchObject({
      status: "promoted",
      promotedVersionId: exact.versionId,
    });
    expect(state.version).toMatchObject({
      llmAnalysis: { status: "clean", verdict: "clean" },
      staticScan: { status: "clean" },
    });
    expect(state.request).toMatchObject({ writtenBack: true });
    expect(state.request?.skillVersionId).toBeUndefined();
    expect(state.skill).toMatchObject({
      latestVersionId: exact.versionId,
      stats: { versions: 4 },
    });
  });

  it("promotes a completed scan callback as a native archive while preserving destination history", async () => {
    for (const [name, value] of Object.entries(TEST_ENV)) vi.stubEnv(name, value);
    vi.useFakeTimers();
    const fixture = await seedAdoptionFixture({
      githubProviderAccountId: "42",
      destination: "owned",
    });
    const preview = await getPreview(fixture);
    const started = await fixture.t
      .withIdentity({ subject: fixture.userId })
      .mutation(api.skillsShAdoption.start, {
        publisherId: fixture.publisherId,
        externalId: "acme/skills/demo",
        sourceContentHash: "c".repeat(64),
        idempotencyKey: preview!.idempotencyKey,
      });
    const attemptId = await insertSucceededScan(fixture, started.adoptionId);
    const linked = await fixture.t.run(async (ctx) => {
      const attempt = await ctx.db.get(attemptId);
      if (!attempt?.skillScanRequestId || !attempt.securityScanJobId) {
        throw new Error("scan execution missing");
      }
      const storageId = await ctx.storage.store(
        new Blob(["---\nname: demo\ndescription: Adopted demo\n---\n# Demo\n"], {
          type: "text/markdown",
        }),
      );
      await ctx.db.patch(attempt.skillScanRequestId, {
        status: "running",
        files: [
          {
            path: "SKILL.md",
            size: 57,
            storageId,
            sha256: "f".repeat(64),
            contentType: "text/markdown",
          },
        ],
        completedAt: undefined,
      });
      await ctx.db.patch(attempt.securityScanJobId, {
        status: "running",
        leaseToken: "adoption-lease",
        leaseExpiresAt: fixture.now + 60_000,
        workerId: "adoption-worker",
        completedAt: undefined,
      });
      await ctx.db.patch(attempt._id, {
        status: "running",
        verdict: undefined,
        completedAt: undefined,
      });
      await ctx.db.patch(fixture.entryId, {
        scanStatus: "queued",
      });
      return {
        scanId: attempt.skillScanRequestId,
        jobId: attempt.securityScanJobId,
        artifactContentHash: attempt.artifactContentHash!,
      };
    });

    vi.setSystemTime(fixture.now + 2_000);
    await fixture.t.mutation(internal.securityScan.completeCatalogSkillScanJobInternal, {
      attemptId,
      scanId: linked.scanId,
      jobId: linked.jobId,
      leaseToken: "adoption-lease",
      artifactContentHash: linked.artifactContentHash,
      verdict: "clean",
      runId: "adoption-clawscan-run",
      llmAnalysis: {
        status: "clean",
        verdict: "clean",
        confidence: "high",
        summary: "No unsafe behavior found.",
        checkedAt: fixture.now + 2_000,
      },
    });
    await fixture.t.finishAllScheduledFunctions(vi.runAllTimers);

    const state = await fixture.t.run(async (ctx) => {
      const adoption = await ctx.db.get(started.adoptionId);
      const skill = fixture.destinationSkillId
        ? await ctx.db.get(fixture.destinationSkillId)
        : null;
      const version = adoption?.promotedVersionId
        ? await ctx.db.get(adoption.promotedVersionId)
        : null;
      const request = version
        ? await ctx.db
            .query("skillScanRequests")
            .withIndex("by_skill_version_id_and_created_at", (q) =>
              q.eq("skillVersionId", version._id),
            )
            .first()
        : null;
      const fingerprints = version
        ? await ctx.db
            .query("skillVersionFingerprints")
            .withIndex("by_version", (q) => q.eq("versionId", version._id))
            .collect()
        : [];
      const cardJob = version
        ? await ctx.db
            .query("skillCardGenerationJobs")
            .withIndex("by_skill_version", (q) => q.eq("skillVersionId", version._id))
            .first()
        : null;
      return { adoption, skill, version, request, fingerprints, cardJob };
    });

    expect(state.adoption).toMatchObject({
      status: "promoted",
      promotedSkillId: fixture.destinationSkillId,
      canonicalRef: "@alice/demo",
    });
    expect(state.skill).toMatchObject({
      _id: fixture.destinationSkillId,
      statsDownloads: 800,
      statsStars: 90,
      stats: {
        downloads: 800,
        stars: 90,
        comments: 7,
        versions: 5,
      },
      latestVersionSummary: {
        version: "a".repeat(40),
      },
    });
    expect(state.skill?.installKind).toBeUndefined();
    expect(state.version).toMatchObject({
      version: "a".repeat(40),
      publicationStatus: "published",
      sourceProvenance: {
        repo: "acme/skills",
        commit: "a".repeat(40),
        path: "skills/demo",
      },
      files: [{ path: "SKILL.md" }],
    });
    expect(state.request).toMatchObject({
      skillVersionId: state.version?._id,
      writtenBack: true,
    });
    expect(state.version?.staticScan).toMatchObject({
      status: "clean",
      checkedAt: expect.any(Number),
    });
    expect(state.fingerprints).toContainEqual(
      expect.objectContaining({
        versionId: state.version?._id,
        fingerprint: "9".repeat(64),
        kind: "source",
      }),
    );
    expect(state.cardJob).toMatchObject({
      skillVersionId: state.version?._id,
      status: "queued",
      source: "scan",
    });
    await expect(
      fixture.t.query(internal.skillsShAdoption.getPromotedByExternalIdInternal, {
        externalId: "acme/skills/demo",
      }),
    ).resolves.toMatchObject({
      state: "promoted",
      canonicalRef: "@alice/demo",
      skillId: fixture.destinationSkillId,
      versionId: state.version?._id,
      githubCommit: "a".repeat(40),
      sourceContentHash: "c".repeat(64),
    });

    await fixture.t.run(async (ctx) => {
      if (!state.version) throw new Error("promoted version missing");
      await ctx.db.patch(state.version._id, { publicationStatus: "blocked" });
    });
    await expect(
      fixture.t.query(internal.skillsShAdoption.getPromotedByExternalIdInternal, {
        externalId: "acme/skills/demo",
      }),
    ).resolves.toEqual({
      state: "invalidated",
      externalId: "acme/skills/demo",
      reference: "skills-sh:acme/skills/demo",
    });
  });
});
