import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./functions";
import { requireUser } from "./lib/access";
import { getGitHubProviderAccountId } from "./lib/githubIdentity";
import { GITHUB_ORG_MEMBERSHIP_VERIFICATION_MAX_AGE_MS } from "./lib/githubOrgMemberships";
import { isPublisherActive, requirePublisherRole } from "./lib/publishers";
import {
  getSkillBySlugForPublisher,
  getSkillSlugAliasBySlugForPublisher,
} from "./lib/skills/slugResolution";
import {
  assertSkillsShFixtureEnvironmentAllowed,
  getSkillsShFixtureEnvironmentPolicy,
} from "./lib/skillsShCatalogEnvironment";
import { isExactSkillsShCatalogAttempt } from "./lib/skillsShCatalogPublication";
import { readCanonicalStat } from "./lib/skillStats";

type AdoptionCtx = Pick<QueryCtx | MutationCtx, "db">;

// The staging-live producer remains Local/Test-only: dispatchKind distinguishes
// real ClawHub execution from deterministic fixtures under this shared source.
const REAL_CATALOG_SCAN_SOURCE = "skills-sh-catalog-test" as const;

type OwnershipResult =
  | {
      kind: "personal" | "organization";
      verified: true;
      reason: null;
    }
  | {
      kind: "personal" | "organization";
      verified: false;
      reason:
        | "github_identity_missing"
        | "github_identity_mismatch"
        | "github_identity_pending"
        | "github_org_unverified"
        | "github_org_mismatch"
        | "github_org_membership_missing"
        | "github_org_admin_required"
        | "github_org_proof_stale";
    };

type DestinationResult =
  | {
      kind: "create";
      skillId: null;
      route: string;
      fingerprint: string;
      activeContentWillBeReplaced: false;
      preserved: null;
    }
  | {
      kind: "replace";
      skillId: Id<"skills">;
      route: string;
      fingerprint: string;
      activeContentWillBeReplaced: true;
      preserved: {
        identity: true;
        downloads: number;
        bookmarks: number;
        comments: number;
        official: boolean;
        versions: number;
        auditHistory: true;
      };
    }
  | {
      kind: "conflict";
      reason: "destination_alias_conflict";
      skillId: Id<"skills">;
      route: string;
      fingerprint: null;
      activeContentWillBeReplaced: false;
      preserved: null;
    };

function normalizeExternalId(value: string) {
  return value.trim().toLowerCase();
}

function buildIdempotencyKey(
  publisherId: Id<"publishers">,
  externalId: string,
  sourceContentHash: string,
) {
  return `skills-sh-adoption:v1:${publisherId}:${externalId}:${sourceContentHash}`;
}

function buildDestinationFingerprint(skill: Doc<"skills">, route: string) {
  return JSON.stringify([
    route,
    skill._id,
    skill.latestVersionId ?? null,
    skill.installKind ?? null,
    skill.githubSourceId ?? null,
    skill.githubPath ?? null,
    skill.githubCurrentCommit ?? null,
    skill.githubCurrentContentHash ?? null,
    skill.githubCurrentStatus ?? null,
  ]);
}

function completeSource(entry: Doc<"skillsShCatalogEntries">) {
  if (
    !entry.githubPath ||
    !entry.githubCommit ||
    !entry.githubContentHash ||
    !entry.sourceContentHash
  ) {
    return null;
  }
  return {
    entryId: entry._id,
    externalId: entry.externalId,
    githubOwnerId: entry.githubOwnerId,
    repository: `${entry.owner}/${entry.repo}`,
    owner: entry.owner,
    repo: entry.repo,
    slug: entry.slug,
    githubPath: entry.githubPath,
    githubCommit: entry.githubCommit,
    githubContentHash: entry.githubContentHash,
    sourceContentHash: entry.sourceContentHash,
    sourceSnapshotId: entry.sourceSnapshotId,
    sourceUrl: entry.sourceUrl,
  };
}

async function verifyOwnership(
  ctx: AdoptionCtx,
  params: {
    actorUserId: Id<"users">;
    publisher: Doc<"publishers">;
    githubOwnerId: number;
    now: number;
  },
): Promise<OwnershipResult> {
  const expectedGitHubId = String(params.githubOwnerId);
  if (params.publisher.kind === "user") {
    let providerAccountId: string | null;
    try {
      providerAccountId = await getGitHubProviderAccountId(ctx, params.actorUserId);
    } catch {
      return {
        kind: "personal",
        verified: false,
        reason: "github_identity_pending",
      };
    }
    if (!providerAccountId) {
      return {
        kind: "personal",
        verified: false,
        reason: "github_identity_missing",
      };
    }
    if (providerAccountId !== expectedGitHubId) {
      return {
        kind: "personal",
        verified: false,
        reason: "github_identity_mismatch",
      };
    }
    return { kind: "personal", verified: true, reason: null };
  }

  if (!params.publisher.githubOrgId) {
    return {
      kind: "organization",
      verified: false,
      reason: "github_org_unverified",
    };
  }
  if (params.publisher.githubOrgId !== expectedGitHubId) {
    return {
      kind: "organization",
      verified: false,
      reason: "github_org_mismatch",
    };
  }
  const membership = await ctx.db
    .query("githubOrgMemberships")
    .withIndex("by_user_and_github_org", (q) =>
      q.eq("userId", params.actorUserId).eq("githubOrgId", expectedGitHubId),
    )
    .unique();
  if (!membership) {
    return {
      kind: "organization",
      verified: false,
      reason: "github_org_membership_missing",
    };
  }
  if (params.now - membership.syncedAt > GITHUB_ORG_MEMBERSHIP_VERIFICATION_MAX_AGE_MS) {
    return {
      kind: "organization",
      verified: false,
      reason: "github_org_proof_stale",
    };
  }
  if (membership.role !== "admin") {
    return {
      kind: "organization",
      verified: false,
      reason: "github_org_admin_required",
    };
  }
  return { kind: "organization", verified: true, reason: null };
}

async function classifyDestination(
  ctx: AdoptionCtx,
  publisher: Doc<"publishers">,
  slug: string,
): Promise<DestinationResult> {
  const route = `/${publisher.handle}/${slug}`;
  const [skill, alias] = await Promise.all([
    getSkillBySlugForPublisher(ctx, slug, publisher),
    getSkillSlugAliasBySlugForPublisher(ctx, slug, publisher),
  ]);
  if (alias) {
    return {
      kind: "conflict",
      reason: "destination_alias_conflict",
      skillId: alias.skillId,
      route,
      fingerprint: null,
      activeContentWillBeReplaced: false,
      preserved: null,
    };
  }
  if (!skill) {
    return {
      kind: "create",
      skillId: null,
      route,
      fingerprint: JSON.stringify(["create", route]),
      activeContentWillBeReplaced: false,
      preserved: null,
    };
  }
  // Verified owner confirmation intentionally allows switching an unrelated same-slug skill.
  return {
    kind: "replace",
    skillId: skill._id,
    route,
    fingerprint: buildDestinationFingerprint(skill, route),
    activeContentWillBeReplaced: true,
    preserved: {
      identity: true,
      downloads: readCanonicalStat(skill, "downloads"),
      bookmarks: readCanonicalStat(skill, "stars"),
      comments: skill.stats.comments,
      official: Boolean(skill.badges?.official),
      versions: skill.stats.versions,
      auditHistory: true,
    },
  };
}

async function buildPreview(
  ctx: AdoptionCtx,
  params: {
    actorUserId: Id<"users">;
    publisherId: Id<"publishers">;
    externalId: string;
    now: number;
  },
) {
  // Adoption stays Local/Test-only until the blocked scan and promotion lanes are integrated.
  assertSkillsShFixtureEnvironmentAllowed();
  const externalId = normalizeExternalId(params.externalId);
  const [publisher, entry] = await Promise.all([
    ctx.db.get(params.publisherId),
    ctx.db
      .query("skillsShCatalogEntries")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .unique(),
  ]);
  if (!publisher || !isPublisherActive(publisher)) {
    throw new ConvexError("Publisher not found");
  }
  await requirePublisherRole(ctx, {
    publisherId: publisher._id,
    userId: params.actorUserId,
    allowed: ["admin"],
  });
  if (!entry) return null;

  const source = completeSource(entry);
  const [ownership, destination] = await Promise.all([
    verifyOwnership(ctx, {
      actorUserId: params.actorUserId,
      publisher,
      githubOwnerId: entry.githubOwnerId,
      now: params.now,
    }),
    classifyDestination(ctx, publisher, entry.slug),
  ]);
  const idempotencyKey = buildIdempotencyKey(
    publisher._id,
    entry.externalId,
    entry.sourceContentHash,
  );
  const blockingReason = !source
    ? "source_incomplete"
    : !ownership.verified
      ? ownership.reason
      : destination.kind === "conflict"
        ? destination.reason
        : null;
  return {
    canStart: blockingReason === null,
    blockingReason,
    idempotencyKey,
    publisher: {
      id: publisher._id,
      handle: publisher.handle,
      kind: publisher.kind,
    },
    ownership,
    source:
      source ??
      ({
        entryId: entry._id,
        externalId: entry.externalId,
        githubOwnerId: entry.githubOwnerId,
        repository: `${entry.owner}/${entry.repo}`,
        owner: entry.owner,
        repo: entry.repo,
        slug: entry.slug,
        githubPath: entry.githubPath ?? null,
        githubCommit: entry.githubCommit ?? null,
        githubContentHash: entry.githubContentHash ?? null,
        sourceContentHash: entry.sourceContentHash,
        sourceSnapshotId: entry.sourceSnapshotId,
        sourceUrl: entry.sourceUrl,
      } as const),
    destination,
  };
}

export const getPreview = query({
  args: {
    publisherId: v.id("publishers"),
    externalId: v.string(),
  },
  handler: async (ctx, args) => {
    if (!getSkillsShFixtureEnvironmentPolicy().allowed) return null;
    const { userId } = await requireUser(ctx);
    return await buildPreview(ctx, {
      actorUserId: userId,
      publisherId: args.publisherId,
      externalId: args.externalId,
      now: Date.now(),
    });
  },
});

type StartAdoptionArgs = {
  publisherId: Id<"publishers">;
  externalId: string;
  sourceContentHash: string;
  idempotencyKey: string;
  expectedDestinationFingerprint?: string;
};

async function startAdoption(ctx: MutationCtx, args: StartAdoptionArgs) {
  const { userId } = await requireUser(ctx);
  const preview = await buildPreview(ctx, {
    actorUserId: userId,
    publisherId: args.publisherId,
    externalId: args.externalId,
    now: Date.now(),
  });
  if (!preview) throw new ConvexError("skills.sh catalog entry not found");
  if (preview.source.sourceContentHash !== args.sourceContentHash.trim().toLowerCase()) {
    throw new ConvexError("skills.sh adoption source changed; refresh the preview");
  }
  if (preview.idempotencyKey !== args.idempotencyKey.trim()) {
    throw new ConvexError("skills.sh adoption idempotency key does not match the exact source");
  }
  if (
    args.expectedDestinationFingerprint !== undefined &&
    preview.destination.fingerprint !== args.expectedDestinationFingerprint
  ) {
    throw new ConvexError("skills.sh adoption destination changed; refresh the preview");
  }
  if (!preview.canStart) {
    if (preview.destination.kind === "conflict") {
      throw new ConvexError("Destination alias conflict blocks skills.sh adoption");
    }
    throw new ConvexError(`skills.sh adoption blocked: ${preview.blockingReason}`);
  }
  const existing = await ctx.db
    .query("skillsShAdoptions")
    .withIndex("by_publisher_and_idempotency_key", (q) =>
      q.eq("publisherId", args.publisherId).eq("idempotencyKey", preview.idempotencyKey),
    )
    .order("desc")
    .first();
  if (existing && existing.status !== "stale" && existing.status !== "canceled") {
    const destinationMatches =
      existing.destinationKind === preview.destination.kind &&
      (existing.destinationSkillId ?? null) === preview.destination.skillId &&
      existing.destinationFingerprint === preview.destination.fingerprint;
    if (
      destinationMatches ||
      (existing.status !== "pending_scan" && existing.status !== "ready_to_promote")
    ) {
      return {
        adoptionId: existing._id,
        status: existing.status,
        destinationKind: existing.destinationKind,
        destinationSkillId: existing.destinationSkillId ?? null,
        created: false,
      };
    }
    const now = Date.now();
    await ctx.db.patch(existing._id, {
      status: "stale",
      rejectionReason: "destination_changed",
      updatedAt: now,
    });
  }
  if (
    !preview.source.githubPath ||
    !preview.source.githubCommit ||
    !preview.source.githubContentHash
  ) {
    throw new ConvexError("skills.sh adoption requires a complete source snapshot");
  }
  if (!preview.destination.fingerprint) {
    throw new ConvexError("skills.sh adoption requires an unambiguous destination");
  }

  const now = Date.now();
  const adoptionId = await ctx.db.insert("skillsShAdoptions", {
    entryId: preview.source.entryId,
    actorUserId: userId,
    publisherId: args.publisherId,
    destinationKind: preview.destination.kind as "create" | "replace",
    ...(preview.destination.skillId ? { destinationSkillId: preview.destination.skillId } : {}),
    destinationFingerprint: preview.destination.fingerprint,
    ownershipKind: preview.ownership.kind,
    status: "pending_scan",
    idempotencyKey: preview.idempotencyKey,
    externalId: preview.source.externalId,
    githubOwnerId: preview.source.githubOwnerId,
    owner: preview.source.owner,
    repo: preview.source.repo,
    slug: preview.source.slug,
    githubPath: preview.source.githubPath,
    githubCommit: preview.source.githubCommit,
    githubContentHash: preview.source.githubContentHash,
    sourceContentHash: preview.source.sourceContentHash,
    sourceSnapshotId: preview.source.sourceSnapshotId,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: userId,
    action: "skills_sh.adoption.requested",
    targetType: "skillsShAdoption",
    targetId: adoptionId,
    metadata: {
      publisherId: args.publisherId,
      externalId: preview.source.externalId,
      sourceContentHash: preview.source.sourceContentHash,
      destinationKind: preview.destination.kind,
      destinationSkillId: preview.destination.skillId,
    },
    createdAt: now,
  });
  return {
    adoptionId,
    status: "pending_scan" as const,
    destinationKind: preview.destination.kind,
    destinationSkillId: preview.destination.skillId,
    created: true,
  };
}

const bulkStartArgs = {
  publisherId: v.id("publishers"),
  externalId: v.string(),
  sourceContentHash: v.string(),
  idempotencyKey: v.string(),
};

export const start = mutation({
  args: bulkStartArgs,
  handler: startAdoption,
});

export const startInteractive = mutation({
  args: {
    ...bulkStartArgs,
    expectedDestinationFingerprint: v.string(),
  },
  handler: startAdoption,
});

function adoptionIdentity(adoption: Doc<"skillsShAdoptions">) {
  return {
    externalId: adoption.externalId,
    githubOwnerId: adoption.githubOwnerId,
    owner: adoption.owner,
    repo: adoption.repo,
    slug: adoption.slug,
    githubPath: adoption.githubPath,
    githubCommit: adoption.githubCommit,
    githubContentHash: adoption.githubContentHash,
    sourceContentHash: adoption.sourceContentHash,
  };
}

export const recordScanOutcomeInternal = internalMutation({
  args: {
    adoptionId: v.id("skillsShAdoptions"),
    scanAttemptId: v.id("skillsShCatalogScanAttempts"),
  },
  handler: async (ctx, args) => {
    const adoption = await ctx.db.get(args.adoptionId);
    if (!adoption) throw new ConvexError("skills.sh adoption not found");
    if (adoption.status !== "pending_scan") {
      return {
        status: adoption.status,
        verdict: adoption.scanVerdict ?? null,
        scanAttemptId: adoption.scanAttemptId ?? null,
      };
    }
    if (adoption.scanAttemptId !== args.scanAttemptId) {
      throw new ConvexError("skills.sh adoption scan attempt is not bound to this request");
    }
    const [entry, attempt, publisher] = await Promise.all([
      ctx.db.get(adoption.entryId),
      ctx.db.get(args.scanAttemptId),
      ctx.db.get(adoption.publisherId),
    ]);
    if (!entry || !isExactSkillsShCatalogAttempt(adoptionIdentity(adoption), entry)) {
      const now = Date.now();
      await ctx.db.patch(adoption._id, {
        status: "stale",
        rejectionReason: "catalog_source_changed",
        updatedAt: now,
      });
      return {
        status: "stale" as const,
        verdict: null,
        scanAttemptId: null,
      };
    }
    const destination = publisher?.deletedAt
      ? null
      : publisher && isPublisherActive(publisher)
        ? await classifyDestination(ctx, publisher, adoption.slug)
        : null;
    const destinationMatches =
      adoption.destinationKind === "create"
        ? destination?.kind === "create" &&
          destination.fingerprint === adoption.destinationFingerprint
        : destination?.kind === "replace" &&
          destination.skillId === adoption.destinationSkillId &&
          destination.fingerprint === adoption.destinationFingerprint;
    if (!destinationMatches) {
      const now = Date.now();
      await ctx.db.patch(adoption._id, {
        status: "stale",
        rejectionReason: "destination_changed",
        updatedAt: now,
      });
      return {
        status: "stale" as const,
        verdict: null,
        scanAttemptId: null,
      };
    }
    const run = attempt ? await ctx.db.get(attempt.runId) : null;
    if (
      !attempt ||
      !run ||
      run.snapshotId !== adoption.sourceSnapshotId ||
      attempt.entryId !== adoption.entryId ||
      attempt._creationTime <= adoption._creationTime ||
      attempt.dispatchKind !== "real" ||
      attempt.source !== REAL_CATALOG_SCAN_SOURCE ||
      attempt.githubOwnerId === undefined ||
      attempt.owner === undefined ||
      attempt.repo === undefined ||
      attempt.slug === undefined ||
      !isExactSkillsShCatalogAttempt(adoptionIdentity(adoption), {
        externalId: attempt.externalId,
        githubOwnerId: attempt.githubOwnerId,
        owner: attempt.owner,
        repo: attempt.repo,
        slug: attempt.slug,
        githubPath: attempt.githubPath,
        githubCommit: attempt.githubCommit,
        githubContentHash: attempt.githubContentHash,
        sourceContentHash: attempt.sourceContentHash,
      })
    ) {
      throw new ConvexError("skills.sh adoption scan does not match the frozen candidate");
    }
    if (attempt.status === "canceled") {
      await ctx.db.patch(adoption._id, {
        scanAttemptId: undefined,
        updatedAt: Date.now(),
      });
      return {
        status: "pending_scan" as const,
        verdict: null,
        scanAttemptId: null,
      };
    }
    const [scanRequest, scanJob] = await Promise.all([
      attempt.skillScanRequestId ? ctx.db.get(attempt.skillScanRequestId) : null,
      attempt.securityScanJobId ? ctx.db.get(attempt.securityScanJobId) : null,
    ]);
    const isTerminalAttempt = attempt.status === "succeeded" || attempt.status === "failed";
    const executionIsFresh =
      run._creationTime > adoption._creationTime &&
      scanRequest?._creationTime !== undefined &&
      scanRequest._creationTime > adoption._creationTime &&
      scanJob?._creationTime !== undefined &&
      scanJob._creationTime > adoption._creationTime &&
      (!isTerminalAttempt ||
        (attempt.completedAt !== undefined &&
          attempt.completedAt > adoption.createdAt &&
          run.completedAt !== undefined &&
          run.completedAt > adoption.createdAt &&
          scanRequest.completedAt !== undefined &&
          scanRequest.completedAt > adoption.createdAt &&
          scanJob.completedAt !== undefined &&
          scanJob.completedAt > adoption.createdAt));
    const terminalLinkageMatches =
      !isTerminalAttempt ||
      (scanRequest?.status === attempt.status && scanJob?.status === attempt.status);
    if (
      !attempt.artifactContentHash ||
      !scanRequest ||
      scanRequest.sourceKind !== "skills-sh-catalog" ||
      scanRequest.requestedJobSource !== REAL_CATALOG_SCAN_SOURCE ||
      scanRequest.skillsShCatalogAttemptId !== attempt._id ||
      scanRequest.securityScanJobId !== scanJob?._id ||
      scanRequest.sha256hash !== attempt.artifactContentHash ||
      !scanJob ||
      scanJob.source !== REAL_CATALOG_SCAN_SOURCE ||
      scanJob.targetKind !== "skillScanRequest" ||
      scanJob.skillScanRequestId !== scanRequest._id ||
      !executionIsFresh ||
      !terminalLinkageMatches
    ) {
      throw new ConvexError("skills.sh adoption scan linkage is invalid");
    }
    if (attempt.status === "queued" || attempt.status === "running") {
      return {
        status: "pending_scan" as const,
        verdict: null,
        scanAttemptId: attempt._id,
      };
    }

    const now = Date.now();
    if (
      attempt.status === "succeeded" &&
      (attempt.verdict === "clean" || attempt.verdict === "suspicious")
    ) {
      await ctx.db.patch(adoption._id, {
        status: "ready_to_promote",
        scanAttemptId: attempt._id,
        scanVerdict: attempt.verdict,
        rejectionReason: undefined,
        updatedAt: now,
      });
      return {
        status: "ready_to_promote" as const,
        verdict: attempt.verdict,
        scanAttemptId: attempt._id,
      };
    }

    const verdict =
      attempt.verdict === "malicious" || attempt.verdict === "failed" ? attempt.verdict : "failed";
    await ctx.db.patch(adoption._id, {
      status: "rejected",
      scanAttemptId: attempt._id,
      scanVerdict: verdict,
      rejectionReason: `scan_${verdict}`,
      updatedAt: now,
    });
    return {
      status: "rejected" as const,
      verdict,
      scanAttemptId: attempt._id,
    };
  },
});

export const bindScanAttemptInternal = internalMutation({
  args: {
    adoptionId: v.id("skillsShAdoptions"),
    scanAttemptId: v.id("skillsShCatalogScanAttempts"),
  },
  handler: async (ctx, args) => {
    const [adoption, attempt] = await Promise.all([
      ctx.db.get(args.adoptionId),
      ctx.db.get(args.scanAttemptId),
    ]);
    if (!adoption || adoption.status !== "pending_scan") {
      throw new ConvexError("skills.sh adoption is not waiting for a scan");
    }
    if (!attempt) throw new ConvexError("skills.sh adoption scan attempt not found");
    if (adoption.scanAttemptId === attempt._id) {
      return { adoptionId: adoption._id, scanAttemptId: attempt._id, bound: false };
    }
    if (adoption.scanAttemptId) {
      throw new ConvexError("skills.sh adoption already has a bound scan attempt");
    }
    const alreadyBound = await ctx.db
      .query("skillsShAdoptions")
      .withIndex("by_scan_attempt_id", (q) => q.eq("scanAttemptId", attempt._id))
      .unique();
    if (alreadyBound && alreadyBound._id !== adoption._id) {
      throw new ConvexError("skills.sh catalog scan attempt is already bound");
    }
    const run = await ctx.db.get(attempt.runId);
    if (
      !run ||
      run.snapshotId !== adoption.sourceSnapshotId ||
      attempt.entryId !== adoption.entryId ||
      attempt._creationTime <= adoption._creationTime ||
      attempt.dispatchKind !== "real" ||
      attempt.source !== REAL_CATALOG_SCAN_SOURCE ||
      attempt.githubOwnerId === undefined ||
      attempt.owner === undefined ||
      attempt.repo === undefined ||
      attempt.slug === undefined ||
      !isExactSkillsShCatalogAttempt(adoptionIdentity(adoption), {
        externalId: attempt.externalId,
        githubOwnerId: attempt.githubOwnerId,
        owner: attempt.owner,
        repo: attempt.repo,
        slug: attempt.slug,
        githubPath: attempt.githubPath,
        githubCommit: attempt.githubCommit,
        githubContentHash: attempt.githubContentHash,
        sourceContentHash: attempt.sourceContentHash,
      })
    ) {
      throw new ConvexError("skills.sh adoption scan does not match the frozen candidate");
    }
    await ctx.db.patch(adoption._id, {
      scanAttemptId: attempt._id,
      updatedAt: Date.now(),
    });
    return { adoptionId: adoption._id, scanAttemptId: attempt._id, bound: true };
  },
});
