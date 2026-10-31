/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedSkillFinalization(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    const skillId = await ctx.db.insert("skills", {
      slug: "finalization-runtime",
      displayName: "Finalization Runtime",
      ownerUserId: userId,
      tags: {},
      stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    const versionId = await ctx.db.insert("skillVersions", {
      skillId,
      version: "1.0.0",
      publicationStatus: "published",
      fingerprint: "fingerprint",
      pendingPublication: { skillInsertArgs: {} },
      changelog: "original",
      files: [],
      parsed: { frontmatter: {} },
      createdBy: userId,
      createdAt: 1,
    });
    const embeddingId = await ctx.db.insert("skillEmbeddings", {
      skillId,
      versionId,
      embedding: [0.1],
      ownerId: userId,
      isLatest: true,
      isApproved: true,
      visibility: "public",
      updatedAt: 1,
    });
    await ctx.db.patch(skillId, { latestVersionId: versionId, tags: { latest: versionId } });
    const attemptId = await ctx.db.insert("publishAttempts", {
      kind: "skill",
      status: "finalizing",
      userId,
      skillId,
      skillVersionId: versionId,
      slug: "finalization-runtime",
      displayName: "Finalization Runtime",
      version: "1.0.0",
      idempotencyKey: "finalization-runtime",
      artifactFingerprint: "fingerprint",
      files: [],
      followup: {},
      checks: { trufflehog: { status: "clean" }, clawscan: { status: "clean" } },
      finalizationClaimId: "finalizer",
      finalizationClaimExpiresAt: Date.now() + 60_000,
      createdAt: 1,
      updatedAt: 1,
      expiresAt: Date.now() + 60_000,
    });
    return { attemptId, result: { skillId, versionId, embeddingId } };
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publish attempt runtime recovery", () => {
  it("atomically records required skill followups once for concurrent finalization retries", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const fixture = await seedSkillFinalization(t);
      const finalizationArgs = { ...fixture, claimId: "finalizer" };
      await Promise.all([
        t.mutation(
          internal.publishAttempts.recordSkillPublishAttemptFinalizedInternal,
          finalizationArgs,
        ),
        t.mutation(
          internal.publishAttempts.recordSkillPublishAttemptFinalizedInternal,
          finalizationArgs,
        ),
      ]);
      const state = await t.run(async (ctx) => ({
        attempt: await ctx.db.get(fixture.attemptId),
        version: await ctx.db.get(fixture.result.versionId),
        skill: await ctx.db.get(fixture.result.skillId),
        jobs: await ctx.db.system.query("_scheduled_functions").collect(),
      }));
      expect(state.attempt).toMatchObject({ status: "finalized", result: fixture.result });
      expect(state.version).toMatchObject({
        publicationStatus: "published",
        fingerprint: "fingerprint",
        changelog: "original",
      });
      expect(state.version?.pendingPublication).toBeUndefined();
      expect(state.skill).toMatchObject({
        latestVersionId: fixture.result.versionId,
        tags: { latest: fixture.result.versionId },
      });
      const jobs = state.jobs.filter(
        (job) =>
          job.name === "vt:scanWithVirusTotal" ||
          job.name === "securityScan:enqueueSkillVersionScanInternal",
      );
      expect(
        jobs.map(({ name, args, scheduledTime }) => ({
          name,
          args,
          delay: scheduledTime - Date.now(),
        })),
      ).toEqual([
        {
          name: "vt:scanWithVirusTotal",
          args: [{ versionId: fixture.result.versionId }],
          delay: 0,
        },
        {
          name: "securityScan:enqueueSkillVersionScanInternal",
          args: [{ versionId: fixture.result.versionId, source: "publish" }],
          delay: 0,
        },
        {
          name: "securityScan:enqueueSkillVersionScanInternal",
          args: [
            {
              versionId: fixture.result.versionId,
              source: "publish",
              preserveActiveJob: true,
              preserveExistingJob: true,
            },
          ],
          delay: 2_000,
        },
        {
          name: "securityScan:enqueueSkillVersionScanInternal",
          args: [
            {
              versionId: fixture.result.versionId,
              source: "publish",
              preserveActiveJob: true,
              preserveExistingJob: true,
            },
          ],
          delay: 15_000,
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["scheduler", "receipt"] as const)(
    "rolls back every skill enqueue on %s failure",
    async (failure) => {
      vi.useFakeTimers();
      try {
        const t = convexTest(schema, modules);
        const fixture = await seedSkillFinalization(t);
        const { recordSkillPublishAttemptFinalizedInternal } = await import("./publishAttempts");
        let enqueues = 0;
        await expect(
          t.run(async (ctx) => {
            const wrapped = {
              ...ctx,
              scheduler: {
                ...ctx.scheduler,
                runAfter: async (...args: Parameters<typeof ctx.scheduler.runAfter>) => {
                  enqueues += 1;
                  if (failure === "scheduler" && enqueues === 3)
                    throw new Error("injected scheduler failure");
                  return await ctx.scheduler.runAfter(args[0], args[1], args[2]);
                },
              },
              db: {
                ...ctx.db,
                patch: async (...args: Parameters<typeof ctx.db.patch>) => {
                  if (failure === "receipt" && args[0] === fixture.attemptId)
                    throw new Error("injected receipt failure");
                  return await ctx.db.patch(...args);
                },
              },
            };
            await (
              recordSkillPublishAttemptFinalizedInternal as unknown as {
                _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
              }
            )._handler(wrapped, { ...fixture, claimId: "finalizer" });
          }),
        ).rejects.toThrow(`injected ${failure} failure`);
        expect(enqueues).toBe(failure === "scheduler" ? 3 : 4);
        const state = await t.run(async (ctx) => ({
          attempt: await ctx.db.get(fixture.attemptId),
          version: await ctx.db.get(fixture.result.versionId),
          jobs: await ctx.db.system.query("_scheduled_functions").collect(),
        }));
        expect(state.attempt?.status).toBe("finalizing");
        expect(state.version?.pendingPublication).toEqual({ skillInsertArgs: {} });
        expect(state.jobs).toEqual([]);
        await t.mutation(internal.publishAttempts.recordSkillPublishAttemptFinalizedInternal, {
          ...fixture,
          claimId: "finalizer",
        });
        expect((await t.run(async (ctx) => ctx.db.get(fixture.attemptId)))?.status).toBe(
          "finalized",
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each([
    "wrong claim",
    "expired claim",
    "wrong result",
    "pending result",
    "changed fingerprint",
  ] as const)("rejects %s before enqueue or receipt writes", async (failure) => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const fixture = await seedSkillFinalization(t);
      const finalizationArgs = {
        ...fixture,
        claimId: failure === "wrong claim" ? "foreign" : "finalizer",
      };
      if (failure === "expired claim")
        await t.run(async (ctx) =>
          ctx.db.patch(fixture.attemptId, { finalizationClaimExpiresAt: Date.now() }),
        );
      if (failure === "wrong result") {
        const other = await seedSkillFinalization(t);
        finalizationArgs.result = other.result;
      }
      if (failure === "pending result")
        await t.run(async (ctx) =>
          ctx.db.patch(fixture.result.versionId, { publicationStatus: "pending" }),
        );
      if (failure === "changed fingerprint")
        await t.run(async (ctx) =>
          ctx.db.patch(fixture.result.versionId, { fingerprint: "changed" }),
        );
      await expect(
        t.mutation(
          internal.publishAttempts.recordSkillPublishAttemptFinalizedInternal,
          finalizationArgs,
        ),
      ).rejects.toThrow();
      const state = await t.run(async (ctx) => ({
        attempt: await ctx.db.get(fixture.attemptId),
        jobs: await ctx.db.system.query("_scheduled_functions").collect(),
      }));
      expect(state.attempt?.status).toBe("finalizing");
      expect(state.jobs).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a legacy already-public result and returns its receipt without duplicating jobs", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const fixture = await seedSkillFinalization(t);
      await t.run(async (ctx) =>
        ctx.db.patch(fixture.attemptId, {
          skillId: undefined,
          skillVersionId: undefined,
          skillInsertArgs: {},
        }),
      );
      const first = await t.mutation(
        internal.publishAttempts.recordSkillPublishAttemptFinalizedInternal,
        { ...fixture, claimId: "finalizer" },
      );
      const repeated = await t.mutation(
        internal.publishAttempts.recordSkillPublishAttemptFinalizedInternal,
        { ...fixture, claimId: "old-claim" },
      );
      expect(repeated).toEqual(first);
      expect(
        await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect()),
      ).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["success", "security enqueue", "receipt", "legacy owner"] as const)(
    "commits package VT, security job and receipt together: %s",
    async (failure) => {
      vi.useFakeTimers();
      try {
        const t = convexTest(schema, modules);
        const fixture = await t.run(async (ctx) => {
          const userId = await ctx.db.insert("users", {});
          const verification = {
            tier: "structural" as const,
            scope: "artifact-only" as const,
            scanStatus: "pending" as const,
          };
          const packageId = await ctx.db.insert("packages", {
            name: "transaction-plugin",
            normalizedName: "transaction-plugin",
            displayName: "Transaction Plugin",
            ownerUserId: userId,
            family: "code-plugin",
            channel: "community",
            isOfficial: false,
            tags: {},
            compatibility: {},
            verification,
            scanStatus: "pending",
            stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
            createdAt: 1,
            updatedAt: 1,
          });
          const releaseId = await ctx.db.insert("packageReleases", {
            packageId,
            version: "1.0.0",
            publicationStatus: "published",
            changelog: "original",
            distTags: ["latest"],
            files: [],
            integritySha256: "fingerprint",
            compatibility: {},
            verification,
            createdBy: userId,
            publishActor: { kind: "user", userId },
            createdAt: 1,
          });
          await ctx.db.patch(packageId, {
            latestReleaseId: releaseId,
            tags: { latest: releaseId },
          });
          const attemptId = await ctx.db.insert("publishAttempts", {
            kind: "package",
            status: "finalizing",
            userId,
            ownerUserId: userId,
            packageId,
            packageReleaseId: releaseId,
            slug: "transaction-plugin",
            displayName: "Transaction Plugin",
            version: "1.0.0",
            idempotencyKey: "transaction-plugin",
            artifactFingerprint: "fingerprint",
            files: [],
            packageFollowup: {},
            checks: { trufflehog: { status: "clean" }, clawscan: { status: "clean" } },
            finalizationClaimId: "finalizer",
            finalizationClaimExpiresAt: Date.now() + 60_000,
            createdAt: 1,
            updatedAt: 1,
            expiresAt: Date.now() + 60_000,
          });
          return { attemptId, result: { ok: true, packageId, releaseId } };
        });
        const finalizationArgs = { ...fixture, claimId: "finalizer" };
        if (failure === "legacy owner") {
          await t.run(async (ctx) => {
            const attempt = await ctx.db.get(fixture.attemptId);
            const actorId = await ctx.db.insert("users", {});
            await ctx.db.patch(fixture.attemptId, {
              userId: actorId,
              ownerUserId: undefined,
              packageId: undefined,
              packageReleaseId: undefined,
              packageInsertArgs: { ownerUserId: attempt!.ownerUserId },
            });
          });
        }
        if (failure === "security enqueue" || failure === "receipt") {
          const { recordPackagePublishAttemptFinalizedInternal } =
            await import("./publishAttempts");
          await expect(
            t.run(async (ctx) => {
              const wrapped = {
                ...ctx,
                runMutation: async (...args: Parameters<typeof ctx.runMutation>) => {
                  const result = await ctx.runMutation(args[0], args[1]);
                  if (failure === "security enqueue") throw new Error("injected package failure");
                  return result;
                },
                db: {
                  ...ctx.db,
                  patch: async (...args: Parameters<typeof ctx.db.patch>) => {
                    await ctx.db.patch(...args);
                    if (failure === "receipt" && args[0] === fixture.attemptId)
                      throw new Error("injected package failure");
                  },
                },
              };
              return await (
                recordPackagePublishAttemptFinalizedInternal as unknown as {
                  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
                }
              )._handler(wrapped, finalizationArgs);
            }),
          ).rejects.toThrow("injected package failure");
          const rolledBack = await t.run(async (ctx) => ({
            jobs: await ctx.db.system.query("_scheduled_functions").collect(),
            scans: await ctx.db.query("securityScanJobs").collect(),
            attempt: await ctx.db.get(fixture.attemptId),
          }));
          expect(rolledBack.jobs).toEqual([]);
          expect(rolledBack.scans).toEqual([]);
          expect(rolledBack.attempt?.status).toBe("finalizing");
        }
        await Promise.all([
          t.mutation(
            internal.publishAttempts.recordPackagePublishAttemptFinalizedInternal,
            finalizationArgs,
          ),
          t.mutation(
            internal.publishAttempts.recordPackagePublishAttemptFinalizedInternal,
            finalizationArgs,
          ),
        ]);
        const state = await t.run(async (ctx) => ({
          jobs: await ctx.db.system.query("_scheduled_functions").collect(),
          scans: await ctx.db.query("securityScanJobs").collect(),
          attempt: await ctx.db.get(fixture.attemptId),
          release: await ctx.db.get(fixture.result.releaseId),
          pkg: await ctx.db.get(fixture.result.packageId),
        }));
        expect(state.attempt).toMatchObject({ status: "finalized", result: fixture.result });
        expect(state.jobs).toMatchObject([
          {
            name: "vt:scanPackageReleaseWithVirusTotal",
            args: [{ releaseId: fixture.result.releaseId }],
            scheduledTime: Date.now() + 30_000,
          },
        ]);
        expect(state.scans).toHaveLength(1);
        expect(state.scans[0]).toMatchObject({
          targetKind: "packageRelease",
          packageReleaseId: fixture.result.releaseId,
          source: "publish",
          status: "queued",
          attempts: 0,
        });
        expect(state.release).toMatchObject({
          integritySha256: "fingerprint",
          files: [],
          publicationStatus: "published",
          changelog: "original",
        });
        expect(state.pkg).toMatchObject({
          latestReleaseId: fixture.result.releaseId,
          tags: { latest: fixture.result.releaseId },
        });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each([
    { checkStatus: "pending", status: "pending_checks" },
    { checkStatus: "clean", status: "ready_to_finalize" },
  ] as const)(
    "returns null without mutating a targeted $status foreign lease",
    async ({ checkStatus, status }) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "runtime-worker-token");
      const t = convexTest(schema, modules);
      const checkClaimExpiresAt = Date.now() + 60_000;
      const attemptId = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {});
        return await ctx.db.insert("publishAttempts", {
          kind: "skill",
          status,
          userId,
          slug: "active-foreign-lease",
          displayName: "Active Foreign Lease",
          version: "1.0.0",
          idempotencyKey: `runtime-${status}`,
          artifactFingerprint: "fingerprint",
          files: [],
          checks: {
            trufflehog: { status: checkStatus },
            clawscan: { status: checkStatus },
          },
          checkClaimId: "foreign-claim",
          checkClaimedAt: 1,
          checkClaimExpiresAt,
          createdAt: 1,
          updatedAt: 1,
          expiresAt: checkClaimExpiresAt + 60_000,
        });
      });
      const before = await t.run(async (ctx) => await ctx.db.get(attemptId));

      await expect(
        t.action(api.publishAttempts.claimPrePublicationChecks, {
          token: "runtime-worker-token",
          attemptId,
          preferRetry: true,
        }),
      ).resolves.toBeNull();

      const after = await t.run(async (ctx) => await ctx.db.get(attemptId));
      expect(after).toEqual(before);
      expect(after).toMatchObject({
        checkClaimId: "foreign-claim",
        checkClaimExpiresAt,
      });
    },
  );

  it("reserves retry-first claims for expired attempts under sustained fresh traffic", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const retryAttemptId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {});
      const insertAttempt = async (
        idempotencyKey: string,
        createdAt: number,
        checkClaimExpiresAt?: number,
      ) =>
        await ctx.db.insert("publishAttempts", {
          kind: "skill",
          status: "pending_checks",
          userId,
          slug: idempotencyKey,
          displayName: idempotencyKey,
          version: "1.0.0",
          idempotencyKey,
          artifactFingerprint: idempotencyKey,
          files: [],
          checks: {
            trufflehog: { status: "pending" },
            clawscan: { status: "pending" },
          },
          checkClaimExpiresAt,
          createdAt,
          updatedAt: createdAt,
          expiresAt: now + 60_000,
        });

      const retryId = await insertAttempt("expired-retry", now - 60_000, now - 1);
      for (let index = 0; index < 30; index += 1) {
        await insertAttempt(`fresh-${index}`, now + index);
      }
      return retryId;
    });

    const claimed = await t.mutation(
      internal.publishAttempts.claimPendingPublishAttemptChecksInternal,
      {
        claimId: "retry-reserved-claim",
        retryOnly: true,
      } as never,
    );

    expect(claimed).toMatchObject({ attemptId: retryAttemptId });
  });

  it("terminalizes a pending attempt after its staged version is deleted", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {});
      const skillId = await ctx.db.insert("skills", {
        slug: "orphan-runtime",
        displayName: "Orphan Runtime",
        ownerUserId: userId,
        forkOf: undefined,
        tags: {},
        stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
        createdAt: 1,
        updatedAt: 1,
      });
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.0.0",
        publicationStatus: "pending",
        changelog: "",
        files: [],
        parsed: { frontmatter: {} },
        createdBy: userId,
        createdAt: 1,
      });
      const attemptId = await ctx.db.insert("publishAttempts", {
        kind: "skill",
        status: "pending_checks",
        userId,
        skillId,
        skillVersionId: versionId,
        slug: "orphan-runtime",
        displayName: "Orphan Runtime",
        version: "1.0.0",
        idempotencyKey: "runtime-orphan",
        artifactFingerprint: "fingerprint",
        files: [],
        checks: {
          trufflehog: { status: "pending" },
          clawscan: { status: "pending" },
        },
        createdAt: 1,
        updatedAt: 1,
        expiresAt: Date.now() + 60_000,
      });
      await ctx.db.delete(versionId);
      return { attemptId };
    });

    await expect(
      t.mutation(internal.publishAttempts.claimPendingPublishAttemptChecksInternal, {
        attemptId: ids.attemptId,
        claimId: "runtime-claim",
      }),
    ).resolves.toBeNull();

    const attempt = await t.run(async (ctx) => ctx.db.get(ids.attemptId));
    expect(attempt).toMatchObject({
      status: "failed",
      checkClaimLastError: "Pending skill version not found.",
      failedAt: expect.any(Number),
    });
  });

  it("terminalizes a ready attempt after its staged release is soft-deleted", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {});
      const packageId = await ctx.db.insert("packages", {
        name: "@demo/orphan-runtime",
        normalizedName: "@demo/orphan-runtime",
        displayName: "Orphan Runtime",
        ownerUserId: userId,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        tags: {},
        compatibility: {},
        verification: { tier: "structural", scope: "artifact-only", scanStatus: "pending" },
        scanStatus: "pending",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
        createdAt: 1,
        updatedAt: 1,
      });
      const releaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version: "1.0.0",
        publicationStatus: "pending",
        changelog: "",
        distTags: [],
        files: [],
        integritySha256: "fingerprint",
        compatibility: {},
        verification: { tier: "structural", scope: "artifact-only", scanStatus: "pending" },
        createdBy: userId,
        publishActor: { kind: "user", userId },
        createdAt: 1,
        softDeletedAt: 2,
      });
      const attemptId = await ctx.db.insert("publishAttempts", {
        kind: "package",
        status: "ready_to_finalize",
        userId,
        packageId,
        packageReleaseId: releaseId,
        slug: "@demo/orphan-runtime",
        displayName: "Orphan Runtime",
        version: "1.0.0",
        idempotencyKey: "runtime-orphan-package",
        artifactFingerprint: "fingerprint",
        files: [],
        checks: {
          trufflehog: { status: "clean" },
          clawscan: { status: "clean" },
        },
        createdAt: 1,
        updatedAt: 1,
        expiresAt: Date.now() + 60_000,
      });
      return { attemptId };
    });

    await expect(
      t.mutation(internal.publishAttempts.claimReadyPublishAttemptFinalizationRetryInternal, {
        attemptId: ids.attemptId,
        claimId: "runtime-finalize",
      }),
    ).resolves.toBeNull();

    const attempt = await t.run(async (ctx) => ctx.db.get(ids.attemptId));
    expect(attempt).toMatchObject({
      status: "failed",
      finalizationLastError: "Pending package release not found",
      failedAt: expect.any(Number),
    });
  });
});

describe("targeted prepublication worker redelivery", () => {
  it.each(["finalized", "finalizing", "blocked", "expired"] as const)(
    "drains an attempt already %s without changing its checks or claims",
    async (status) => {
      vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "redelivery-worker-fixture");
      const t = convexTest(schema, modules);
      const attemptId = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { handle: "redelivery-publisher" });
        return ctx.db.insert("publishAttempts", {
          kind: "skill",
          status,
          userId,
          slug: "redelivery-skill",
          displayName: "Redelivery skill",
          version: "1.0.0",
          idempotencyKey: "redelivery-fixture",
          artifactFingerprint: "immutable-redelivery-artifact",
          files: [],
          checks: { trufflehog: { status: "clean" }, clawscan: { status: "clean" } },
          finalizationClaimId: "existing-finalizer",
          finalizationClaimExpiresAt: Date.now() + 60_000,
          createdAt: 1,
          updatedAt: 1,
          expiresAt: Date.now() + 60_000,
        });
      });
      const before = await t.run((ctx) => ctx.db.get(attemptId));
      try {
        await expect(
          t.action(api.publishAttempts.claimPrePublicationChecks, {
            token: "redelivery-worker-fixture",
            attemptId,
            kind: "skill",
            slug: "redelivery-skill",
            version: "1.0.0",
          }),
        ).resolves.toBeNull();
        expect(await t.run((ctx) => ctx.db.get(attemptId))).toEqual(before);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
});
