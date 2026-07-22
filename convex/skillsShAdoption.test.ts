/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const LOCAL_ENV = {
  CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
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
      snapshotId: "snapshot-1",
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
      externalId: "acme/skills/demo",
      githubOwnerId: 42,
      owner: "acme",
      repo: "skills",
      slug: "demo",
      githubPath: "skills/demo",
      githubCommit: "a".repeat(40),
      githubContentHash: "b".repeat(64),
      sourceContentHash: "c".repeat(64),
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
  afterEach(() => {
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
});
