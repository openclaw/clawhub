/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture(kind: "skill" | "package" = "skill") {
  const t = convexTest(schema, modules);
  const bytes = new TextEncoder().encode("# Inert retained publication fixture\n");
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "retained-fixture" });
    const storageId = await ctx.storage.store(new Blob([bytes]));
    const files = [{ path: "SKILL.md", size: bytes.length, storageId, sha256 }];
    const base = {
      ownerUserId: userId,
      displayName: "Retained fixture",
      tags: {},
      createdAt: 1,
      updatedAt: 1,
    };
    const skillId =
      kind === "skill"
        ? await ctx.db.insert("skills", {
            ...base,
            slug: "retained-fixture",
            moderationStatus: "hidden",
            moderationReason: "pending.publication",
            stats: { downloads: 0, stars: 0, comments: 0, versions: 0 },
          })
        : undefined;
    const packageId =
      kind === "package"
        ? await ctx.db.insert("packages", {
            ...base,
            name: "retained-fixture",
            normalizedName: "retained-fixture",
            family: "code-plugin",
            channel: "community",
            isOfficial: false,
            compatibility: {},
            verification: { tier: "structural", scope: "artifact-only", scanStatus: "pending" },
            scanStatus: "pending",
            stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
          })
        : undefined;
    const skillVersionId = skillId
      ? await ctx.db.insert("skillVersions", {
          skillId,
          version: "1.0.0",
          publicationStatus: "pending",
          fingerprint: sha256,
          changelog: "",
          files,
          parsed: { frontmatter: {} },
          createdBy: userId,
          createdAt: 1,
        })
      : undefined;
    const packageReleaseId = packageId
      ? await ctx.db.insert("packageReleases", {
          packageId,
          version: "1.0.0",
          publicationStatus: "pending",
          integritySha256: sha256,
          changelog: "",
          distTags: [],
          files,
          compatibility: {},
          verification: { tier: "structural", scope: "artifact-only", scanStatus: "pending" },
          createdBy: userId,
          publishActor: { kind: "user", userId },
          createdAt: 1,
        })
      : undefined;
    const attemptId = await ctx.db.insert("publishAttempts", {
      kind,
      status: "failed",
      userId,
      ownerUserId: userId,
      skillId,
      skillVersionId,
      packageId,
      packageReleaseId,
      slug: "retained-fixture",
      displayName: "Retained fixture",
      version: "1.0.0",
      idempotencyKey: "retained-fixture",
      followup: kind === "skill" ? {} : undefined,
      packageFollowup: kind === "package" ? {} : undefined,
      artifactFingerprint: sha256,
      files,
      checks: {
        trufflehog: { status: "clean" },
        clawscan: { status: "failed", summary: "Operational scanner timeout" },
      },
      checkFailureCount: 3,
      checkClaimLastError: "Operational scanner timeout",
      failedAt: 2,
      createdAt: 1,
      updatedAt: 1,
      expiresAt: Date.now() + 86_400_000,
    });
    return { userId, storageId, skillId, skillVersionId, packageId, packageReleaseId, attemptId };
  });
  const args = {
    attemptId: ids.attemptId,
    expectedArtifactFingerprint: sha256,
    expectedUpdatedAt: 1,
    reason: "Retry retained bytes after verified scanner runtime repair",
  };
  return { t, ids, args };
}

describe("operator retry of retained publication checks", () => {
  it.each(["skill", "package"] as const)(
    "recovers a legacy %s after canonical personal-publisher migration",
    async (kind) => {
      const { t, ids, args } = await fixture(kind);
      const publisherId = await t.run(async (ctx) => {
        const personalId = await ctx.db.insert("publishers", {
          kind: "user",
          handle: "retained-fixture",
          displayName: "Retained fixture",
          linkedUserId: ids.userId,
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.patch(ids.userId, { personalPublisherId: personalId });
        await ctx.db.patch((ids.skillId ?? ids.packageId)!, { ownerPublisherId: personalId });
        await ctx.db.patch(ids.attemptId, { ownerUserId: undefined });
        if (ids.packageReleaseId)
          await ctx.db.patch(ids.packageReleaseId, { pendingPublication: {} });
        return personalId;
      });
      await expect(
        t.mutation(internal.maintenance.retryFailedPublishAttemptChecksInternal, {
          ...args,
          dryRun: false,
        }),
      ).resolves.toMatchObject({ eligible: true, requeued: true });
      await t.run((ctx) =>
        ctx.db.patch(ids.attemptId, {
          status: "finalizing",
          checks: { trufflehog: { status: "clean" }, clawscan: { status: "clean" } },
          finalizationClaimId: "migration",
          finalizationClaimExpiresAt: Date.now() + 60_000,
        }),
      );
      if (ids.packageReleaseId) {
        await t.mutation(internal.packages.publishPendingReleaseInternal, {
          releaseId: ids.packageReleaseId,
          publishAttemptId: ids.attemptId,
          finalizationClaimId: "migration",
        });
      } else {
        const version = await t.run((ctx) => ctx.db.get(ids.skillVersionId!));
        await t.mutation(internal.skills.publishPendingVersionInternal, {
          versionId: ids.skillVersionId!,
          publishAttemptId: ids.attemptId,
          finalizationClaimId: "migration",
          publishArgs: {
            userId: ids.userId,
            ownerPublisherId: publisherId,
            displayName: "Retained fixture",
            version: "1.0.0",
            changelog: "",
            files: version!.files,
            parsed: version!.parsed,
            embedding: Array(1536).fill(0),
            llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 2 },
            staticScan: {
              status: "clean",
              reasonCodes: [],
              findings: [],
              summary: "Fixture",
              engineVersion: "fixture",
              checkedAt: 1,
            },
          },
        });
      }
      const target = await t.run((ctx) =>
        ctx.db.get((ids.skillVersionId ?? ids.packageReleaseId)!),
      );
      expect(target).toMatchObject({ publicationStatus: "published" });
      expect(await t.run((ctx) => ctx.db.get(ids.attemptId))).toMatchObject({
        userId: ids.userId,
        checkFailureCount: 3,
        artifactFingerprint: args.expectedArtifactFingerprint,
      });
      expect((await t.run((ctx) => ctx.db.get(ids.attemptId)))!.ownerPublisherId).toBeUndefined();
    },
  );
  it.each([
    ["skill", "allowed"],
    ["package", "allowed"],
    ["package", "allowed-archive"],
    ["package", "removed-archive"],
    ["skill", "revoked-membership"],
    ["package", "revoked-membership"],
    ["skill", "security-redaction"],
    ["skill", "stale-claim"],
    ["package", "stale-claim"],
    ["skill", "expired-claim"],
    ["package", "expired-claim"],
    ["skill", "changed-owner"],
    ["package", "changed-owner"],
    ["skill", "changed-inventory"],
    ["package", "changed-inventory"],
    ["skill", "revoked-version"],
    ["skill", "malicious-verdict"],
    ["package", "revoked-version"],
  ] as const)("rechecks %s authority/holds after requeue: %s", async (kind, change) => {
    const { t, ids, args } = await fixture(kind);
    const org = await t.run(async (ctx) => {
      const ownerUserId = await ctx.db.insert("users", { handle: "org-owner" });
      const publisherId = await ctx.db.insert("publishers", {
        kind: "org",
        handle: "org",
        displayName: "Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const membershipId = await ctx.db.insert("publisherMembers", {
        publisherId,
        userId: ids.userId,
        role: "publisher",
        createdAt: 1,
        updatedAt: 1,
      });
      const targetId = ids.skillId ?? ids.packageId;
      await ctx.db.patch(targetId!, { ownerUserId, ownerPublisherId: publisherId });
      await ctx.db.patch(ids.attemptId, { ownerUserId, ownerPublisherId: publisherId });
      if (ids.packageReleaseId)
        await ctx.db.patch(ids.packageReleaseId, { pendingPublication: {} });
      return { publisherId, membershipId };
    });
    if (change === "allowed-archive" || change === "removed-archive")
      await t.run(async (ctx) => {
        const release = await ctx.db.get(ids.packageReleaseId!);
        await ctx.db.patch(ids.packageReleaseId!, {
          clawpackStorageId: ids.storageId,
          clawpackSha256: args.expectedArtifactFingerprint,
          clawpackSize: release!.files[0].size,
        });
        await ctx.db.patch(ids.attemptId, { clawpackStorageId: ids.storageId });
      });
    await expect(
      t.mutation(internal.maintenance.retryFailedPublishAttemptChecksInternal, {
        ...args,
        dryRun: false,
      }),
    ).resolves.toMatchObject({ eligible: true, requeued: true });
    // Scanner verdicts are injected here to isolate the real final publication
    // mutations. This is authorization regression proof, not scanner proof.
    await t.run((ctx) =>
      ctx.db.patch(ids.attemptId, {
        status: "finalizing",
        checks: { trufflehog: { status: "clean" }, clawscan: { status: "clean" } },
        finalizationClaimId: "current",
        finalizationClaimExpiresAt: Date.now() + 60_000,
      }),
    );
    if (change === "revoked-membership") await t.run((ctx) => ctx.db.delete(org.membershipId));
    if (change === "security-redaction")
      await t.mutation(internal.skills.hideSkillForSecurityRedactionInternal, {
        actorUserId: ids.userId,
        slug: "retained-fixture",
        reason: "Security hold after retry admission",
      });
    const targetId = ids.skillVersionId ?? ids.packageReleaseId;
    await t.run(async (ctx) => {
      if (change === "malicious-verdict")
        await ctx.db.patch(ids.skillVersionId!, {
          llmAnalysis: { status: "completed", verdict: "malicious", checkedAt: 1 },
        });
      if (change === "removed-archive")
        await ctx.db.patch(ids.packageReleaseId!, { clawpackStorageId: undefined });
      if (change === "expired-claim")
        await ctx.db.patch(ids.attemptId, { finalizationClaimExpiresAt: 1 });
      if (change === "changed-owner")
        await ctx.db.patch((ids.skillId ?? ids.packageId)!, { ownerUserId: ids.userId });
      if (change === "changed-inventory") await ctx.db.patch(targetId!, { files: [] });
      if (change === "revoked-version") {
        if (ids.skillVersionId)
          await ctx.db.patch(ids.skillVersionId, {
            manualRevocation: { reason: "Hold", reviewerUserId: ids.userId, revokedAt: 1 },
          });
        else
          await ctx.db.patch(ids.packageReleaseId!, {
            manualModeration: {
              state: "revoked",
              reason: "Hold",
              reviewerUserId: ids.userId,
              updatedAt: 1,
            },
          });
      }
    });
    const original = await t.run((ctx) => ctx.db.get(targetId!));
    const promote = async () => {
      if (ids.packageReleaseId)
        return t.mutation(internal.packages.publishPendingReleaseInternal, {
          releaseId: ids.packageReleaseId,
          publishAttemptId: ids.attemptId,
          finalizationClaimId: change === "stale-claim" ? "stale" : "current",
        });
      const version = await t.run((ctx) => ctx.db.get(ids.skillVersionId!));
      return t.mutation(internal.skills.publishPendingVersionInternal, {
        versionId: ids.skillVersionId!,
        publishAttemptId: ids.attemptId,
        finalizationClaimId: change === "stale-claim" ? "stale" : "current",
        publishArgs: {
          userId: ids.userId,
          ownerPublisherId: org.publisherId,
          displayName: "Retained fixture",
          version: "1.0.0",
          changelog: "",
          files: version!.files,
          parsed: version!.parsed,
          embedding: Array(1536).fill(0),
          llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 2 },
          staticScan: {
            status: "clean",
            reasonCodes: [],
            findings: [],
            summary: "Fixture",
            engineVersion: "fixture",
            checkedAt: 1,
          },
        },
      });
    };
    if (change === "allowed" || change === "allowed-archive") {
      await promote();
      expect(await t.run((ctx) => ctx.db.get(targetId!))).toMatchObject({
        publicationStatus: "published",
        files: original!.files,
      });
    } else {
      await expect(promote()).rejects.toThrow();
      expect(await t.run((ctx) => ctx.db.get(targetId!))).toEqual(original);
      if (change === "security-redaction")
        expect(await t.run((ctx) => ctx.db.get(ids.skillId!))).toMatchObject({
          moderationReason: "security.redaction",
          moderationStatus: "hidden",
        });
    }
  });
  it.each(["admission", "finalization"] as const)(
    "rejects a changed personal link at %s",
    async (stage) => {
      const { t, ids, args } = await fixture();
      const link = await t.run(async (ctx) => {
        const otherUserId = await ctx.db.insert("users", { handle: "other" });
        const publisherId = await ctx.db.insert("publishers", {
          kind: "user",
          handle: "retained-fixture",
          displayName: "Fixture",
          linkedUserId: ids.userId,
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.patch(ids.userId, { personalPublisherId: publisherId });
        await ctx.db.patch(ids.skillId!, { ownerPublisherId: publisherId });
        await ctx.db.patch(ids.attemptId, { ownerUserId: undefined });
        return { otherUserId, publisherId };
      });
      if (stage === "finalization") {
        await t.mutation(internal.maintenance.retryFailedPublishAttemptChecksInternal, {
          ...args,
          dryRun: false,
        });
        await t.run((ctx) =>
          ctx.db.patch(ids.attemptId, {
            status: "finalizing",
            checks: { trufflehog: { status: "clean" }, clawscan: { status: "clean" } },
            finalizationClaimId: "migration",
            finalizationClaimExpiresAt: Date.now() + 60_000,
          }),
        );
      }
      await t.run((ctx) => ctx.db.patch(link.publisherId, { linkedUserId: link.otherUserId }));
      if (stage === "admission") {
        await expect(
          t.mutation(internal.maintenance.retryFailedPublishAttemptChecksInternal, {
            ...args,
            dryRun: false,
          }),
        ).resolves.toMatchObject({ eligible: false, requeued: false });
      } else {
        const version = await t.run((ctx) => ctx.db.get(ids.skillVersionId!));
        await expect(
          t.mutation(internal.skills.publishPendingVersionInternal, {
            versionId: ids.skillVersionId!,
            publishAttemptId: ids.attemptId,
            finalizationClaimId: "migration",
            publishArgs: {
              userId: ids.userId,
              ownerPublisherId: link.publisherId,
              displayName: "Fixture",
              version: "1.0.0",
              changelog: "",
              files: version!.files,
              parsed: version!.parsed,
              embedding: Array(1536).fill(0),
              llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 2 },
              staticScan: {
                status: "clean",
                reasonCodes: [],
                findings: [],
                summary: "Fixture",
                engineVersion: "fixture",
                checkedAt: 1,
              },
            },
          }),
        ).rejects.toThrow();
      }
      expect(await t.run((ctx) => ctx.db.get(ids.skillVersionId!))).toMatchObject({
        publicationStatus: "pending",
      });
    },
  );

  it("refuses a completed analysis with a malicious verdict at admission", async () => {
    const { t, ids, args } = await fixture();
    await t.run((ctx) =>
      ctx.db.patch(ids.skillVersionId!, {
        llmAnalysis: { status: "completed", verdict: "malicious", checkedAt: 1 },
      }),
    );
    await expect(
      t.mutation(internal.maintenance.retryFailedPublishAttemptChecksInternal, {
        ...args,
        dryRun: false,
      }),
    ).resolves.toMatchObject({ eligible: false, requeued: false });
    expect(await t.run((ctx) => ctx.db.get(ids.attemptId))).toMatchObject({ status: "failed" });
    expect(await t.run((ctx) => ctx.db.query("auditLogs").take(1))).toEqual([]);
  });

  it.each([false, true])(
    "rechecks an organization publishing member (revoked=%s)",
    async (revoked) => {
      const { t, ids, args } = await fixture();
      await t.run(async (ctx) => {
        const ownerUserId = await ctx.db.insert("users", { handle: "organization-owner" });
        const publisherId = await ctx.db.insert("publishers", {
          kind: "org",
          handle: "organization",
          displayName: "Organization",
          createdAt: 1,
          updatedAt: 1,
        });
        if (!revoked)
          await ctx.db.insert("publisherMembers", {
            publisherId,
            userId: ids.userId,
            role: "publisher",
            createdAt: 1,
            updatedAt: 1,
          });
        await ctx.db.patch(ids.skillId!, { ownerUserId, ownerPublisherId: publisherId });
        // This matches createSkillPublishAttemptInternal: actor and publisher scope,
        // with no ownerUserId snapshot on legacy skill attempts.
        await ctx.db.patch(ids.attemptId, {
          ownerUserId: undefined,
          ownerPublisherId: publisherId,
        });
      });
      await expect(
        t.mutation(internal.maintenance.retryFailedPublishAttemptChecksInternal, {
          ...args,
          dryRun: false,
        }),
      ).resolves.toMatchObject({ eligible: !revoked, requeued: !revoked });
      expect(await t.run((ctx) => ctx.db.get(ids.attemptId))).toMatchObject({
        status: revoked ? "failed" : "pending_checks",
        checkFailureCount: 3,
      });
      expect(await t.run((ctx) => ctx.db.query("auditLogs").take(2))).toHaveLength(revoked ? 0 : 1);
    },
  );

  it.each([
    {
      kind: "skill",
      error: "A.I.G evidence is required before a skill can be published.",
      eligible: true,
    },
    {
      kind: "package",
      error: "A.I.G evidence is required before a skill can be published.",
      eligible: false,
    },
    { kind: "skill", error: "Unrelated finalization failure", eligible: false },
  ] as const)(
    "limits clean-check retries to missing skill A.I.G evidence: $kind / $error",
    async ({ kind, error, eligible }) => {
      const { t, ids, args } = await fixture(kind);
      const checks = {
        trufflehog: { status: "clean" as const },
        clawscan: { status: "clean" as const },
      };
      await t.run((ctx) => ctx.db.patch(ids.attemptId, { checks, checkClaimLastError: error }));
      await expect(
        t.mutation(internal.maintenance.retryFailedPublishAttemptChecksInternal, {
          ...args,
          dryRun: false,
        }),
      ).resolves.toMatchObject({ eligible, requeued: eligible });
      expect(await t.run((ctx) => ctx.db.get(ids.attemptId))).toMatchObject({
        status: eligible ? "pending_checks" : "failed",
        checks,
        checkFailureCount: 3,
        checkClaimLastError: error,
      });
      const audits = await t.run((ctx) => ctx.db.query("auditLogs").take(2));
      expect(audits).toHaveLength(eligible ? 1 : 0);
    },
  );

  it("does not reclaim a legacy staged target owned by another live attempt", async () => {
    const { t, ids, args } = await fixture();
    await t.run(async (ctx) => {
      const attempt = await ctx.db.get(ids.attemptId);
      if (!attempt) throw new Error("Missing fixture");
      const { _id, _creationTime, ...fields } = attempt;
      await ctx.db.insert("publishAttempts", {
        ...fields,
        idempotencyKey: "another-owner",
        status: "pending_checks",
      });
    });
    await expect(
      t.mutation(internal.maintenance.retryFailedPublishAttemptChecksInternal, {
        ...args,
        dryRun: false,
      }),
    ).resolves.toMatchObject({ eligible: false, reason: "another-attempt-owns-artifact" });
    expect(await t.run((ctx) => ctx.db.query("auditLogs").take(1))).toEqual([]);
  });

  it("does not invent a missing failure count", async () => {
    const { t, ids, args } = await fixture();
    await t.run((ctx) => ctx.db.patch(ids.attemptId, { checkFailureCount: undefined }));
    await expect(
      t.mutation(internal.maintenance.retryFailedPublishAttemptChecksInternal, {
        ...args,
        dryRun: false,
      }),
    ).resolves.toMatchObject({ eligible: false, reason: "failure-history-unavailable" });
  });

  it("verifies the original package archive binding", async () => {
    const { t, ids, args } = await fixture("package");
    await t.run(async (ctx) => {
      const release = await ctx.db.get(ids.packageReleaseId!);
      await ctx.db.patch(ids.packageReleaseId!, {
        clawpackStorageId: ids.storageId,
        clawpackSha256: args.expectedArtifactFingerprint,
        clawpackSize: release!.files[0].size,
      });
    });
    await expect(
      t.mutation(internal.maintenance.retryFailedPublishAttemptChecksInternal, args),
    ).resolves.toMatchObject({ eligible: false, reason: "artifact-inventory-changed" });
    await t.run((ctx) => ctx.db.patch(ids.attemptId, { clawpackStorageId: ids.storageId }));
    await expect(
      t.mutation(internal.maintenance.retryFailedPublishAttemptChecksInternal, args),
    ).resolves.toMatchObject({ eligible: true, requeued: false });
  });

  it.each([
    "stale-state",
    "fingerprint",
    "blocked",
    "active-claim",
    "deleted-publisher",
    "changed-owner",
    "published-target",
    "revoked-target",
    "missing-storage",
    "changed-inventory",
  ] as const)("refuses %s without altering the attempt or writing an audit", async (change) => {
    const { t, ids, args } = await fixture();
    if (change === "stale-state") args.expectedUpdatedAt = 0;
    else if (change === "fingerprint") args.expectedArtifactFingerprint = "different";
    else
      await t.run(async (ctx) => {
        if (change === "blocked")
          await ctx.db.patch(ids.attemptId, {
            checks: { trufflehog: { status: "blocked" }, clawscan: { status: "failed" } },
          });
        if (change === "active-claim")
          await ctx.db.patch(ids.attemptId, {
            checkClaimId: "foreign",
            checkClaimExpiresAt: Date.now() + 60_000,
          });
        if (change === "deleted-publisher") await ctx.db.patch(ids.userId, { deletedAt: 1 });
        if (change === "changed-owner") {
          const other = await ctx.db.insert("users", {});
          await ctx.db.patch(ids.skillId!, { ownerUserId: other });
        }
        if (change === "published-target")
          await ctx.db.patch(ids.skillVersionId!, { publicationStatus: "published" });
        if (change === "revoked-target")
          await ctx.db.patch(ids.skillVersionId!, {
            manualRevocation: { reason: "fixture hold", reviewerUserId: ids.userId, revokedAt: 1 },
          });
        if (change === "missing-storage") await ctx.storage.delete(ids.storageId);
        if (change === "changed-inventory") await ctx.db.patch(ids.skillVersionId!, { files: [] });
      });
    const before = await t.run((ctx) => ctx.db.get(ids.attemptId));
    await expect(
      t.mutation(internal.maintenance.retryFailedPublishAttemptChecksInternal, {
        ...args,
        dryRun: false,
      }),
    ).resolves.toMatchObject({ eligible: false, requeued: false });
    expect(await t.run((ctx) => ctx.db.get(ids.attemptId))).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("auditLogs").take(1))).toEqual([]);
  });

  it.each(["skill", "package"] as const)(
    "dry-runs and audits one %s retry without publishing",
    async (kind) => {
      const { t, ids, args } = await fixture(kind);
      const before = await t.run((ctx) => ctx.db.get(ids.attemptId));
      const retry = internal.maintenance.retryFailedPublishAttemptChecksInternal;
      await expect(t.mutation(retry, args)).resolves.toMatchObject({
        eligible: true,
        requeued: false,
      });
      expect(await t.run((ctx) => ctx.db.get(ids.attemptId))).toEqual(before);
      expect(await t.run((ctx) => ctx.db.query("auditLogs").take(1))).toEqual([]);
      await expect(t.mutation(retry, { ...args, dryRun: false })).resolves.toMatchObject({
        eligible: true,
        requeued: true,
      });
      expect(await t.run((ctx) => ctx.db.get(ids.attemptId))).toMatchObject({
        status: "pending_checks",
        checks: before?.checks,
        checkFailureCount: 3,
        failedAt: 2,
        artifactFingerprint: args.expectedArtifactFingerprint,
      });
      const targetId = ids.skillVersionId ?? ids.packageReleaseId;
      expect(await t.run((ctx) => ctx.db.get(targetId!))).toMatchObject({
        publicationStatus: "pending",
      });
      const audit = await t.run((ctx) => ctx.db.query("auditLogs").take(2));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: "publish_attempt.operational_retry",
        targetId: ids.attemptId,
        metadata: { reason: args.reason, previousChecks: before?.checks, previousFailureCount: 3 },
      });
      await expect(t.mutation(retry, { ...args, dryRun: false })).resolves.toMatchObject({
        eligible: false,
        requeued: false,
      });
      expect(await t.run((ctx) => ctx.db.query("auditLogs").take(2))).toHaveLength(1);
    },
  );
});
