/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("publish attempt orphan recovery", () => {
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
