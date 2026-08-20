/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("publish attempt runtime recovery", () => {
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

  it("refuses CLEAN-but-ClawScan-pending repair, then publishes after both checks are clean (#3466)", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const embedding = Array.from({ length: 1536 }, () => 0);
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        handle: "clean-pending-owner",
      });
      const skillId = await ctx.db.insert("skills", {
        slug: "clean-but-pending",
        displayName: "Clean But Pending",
        ownerUserId: userId,
        tags: {},
        moderationStatus: "hidden",
        moderationReason: "pending.publication",
        moderationVerdict: "clean",
        stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
        createdAt: now,
        updatedAt: now,
      });
      const storageId = await ctx.storage.store(
        new Blob(["---\nname: clean-but-pending\n---\n# Clean But Pending\n"], {
          type: "text/markdown",
        }),
      );
      const files = [
        {
          path: "SKILL.md",
          size: 48,
          storageId,
          contentType: "text/markdown",
          sha256: "a".repeat(64),
        },
      ];
      const publishArgs = {
        userId,
        displayName: "Clean But Pending",
        version: "1.0.0",
        changelog: "initial",
        files,
        parsed: { frontmatter: { name: "clean-but-pending" } },
        summary: "Clean but pending fixture",
        staticScan: {
          status: "clean" as const,
          reasonCodes: [] as string[],
          findings: [] as Array<{
            code: string;
            severity: "info" | "warn" | "critical";
            file: string;
            line: number;
            message: string;
            evidence: string;
          }>,
          summary: "clean",
          engineVersion: "test",
          checkedAt: now,
        },
        embedding,
      };
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.0.0",
        publicationStatus: "pending",
        changelog: "initial",
        files,
        parsed: { frontmatter: { name: "clean-but-pending" } },
        pendingPublication: { skillInsertArgs: publishArgs },
        createdBy: userId,
        createdAt: now,
      });
      const attemptId = await ctx.db.insert("publishAttempts", {
        kind: "skill",
        status: "pending_checks",
        userId,
        skillId,
        skillVersionId: versionId,
        slug: "clean-but-pending",
        displayName: "Clean But Pending",
        version: "1.0.0",
        idempotencyKey: "clean-but-pending-1.0.0",
        artifactFingerprint: "fingerprint",
        files,
        checks: {
          trufflehog: { status: "clean" },
          clawscan: { status: "pending" },
        },
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60_000,
      });
      await ctx.db.patch(versionId, { publishAttemptId: attemptId });
      return { userId, skillId, versionId, attemptId, publishArgs };
    });

    await expect(
      t.query(internal.publishAttempts.findActiveSkillPublishAttemptByIdInternal, {
        attemptId: ids.attemptId,
        skillId: ids.skillId,
        versionId: ids.versionId,
        now,
      }),
    ).resolves.toEqual({
      attemptId: ids.attemptId,
      status: "pending_checks",
      repairBlockedReason: "checks-incomplete",
    });

    await expect(
      t.mutation(internal.skills.publishPendingVersionAndCloseAttemptInternal, {
        versionId: ids.versionId,
        publishArgs: ids.publishArgs,
        publishAttemptId: ids.attemptId,
        actorUserId: ids.userId,
      }),
    ).resolves.toMatchObject({
      result: null,
      blockedByAttempt: {
        reason: "checks-incomplete",
        status: "pending_checks",
      },
    });

    const blockedState = await t.run(async (ctx) => {
      const version = await ctx.db.get(ids.versionId);
      const skill = await ctx.db.get(ids.skillId);
      const audits = await ctx.db
        .query("auditLogs")
        .withIndex("by_target", (q) =>
          q.eq("targetType", "skillVersion").eq("targetId", ids.versionId),
        )
        .collect();
      return {
        publicationStatus: version?.publicationStatus,
        hasPendingPublication: version?.pendingPublication !== undefined,
        latestVersionId: skill?.latestVersionId,
        auditCount: audits.length,
      };
    });
    expect(blockedState).toEqual({
      publicationStatus: "pending",
      hasPendingPublication: true,
      latestVersionId: undefined,
      auditCount: 0,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(ids.attemptId, {
        status: "failed",
        checks: {
          trufflehog: { status: "clean" },
          clawscan: { status: "clean" },
        },
        finalizationFailureCount: 5,
        updatedAt: Date.now(),
      });
    });

    const repaired = await t.mutation(
      internal.skills.publishPendingVersionAndCloseAttemptInternal,
      {
        versionId: ids.versionId,
        publishArgs: ids.publishArgs,
        publishAttemptId: ids.attemptId,
        actorUserId: ids.userId,
      },
    );
    expect(repaired).toMatchObject({
      blockedByAttempt: null,
      result: {
        skillId: ids.skillId,
        versionId: ids.versionId,
        publicationStatus: "published",
      },
    });

    const after = await t.run(async (ctx) => {
      const version = await ctx.db.get(ids.versionId);
      const skill = await ctx.db.get(ids.skillId);
      const attempt = await ctx.db.get(ids.attemptId);
      const audits = await ctx.db
        .query("auditLogs")
        .withIndex("by_target", (q) =>
          q.eq("targetType", "skillVersion").eq("targetId", ids.versionId),
        )
        .collect();
      return {
        publicationStatus: version?.publicationStatus,
        hasPendingPublication: version?.pendingPublication !== undefined,
        latestVersionId: skill?.latestVersionId,
        tagsLatest: skill?.tags?.latest,
        versionCount: skill?.stats.versions,
        attemptStatus: attempt?.status,
        audit: audits[0] ?? null,
      };
    });

    expect(after.publicationStatus).toBe("published");
    expect(after.hasPendingPublication).toBe(false);
    expect(after.latestVersionId).toBe(ids.versionId);
    expect(after.tagsLatest).toBe(ids.versionId);
    expect(after.versionCount).toBe(1);
    expect(after.attemptStatus).toBe("finalized");
    expect(after.audit).toMatchObject({
      actorUserId: ids.userId,
      action: "skill.orphaned_pending_version.repair",
      targetType: "skillVersion",
      targetId: ids.versionId,
      metadata: expect.objectContaining({
        skillId: ids.skillId,
        priorPublicationStatus: "pending",
        priorAttemptStatus: "failed",
        hadPendingPublication: true,
        resultPublicationStatus: "published",
      }),
    });
  });
});
