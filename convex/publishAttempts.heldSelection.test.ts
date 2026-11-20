/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const cleanCheck = { status: "clean" as const, checkedAt: 1 };

// An older attempt whose parent is held by moderation must not monopolize
// untargeted selection: finalization throws for it and the retryable release
// makes it immediately claimable again, so oldest-first selection would return
// it forever and never reach the healthy attempt behind it.
async function stageHeldAheadOfHealthy(olderReason = "manual.review") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "publisher" });
    const bytes = new TextEncoder().encode("# Fixture\n");
    const storageId = await ctx.storage.store(new Blob([bytes]));
    const sha256 = "c".repeat(64);
    const files = [{ path: "SKILL.md", size: bytes.length, storageId, sha256 }];

    const stage = async (args: {
      slug: string;
      moderationStatus: "active" | "hidden";
      moderationReason?: string;
      createdAt: number;
    }) => {
      const skillId = await ctx.db.insert("skills", {
        slug: args.slug,
        displayName: "Fixture",
        summary: "Fixture",
        ownerUserId: userId,
        tags: {},
        moderationStatus: args.moderationStatus,
        moderationReason: args.moderationReason,
        stats: { downloads: 0, stars: 0, comments: 0, versions: 0 },
        createdAt: 1,
        updatedAt: 1,
      });
      const skillVersionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.0.0",
        publicationStatus: "pending",
        pendingPublication: {
          skillInsertArgs: {
            userId,
            displayName: "Fixture",
            version: "1.0.0",
            changelog: "Pending",
            files,
            parsed: { frontmatter: { description: "Fixture" } },
            embedding: [0],
            llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 1 },
          },
        },
        fingerprint: sha256,
        changelog: "Pending",
        files,
        parsed: { frontmatter: { description: "Fixture" } },
        createdBy: userId,
        createdAt: args.createdAt,
      });
      const attemptId = await ctx.db.insert("publishAttempts", {
        kind: "skill",
        status: "ready_to_finalize",
        userId,
        skillId,
        skillVersionId,
        slug: args.slug,
        displayName: "Fixture",
        version: "1.0.0",
        idempotencyKey: `${args.slug}-1.0.0`,
        followup: { skipWebhook: true },
        artifactFingerprint: sha256,
        files,
        checks: { trufflehog: cleanCheck, clawscan: cleanCheck },
        createdAt: args.createdAt,
        updatedAt: args.createdAt,
        expiresAt: 4_000_000_000_000,
      });
      return attemptId;
    };

    // Held parent, staged first so it sorts ahead on by_status_and_created.
    const heldAttemptId = await stage({
      slug: "held-skill",
      moderationStatus: "hidden",
      moderationReason: olderReason,
      createdAt: 1,
    });
    const healthyAttemptId = await stage({
      slug: "healthy-skill",
      moderationStatus: "active",
      createdAt: 2,
    });
    return { heldAttemptId, healthyAttemptId };
  });
  return { t, ids };
}

it("skips a moderation-held attempt and selects the newer healthy attempt", async () => {
  const { t, ids } = await stageHeldAheadOfHealthy();
  const claimed = await t.mutation(
    internal.publishAttempts.claimReadyPublishAttemptFinalizationRetryInternal,
    { claimId: "untargeted-claim" },
  );
  expect(claimed).toMatchObject({ attemptId: ids.healthyAttemptId, status: "ready_to_finalize" });
});

it.each(["scanner.llm.malicious", "quality.low", "user.moderation", "manual.version_revoked"])(
  "selects a clean corrected version when the parent hide is replaceable: %s",
  async (reason) => {
    const { t, ids } = await stageHeldAheadOfHealthy(reason);
    const claimed = await t.mutation(
      internal.publishAttempts.claimReadyPublishAttemptFinalizationRetryInternal,
      { claimId: "corrected-claim" },
    );
    expect(claimed).toMatchObject({ attemptId: ids.heldAttemptId });
  },
);

it.each(["manual.review", "quality.low"])(
  "worker publishes the eligible version with %s first in queue",
  async (reason) => {
    const { t, ids } = await stageHeldAheadOfHealthy(reason);
    const token = "test-only-worker";
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", token);
    try {
      const claim = (await t.action(api.publishAttempts.claimPrePublicationChecks, { token })) as {
        attemptId: Id<"publishAttempts">;
        claimId: string;
        artifactFingerprint: string;
      };
      expect(claim.attemptId).toBe(
        reason === "manual.review" ? ids.healthyAttemptId : ids.heldAttemptId,
      );
      const result = await t.action(api.publishAttempts.completePrePublicationChecks, {
        token,
        attemptId: claim.attemptId,
        claimId: claim.claimId,
        artifactFingerprint: claim.artifactFingerprint,
        trufflehog: { status: "clean" },
        clawscan: { status: "clean" },
      });
      expect(result).toMatchObject({ attemptId: claim.attemptId, status: "finalized" });
      const attempt = await t.run((ctx) => ctx.db.get(claim.attemptId));
      expect(await t.run((ctx) => ctx.db.get(attempt!.skillVersionId!))).toMatchObject({
        publicationStatus: "published",
      });
      if (reason === "manual.review")
        expect(await t.run((ctx) => ctx.db.get(ids.heldAttemptId))).toMatchObject({
          status: "ready_to_finalize",
        });
    } finally {
      vi.unstubAllEnvs();
    }
  },
);

it("leaves the held attempt ready_to_finalize so a lifted hold can still publish", async () => {
  const { t, ids } = await stageHeldAheadOfHealthy();
  await t.mutation(internal.publishAttempts.claimReadyPublishAttemptFinalizationRetryInternal, {
    claimId: "untargeted-claim",
  });
  const held = await t.run(async (ctx) => ctx.db.get(ids.heldAttemptId));
  expect(held).toMatchObject({ status: "ready_to_finalize" });
});

it("still selects the held attempt for explicit targeted recovery", async () => {
  const { t, ids } = await stageHeldAheadOfHealthy();
  const claimed = await t.mutation(
    internal.publishAttempts.claimReadyPublishAttemptFinalizationRetryInternal,
    { claimId: "targeted-claim", attemptId: ids.heldAttemptId },
  );
  expect(claimed).toMatchObject({ attemptId: ids.heldAttemptId });
});
