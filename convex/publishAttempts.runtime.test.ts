/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publish attempt runtime recovery", () => {
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
