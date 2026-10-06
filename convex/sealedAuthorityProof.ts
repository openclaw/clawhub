import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, mutation, query } from "./functions";

const inventoryDigest = "d".repeat(64);
const version = "0.0.0-proof";

const identityValidator = v.object({
  repository: v.string(),
  workflow: v.string(),
  runId: v.string(),
  runAttempt: v.string(),
  ref: v.string(),
  fullRef: v.string(),
  sha: v.string(),
  candidateRepository: v.string(),
  candidateSha: v.string(),
  toolingRef: v.string(),
  toolingFullRef: v.string(),
  toolingSha: v.string(),
  parentRepository: v.string(),
  parentWorkflow: v.string(),
  parentRunId: v.string(),
  parentRunAttempt: v.string(),
});

export const generateUploadUrl = mutation({
  args: {},
  handler: (ctx) => ctx.storage.generateUploadUrl(),
});

export const seed = mutation({
  args: {
    caseName: v.string(),
    packageName: v.string(),
    identity: identityValidator,
    artifactId: v.string(),
    artifactDigest: v.string(),
    fileStorageId: v.id("_storage"),
    archiveStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", { handle: `proof-owner-${args.caseName}` });
    const publisher = await ctx.db.insert("publishers", {
      kind: "org",
      handle: `proof-${args.caseName}`,
      displayName: `Proof ${args.caseName}`,
      createdAt: now,
      updatedAt: now,
    });
    const packageId = await ctx.db.insert("packages", {
      name: args.packageName,
      normalizedName: args.packageName,
      displayName: `Sealed proof ${args.caseName}`,
      ownerUserId: owner,
      ownerPublisherId: publisher,
      family: "code-plugin",
      channel: "official",
      isOfficial: true,
      tags: {},
      stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
      createdAt: now,
      updatedAt: now,
    });
    const trusted = {
      packageId,
      provider: "github-actions" as const,
      repository: "openclaw/openclaw",
      repositoryId: "1",
      repositoryOwner: "openclaw",
      repositoryOwnerId: "2",
      workflowFilename: "plugin-clawhub-release.yml",
    };
    const trustedPublisherId = await ctx.db.insert("packageTrustedPublishers", {
      ...trusted,
      createdByUserId: owner,
      updatedByUserId: owner,
      createdAt: now,
      updatedAt: now,
    });
    const transactionKey = [
      args.identity.parentRepository,
      args.identity.parentRunId,
      args.identity.parentRunAttempt,
      args.identity.runId,
      args.identity.runAttempt,
      args.identity.candidateSha,
      args.packageName,
      version,
      inventoryDigest,
    ].join(":");
    const tokenId = await ctx.db.insert("packagePublishTokens", {
      ...trusted,
      version,
      prefix: `proof-${args.caseName}`,
      tokenHash: `proof-${args.caseName}`,
      runId: args.identity.runId,
      runAttempt: args.identity.runAttempt,
      sha: args.identity.sha,
      ref: args.identity.fullRef,
      scope: "publish",
      inventoryDigest,
      authorizationVersion: 2,
      authorizationRoute: "automated-sealed",
      authorizationTransactionKey: transactionKey,
      authorizationKey: `${transactionKey}:publish`,
      authorizationArtifactId: args.artifactId,
      authorizationArtifactDigest: args.artifactDigest,
      trustedToolingIdentityJson: JSON.stringify(args.identity),
      candidateRepository: args.identity.candidateRepository,
      candidateSha: args.identity.candidateSha,
      parentRepository: args.identity.parentRepository,
      parentWorkflow: args.identity.parentWorkflow,
      parentRunId: args.identity.parentRunId,
      parentRunAttempt: args.identity.parentRunAttempt,
      consumedAt: now - 1000,
      expiresAt: now - 1,
      createdAt: now - 2000,
    });
    const authorization = {
      trustedPublishTokenId: tokenId,
      trustedPublishInventoryDigest: inventoryDigest,
      trustedPublishAuthorizationVersion: 2 as const,
    };
    const files = [
      {
        path: "index.js",
        size: 16,
        storageId: args.fileStorageId,
        sha256: "e".repeat(64),
      },
    ];
    const releaseId = await ctx.db.insert("packageReleases", {
      packageId,
      version,
      publicationStatus: "pending",
      pendingPublication: {
        ...authorization,
        ownerUserId: owner,
        ownerPublisherId: publisher,
        family: "code-plugin",
        tags: ["latest"],
      },
      clawpackStorageId: args.archiveStorageId,
      clawpackSha256: "f".repeat(64),
      clawpackSize: 21,
      artifactKind: "npm-pack",
      changelog: "Ephemeral authority proof",
      distTags: ["latest"],
      files,
      integritySha256: "c".repeat(64),
      createdBy: owner,
      createdAt: now - 1000,
      publishActor: {
        kind: "github-actions",
        repository: "openclaw/openclaw",
        workflow: "plugin-clawhub-release.yml",
        runId: args.identity.runId,
        runAttempt: args.identity.runAttempt,
        sha: args.identity.sha,
      },
    });
    const attemptId = await ctx.db.insert("publishAttempts", {
      kind: "package",
      status: "ready_to_finalize",
      userId: owner,
      ownerUserId: owner,
      ownerPublisherId: publisher,
      packageId,
      packageReleaseId: releaseId,
      slug: args.packageName,
      displayName: `Sealed proof ${args.caseName}`,
      version,
      idempotencyKey: `proof-${args.caseName}`,
      artifactFingerprint: "c".repeat(64),
      clawpackStorageId: args.archiveStorageId,
      files,
      checks: {
        trufflehog: { status: "clean", checkedAt: now },
        clawscan: { status: "clean", checkedAt: now },
      },
      packageFollowup: {
        ...authorization,
        packageName: args.packageName,
        version,
        githubActionsAudit: {
          actorUserId: owner,
          version,
          repository: "openclaw/openclaw",
          workflowFilename: "plugin-clawhub-release.yml",
          runId: args.identity.runId,
          runAttempt: args.identity.runAttempt,
          sha: args.identity.sha,
        },
      },
      createdAt: now - 1000,
      updatedAt: now,
      expiresAt: now + 3600000,
    });
    await ctx.db.patch(releaseId, { publishAttemptId: attemptId });
    return { attemptId, releaseId, tokenId, trustedPublisherId };
  },
});

export const revoke = mutation({
  args: { tokenId: v.id("packagePublishTokens") },
  handler: (ctx, args) => ctx.db.patch(args.tokenId, { revokedAt: Date.now() }),
});

export const reassign = mutation({
  args: { trustedPublisherId: v.id("packageTrustedPublishers") },
  handler: (ctx, args) =>
    ctx.db.patch(args.trustedPublisherId, { repository: "openclaw/reassigned" }),
});

export const finalize = action({
  args: { attemptId: v.id("publishAttempts") },
  handler: (ctx, args): Promise<unknown> =>
    ctx.runAction(internal.packages.finalizePackagePublishAttemptInternal, args),
});

export const status = query({
  args: {
    releaseId: v.id("packageReleases"),
    attemptId: v.id("publishAttempts"),
  },
  handler: async (ctx, args) => {
    const release = await ctx.db.get(args.releaseId);
    const attempt = await ctx.db.get(args.attemptId);
    return {
      publicationStatus: release?.publicationStatus,
      attemptStatus: attempt?.status,
    };
  },
});
