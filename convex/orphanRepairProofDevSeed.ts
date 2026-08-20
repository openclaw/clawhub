import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { assertLocalDevSeedAllowed } from "./lib/devSeed";
import { ensurePersonalPublisherForUser } from "./lib/publishers";
import { publishVersionForUser, stageSkillPublishAttemptForUser } from "./lib/skillPublish";
import { generateToken, hashToken } from "./lib/tokens";

// DEV-ONLY proof harness for the #3349 orphaned-pending-version repair, used to
// reproduce the stuck state on a real (non-production) Convex deployment and
// capture before/after evidence through the real public HTTP surface.
//
// Every entry point is gated by assertLocalDevSeedAllowed, so these functions
// refuse to run against a production deployment. Nothing here fabricates the
// broken state directly: the fixture publishes through the real staged publish
// path, and the orphan is produced by letting the real finalization worker
// contract fail until MAX_CONSECUTIVE_FINALIZATION_FAILURES terminalizes the
// attempt.

const SEED_NAME = "Orphan repair proof";
const PROOF_HANDLE = "orphan-repair-proof";
const PROOF_SLUG = "orphan-repair-proof";
const PROOF_TOKEN_LABEL = "orphan repair proof (#3401)";
const BASE_VERSION = "1.0.0";
const STRANDED_VERSION = "1.0.1";

function skillMd(version: string) {
  return `---
name: ${PROOF_SLUG}
description: Fixture skill used to prove the #3349 orphaned pending version repair.
---

# Orphan Repair Proof ${version}

This version exists to reproduce a staged skill publish whose finalization
never completed, then to prove that the repair projects it publicly.
`;
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const resetProofFixtureMutation = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertLocalDevSeedAllowed(SEED_NAME);
    const user = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", PROOF_HANDLE))
      .unique();
    if (!user) return { existed: false };

    const skills = await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
      .collect();
    for (const skill of skills) {
      const versions = await ctx.db
        .query("skillVersions")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .collect();
      for (const version of versions) {
        const embeddings = await ctx.db
          .query("skillEmbeddings")
          .withIndex("by_version", (q) => q.eq("versionId", version._id))
          .collect();
        for (const embedding of embeddings) await ctx.db.delete(embedding._id);
        await ctx.db.delete(version._id);
      }
      const digests = await ctx.db
        .query("skillSearchDigest")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .collect();
      for (const digest of digests) await ctx.db.delete(digest._id);
      await ctx.db.delete(skill._id);
    }

    const attempts = await ctx.db
      .query("publishAttempts")
      .withIndex("by_user_status_created", (q) => q.eq("userId", user._id))
      .collect();
    for (const attempt of attempts) await ctx.db.delete(attempt._id);

    const tokens = await ctx.db
      .query("apiTokens")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const token of tokens) await ctx.db.delete(token._id);

    return { existed: true, skills: skills.length, attempts: attempts.length };
  },
});

export const ensureProofUserMutation = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertLocalDevSeedAllowed(SEED_NAME);
    const now = Date.now();
    const existing = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", PROOF_HANDLE))
      .unique();
    const userId =
      existing?._id ??
      (await ctx.db.insert("users", {
        handle: PROOF_HANDLE,
        name: "Orphan Repair Proof",
        // Backdated so the GitHub-account-age upload gate does not reject the
        // fixture publish for reasons unrelated to what is being proven.
        githubCreatedAt: now - 5 * 365 * 24 * 60 * 60 * 1000,
        createdAt: now,
      }));
    await ctx.db.patch(userId, { deactivatedAt: undefined, deletedAt: undefined });

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Proof user missing after insert");
    const publisher = await ensurePersonalPublisherForUser(ctx, user, {
      source: "orphanRepairProof",
    });

    const { token, prefix } = generateToken();
    await ctx.db.insert("apiTokens", {
      userId,
      label: PROOF_TOKEN_LABEL,
      prefix,
      tokenHash: await hashToken(token),
      createdAt: now,
    });

    return { userId, publisherId: publisher?._id ?? null, handle: PROOF_HANDLE, token };
  },
});

// `preStored` exists for the harness self-test: convex-test cannot store a blob
// from an action, so the test stores SKILL.md up front and passes the storage id
// in. A real proof run omits it and stores the file here.
const preStoredFileValidator = v.object({
  storageId: v.id("_storage"),
  size: v.number(),
  sha256: v.string(),
});

async function storeProofFile(
  ctx: ActionCtx,
  version: string,
  preStored?: { storageId: Id<"_storage">; size: number; sha256: string },
) {
  if (preStored) {
    return { path: "SKILL.md", ...preStored, contentType: "text/markdown" };
  }
  const body = skillMd(version);
  const storageId = await ctx.storage.store(new Blob([body], { type: "text/markdown" }));
  return {
    path: "SKILL.md",
    size: body.length,
    storageId,
    sha256: await sha256Hex(body),
    contentType: "text/markdown",
  };
}

export function proofSkillMarkdown(version: string) {
  return skillMd(version);
}

// Publishes 1.0.0 normally, then stages 1.0.1 through the same staged publish
// path the HTTP publish endpoint uses, leaving a real pending version plus a
// real publishAttempts row awaiting pre-publication checks.
export const seedProofFixture = internalAction({
  args: {
    reset: v.optional(v.boolean()),
    preStoredBaseFile: v.optional(preStoredFileValidator),
    preStoredStrandedFile: v.optional(preStoredFileValidator),
  },
  handler: async (
    ctx: ActionCtx,
    args,
  ): Promise<{
    handle: string;
    slug: string;
    token: string;
    userId: Id<"users">;
    baseVersion: string;
    strandedVersion: string;
    strandedVersionId: Id<"skillVersions">;
    attemptId: Id<"publishAttempts"> | null;
  }> => {
    assertLocalDevSeedAllowed(SEED_NAME);
    if (args.reset !== false) {
      await ctx.runMutation(internal.orphanRepairProofDevSeed.resetProofFixtureMutation, {});
    }
    const owner = await ctx.runMutation(
      internal.orphanRepairProofDevSeed.ensureProofUserMutation,
      {},
    );

    const baseFile = await storeProofFile(ctx, BASE_VERSION, args.preStoredBaseFile);
    await publishVersionForUser(
      ctx,
      owner.userId,
      {
        slug: PROOF_SLUG,
        displayName: "Orphan Repair Proof",
        version: BASE_VERSION,
        changelog: "Initial release",
        files: [baseFile],
      },
      {
        bypassGitHubAccountAge: true,
        bypassNewSkillRateLimit: true,
        bypassQualityGate: true,
        skipWebhook: true,
        stagePrePublicationChecks: false,
      },
    );

    const strandedFile = await storeProofFile(ctx, STRANDED_VERSION, args.preStoredStrandedFile);
    const staged = await stageSkillPublishAttemptForUser(
      ctx,
      owner.userId,
      {
        slug: PROOF_SLUG,
        displayName: "Orphan Repair Proof",
        version: STRANDED_VERSION,
        changelog: "Patch release that never finished finalizing",
        files: [strandedFile],
      },
      {
        bypassGitHubAccountAge: true,
        bypassNewSkillRateLimit: true,
        bypassQualityGate: true,
        skipWebhook: true,
      },
    );
    // Staged publishes record the attempt id on the version once checks complete.
    // The #3466 / security-gate fixtures intentionally stop before that, so bind
    // the exact attempt id here so repair inspection uses the direct-ID path
    // instead of the multi-status paginated slug fallback.
    if (staged.attemptId) {
      await ctx.runMutation(internal.orphanRepairProofDevSeed.linkProofAttemptToVersionMutation, {
        versionId: staged.versionId,
        attemptId: staged.attemptId,
      });
    }

    return {
      handle: owner.handle,
      slug: PROOF_SLUG,
      token: owner.token,
      userId: owner.userId,
      baseVersion: BASE_VERSION,
      strandedVersion: STRANDED_VERSION,
      strandedVersionId: staged.versionId,
      attemptId: staged.attemptId ?? null,
    };
  },
});

// Reports clean pre-publication checks through the same claim/complete
// mutations the real scanner worker calls, so the attempt reaches
// ready_to_finalize (and records publishAttemptId on the version) exactly as it
// would in production.
export const completeProofChecks = internalAction({
  args: { attemptId: v.id("publishAttempts") },
  handler: async (ctx: ActionCtx, args): Promise<{ status: string }> => {
    assertLocalDevSeedAllowed(SEED_NAME);
    const claimId = "orphan-repair-proof:checks";
    const claim = await ctx.runMutation(
      internal.publishAttempts.claimPendingPublishAttemptChecksInternal,
      { claimId, attemptId: args.attemptId, kind: "skill" },
    );
    if (!claim) throw new Error("Proof attempt could not be claimed for checks");
    const checkedAt = Date.now();
    const completed = await ctx.runMutation(
      internal.publishAttempts.completePendingPublishAttemptChecksInternal,
      {
        attemptId: args.attemptId,
        claimId,
        artifactFingerprint: claim.artifactFingerprint,
        trufflehog: { status: "clean", summary: "no secrets detected (proof fixture)" },
        clawscan: { status: "clean", summary: "no findings (proof fixture)" },
        clawscanAnalysis: {
          status: "clean",
          verdict: "clean",
          confidence: "high",
          summary: "Proof fixture analysis.",
          model: "proof-fixture",
          checkedAt,
        },
      },
    );
    return { status: completed.status };
  },
});

// Deactivating the owner makes the real finalization mutation throw ("User not
// found") without tripping the terminal-conflict classifier, so the real
// claim/release contract records genuine consecutive transient failures. This
// is the observed real-world shape of #3349: a finalizer that keeps failing
// until the cap terminalizes the attempt and strands the pending version.
export const setProofOwnerAvailabilityMutation = internalMutation({
  args: { deactivated: v.boolean() },
  handler: async (ctx, args) => {
    assertLocalDevSeedAllowed(SEED_NAME);
    const user = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", PROOF_HANDLE))
      .unique();
    if (!user) throw new Error("Proof user not found");
    await ctx.db.patch(user._id, {
      deactivatedAt: args.deactivated ? Date.now() : undefined,
    });
    return { userId: user._id, deactivated: args.deactivated };
  },
});

export const driveProofFinalizationToCap = internalAction({
  args: { versionId: v.id("skillVersions"), maxAttempts: v.optional(v.number()) },
  handler: async (
    ctx: ActionCtx,
    args,
  ): Promise<{ attempts: Array<{ claim: string; release: string }> }> => {
    assertLocalDevSeedAllowed(SEED_NAME);
    const maxAttempts = Math.min(Math.max(args.maxAttempts ?? 5, 1), 10);
    const attempts: Array<{ claim: string; release: string }> = [];
    const state = await ctx.runQuery(internal.orphanRepairProofDevSeed.inspectProofState, {});
    const attemptId = state.attempt?.attemptId;
    if (!attemptId) throw new Error("Proof attempt not found");

    for (let index = 1; index <= maxAttempts; index += 1) {
      const claimId = `orphan-repair-proof:${index}`;
      const claim = await ctx.runMutation(
        internal.publishAttempts.claimSkillPublishAttemptForFinalizationInternal,
        { attemptId, claimId },
      );
      if (claim.status !== "claimed") {
        attempts.push({ claim: claim.status, release: "skipped" });
        break;
      }
      // Runs the real finalize path so the failure and its recorded error come
      // from production code, not from a hand-written error string.
      let error = "finalization succeeded unexpectedly";
      try {
        await ctx.runMutation(internal.skills.publishPendingVersionInternal, {
          versionId: args.versionId,
          publishArgs: claim.skillInsertArgs,
        });
      } catch (thrown) {
        error = thrown instanceof Error ? thrown.message : String(thrown);
      }
      const release = await ctx.runMutation(
        internal.publishAttempts.releaseSkillPublishAttemptFinalizationClaimInternal,
        { attemptId, claimId, error },
      );
      attempts.push({ claim: claim.status, release: release.status });
      if (release.status === "failed") break;
    }
    return { attempts };
  },
});

// Machine-readable snapshot of exactly the fields the #3401 review asked about:
// version publication status, whether the staged snapshot is still present, the
// attempt's terminal state, and the skill's public projection.
export const inspectProofState = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertLocalDevSeedAllowed(SEED_NAME);
    const capturedAt = Date.now();
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", PROOF_SLUG))
      .filter((q) => q.eq(q.field("softDeletedAt"), undefined))
      .first();
    if (!skill) return { capturedAt, skill: null, version: null, attempt: null };

    const versions = await ctx.db
      .query("skillVersions")
      .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
      .collect();
    const version = versions.find((row) => row.version === STRANDED_VERSION) ?? null;
    const attempt: Doc<"publishAttempts"> | null = version?.publishAttemptId
      ? await ctx.db.get(version.publishAttemptId)
      : null;

    return {
      capturedAt,
      skill: {
        skillId: skill._id,
        slug: skill.slug,
        latestVersionId: skill.latestVersionId ?? null,
        latestVersion: skill.latestVersionSummary?.version ?? null,
        latestTagVersionId: skill.tags.latest ?? null,
        versionsStat: skill.stats.versions,
        moderationStatus: skill.moderationStatus,
      },
      version: version
        ? {
            versionId: version._id,
            version: version.version,
            publicationStatus: version.publicationStatus ?? "published",
            hasPendingPublicationSnapshot: version.pendingPublication !== undefined,
            publishAttemptId: version.publishAttemptId ?? null,
            createdAt: version.createdAt,
          }
        : null,
      attempt: attempt
        ? {
            attemptId: attempt._id,
            status: attempt.status,
            finalizationFailureCount: attempt.finalizationFailureCount ?? null,
            finalizationLastError: attempt.finalizationLastError ?? null,
            hasResult: attempt.result !== undefined,
            resultVersionId:
              (attempt.result as { versionId?: Id<"skillVersions"> } | undefined)?.versionId ??
              null,
            finalizedAt: attempt.finalizedAt ?? null,
            failedAt: attempt.failedAt ?? null,
            checks: {
              trufflehog: attempt.checks.trufflehog.status,
              clawscan: attempt.checks.clawscan.status,
            },
            repairEligible:
              attempt.checks.trufflehog.status === "clean" &&
              attempt.checks.clawscan.status === "clean" &&
              (attempt.status === "finalized" ||
                attempt.status === "ready_to_finalize" ||
                attempt.status === "finalizing" ||
                (attempt.status === "failed" && (attempt.finalizationFailureCount ?? 0) > 0)),
          }
        : null,
      recoveryAudits: version
        ? (
            await ctx.db
              .query("auditLogs")
              .withIndex("by_target_action", (q) =>
                q
                  .eq("targetType", "skillVersion")
                  .eq("targetId", version._id)
                  .eq("action", "skill.orphaned_pending_version.repair"),
              )
              .collect()
          ).map((row) => ({
            actorUserId: row.actorUserId ?? null,
            createdAt: row.createdAt,
            metadata: row.metadata ?? null,
          }))
        : [],
      allVersions: versions
        .map((row) => ({
          version: row.version,
          publicationStatus: row.publicationStatus ?? "published",
        }))
        .sort((left, right) => left.version.localeCompare(right.version)),
    };
  },
});

// Bind the staged attempt onto the pending version before checks complete so
// owner diagnostics and repair inspection use the exact attempt row.
export const linkProofAttemptToVersionMutation = internalMutation({
  args: {
    versionId: v.id("skillVersions"),
    attemptId: v.id("publishAttempts"),
  },
  handler: async (ctx, args) => {
    assertLocalDevSeedAllowed(SEED_NAME);
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new Error("Proof version not found");
    await ctx.db.patch(args.versionId, { publishAttemptId: args.attemptId });
    return { versionId: args.versionId, publishAttemptId: args.attemptId };
  },
});

// Patrick #3401 P1 proof: a logically inconsistent finalized attempt that still
// lacks affirmative ClawScan evidence must not become repair-eligible.
export const forceFinalizedIncompleteChecksMutation = internalMutation({
  args: { attemptId: v.id("publishAttempts") },
  handler: async (ctx, args) => {
    assertLocalDevSeedAllowed(SEED_NAME);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("Proof attempt not found");
    if (attempt.skillVersionId) {
      await ctx.db.patch(attempt.skillVersionId, { publishAttemptId: args.attemptId });
    }
    await ctx.db.patch(args.attemptId, {
      status: "finalized",
      checks: {
        trufflehog: { status: "clean", summary: "proof" },
        clawscan: { status: "pending" },
      },
      finalizationFailureCount: undefined,
      result: undefined,
      finalizedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { attemptId: args.attemptId, status: "finalized", clawscan: "pending" };
  },
});

// Patrick #3401 P2 proof: failed attempt with incomplete checks must not claim
// orphan repair is available to the owner.
export const forceFailedIncompleteChecksMutation = internalMutation({
  args: { attemptId: v.id("publishAttempts") },
  handler: async (ctx, args) => {
    assertLocalDevSeedAllowed(SEED_NAME);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("Proof attempt not found");
    if (attempt.skillVersionId) {
      await ctx.db.patch(attempt.skillVersionId, { publishAttemptId: args.attemptId });
    }
    await ctx.db.patch(args.attemptId, {
      status: "failed",
      checks: {
        trufflehog: { status: "clean", summary: "proof" },
        clawscan: { status: "failed", summary: "proof scanner failed" },
      },
      finalizationFailureCount: 0,
      failedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { attemptId: args.attemptId, status: "failed", clawscan: "failed" };
  },
});

// Undo a forced terminal/incomplete proof state so the harness can resume the
// real check/finalization path.
export const restoreAttemptPendingChecksMutation = internalMutation({
  args: { attemptId: v.id("publishAttempts") },
  handler: async (ctx, args) => {
    assertLocalDevSeedAllowed(SEED_NAME);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("Proof attempt not found");
    await ctx.db.patch(args.attemptId, {
      status: "pending_checks",
      checks: {
        trufflehog: { status: "pending" },
        clawscan: { status: "pending" },
      },
      result: undefined,
      finalizedAt: undefined,
      failedAt: undefined,
      finalizationFailureCount: undefined,
      finalizationLastError: undefined,
      finalizationClaimId: undefined,
      finalizationClaimedAt: undefined,
      finalizationClaimExpiresAt: undefined,
      checkClaimId: undefined,
      checkClaimedAt: undefined,
      checkClaimExpiresAt: undefined,
      updatedAt: Date.now(),
    });
    return { attemptId: args.attemptId, status: "pending_checks" };
  },
});
