import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./functions";
import { requireUser, requireUserFromAction } from "./lib/access";
import { fetchGitHubRepositoryIdentity } from "./lib/githubActionsOidc";
import { getGitHubProviderAccountId } from "./lib/githubIdentity";
import { GITHUB_ORG_MEMBERSHIP_VERIFICATION_MAX_AGE_MS } from "./lib/githubOrgMemberships";
import { isPublisherActive, requirePublisherRole } from "./lib/publishers";
import { parseFrontmatter } from "./lib/skills";
import {
  getSkillBySlugForPublisher,
  getSkillSlugAliasBySlugForPublisher,
} from "./lib/skills/slugResolution";
import { fetchExactSkillsShAdoptionSource } from "./lib/skillsShAdoptionSource";
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
const ADOPTION_RUN_FIXTURE_ID = "skills-sh-test-live-500" as const;
const MAX_STAGED_STATIC_SCAN_ATTEMPTS = 3;
const STAGED_STATIC_SCAN_RETRY_DELAY_MS = 5_000;

type StoredArtifact = {
  externalId: string;
  artifactContentHash: string;
  files: Array<{
    path: string;
    size: number;
    storageId: Id<"_storage">;
    sha256: string;
    contentType?: string;
  }>;
};

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

function completeMirrorSource(digest: Doc<"skillsShMirrorDigests">) {
  if (
    digest.sourceType !== "github" ||
    !digest.active ||
    !digest.owner ||
    !digest.repo ||
    !digest.githubPath ||
    !digest.githubCommit ||
    !digest.sourceContentHash
  ) {
    return null;
  }
  return {
    mirrorDigestId: digest._id,
    externalId: digest.externalId,
    repository: `${digest.owner}/${digest.repo}`,
    owner: digest.owner,
    repo: digest.repo,
    slug: digest.slug,
    githubPath: digest.githubPath,
    githubCommit: digest.githubCommit,
    sourceContentHash: digest.sourceContentHash,
    sourceSnapshotId: digest.sourceSnapshotId,
    sourceUrl: digest.sourceUrl,
    displayName: digest.displayName,
    upstreamInstalls: digest.upstreamInstalls,
  };
}

async function buildMirroredPreview(
  ctx: AdoptionCtx,
  params: {
    actorUserId: Id<"users">;
    publisherId: Id<"publishers">;
    externalId: string;
    githubOwnerId: number;
    canonicalRepository: string;
    now: number;
  },
) {
  // Mirrored claims remain Local/Test-only until the permanent Test acceptance
  // explicitly authorizes production scans and publisher attachment.
  assertSkillsShFixtureEnvironmentAllowed();
  const externalId = normalizeExternalId(params.externalId);
  const [publisher, digest] = await Promise.all([
    ctx.db.get(params.publisherId),
    ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .unique(),
  ]);
  if (!publisher || !isPublisherActive(publisher)) throw new ConvexError("Publisher not found");
  await requirePublisherRole(ctx, {
    publisherId: publisher._id,
    userId: params.actorUserId,
    allowed: ["admin"],
  });
  if (!digest) return null;
  const source = completeMirrorSource(digest);
  if (!source) return null;
  const [ownership, destination] = await Promise.all([
    verifyOwnership(ctx, {
      actorUserId: params.actorUserId,
      publisher,
      githubOwnerId: params.githubOwnerId,
      now: params.now,
    }),
    classifyDestination(ctx, publisher, source.slug),
  ]);
  const idempotencyKey = buildIdempotencyKey(
    publisher._id,
    source.externalId,
    source.sourceContentHash,
  );
  const blockingReason = !ownership.verified
    ? ownership.reason
    : destination.kind === "conflict"
      ? destination.reason
      : null;
  return {
    canStart: blockingReason === null,
    blockingReason,
    idempotencyKey,
    publisher: { id: publisher._id, handle: publisher.handle, kind: publisher.kind },
    ownership,
    source: {
      ...source,
      githubOwnerId: params.githubOwnerId,
      githubContentHash: source.sourceContentHash,
    },
    destination,
  };
}

export const getMirroredPreviewInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    publisherId: v.id("publishers"),
    externalId: v.string(),
    githubOwnerId: v.number(),
    canonicalRepository: v.string(),
  },
  handler: async (ctx, args) =>
    await buildMirroredPreview(ctx, {
      ...args,
      now: Date.now(),
    }),
});

export const getMirroredPreview = action({
  args: {
    publisherId: v.id("publishers"),
    externalId: v.string(),
  },
  handler: async (ctx, args): Promise<Awaited<ReturnType<typeof buildMirroredPreview>>> => {
    const { userId } = await requireUserFromAction(ctx);
    const digest = await ctx.runQuery(internal.skillsShMirror.getByExternalIdInternal, {
      externalId: normalizeExternalId(args.externalId),
    });
    const source = digest ? completeMirrorSource(digest) : null;
    if (!source) return null;
    const identity = await fetchGitHubRepositoryIdentity(source.repository);
    const githubOwnerId = Number(identity.repositoryOwnerId);
    if (!Number.isSafeInteger(githubOwnerId)) {
      throw new ConvexError("GitHub repository owner identity is invalid");
    }
    return await ctx.runQuery(internal.skillsShAdoption.getMirroredPreviewInternal, {
      actorUserId: userId,
      publisherId: args.publisherId,
      externalId: source.externalId,
      githubOwnerId,
      canonicalRepository: identity.repository,
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

async function startAdoptionForUser(
  ctx: MutationCtx,
  args: StartAdoptionArgs,
  userId: Id<"users">,
) {
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

async function startAdoption(ctx: MutationCtx, args: StartAdoptionArgs) {
  const { userId } = await requireUser(ctx);
  return await startAdoptionForUser(ctx, args, userId);
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

async function createMirroredAdoptionRun(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"users">;
    source: ReturnType<typeof completeMirrorSource> extends infer Source
      ? Exclude<Source, null>
      : never;
    existingEntry: boolean;
    now: number;
  },
) {
  return await ctx.db.insert("skillsShCatalogRuns", {
    fixtureId: ADOPTION_RUN_FIXTURE_ID,
    snapshotId: args.source.sourceSnapshotId,
    sourceKind: "staging-live",
    snapshotCaptureFetches: 0,
    dryRun: false,
    status: "completed",
    cursor: 1,
    scanCursor: 0,
    fixtureLength: 1,
    counts: {
      observed: 1,
      wouldInsert: args.existingEntry ? 0 : 1,
      wouldUpdate: args.existingEntry ? 1 : 0,
      inserted: args.existingEntry ? 0 : 1,
      updated: args.existingEntry ? 1 : 0,
      unchanged: 0,
      rejected: 0,
      scansPlanned: 1,
      scansAdmitted: 0,
      scansCompleted: 0,
      scansCanceled: 0,
    },
    budgets: {
      maxEntriesPerRun: 1,
      maxEntriesPerBatch: 1,
      maxWritesPerBatch: 20,
      maxPlannedScans: 1,
      maxScanAdmissionsPerBatch: 1,
      maxScanAdmissionsPerRun: 1,
      maxScanAdmissionsPerDay: 3,
    },
    operations: { functionCalls: 1, dbReads: 4, dbWrites: 2 },
    actor: `skills-sh-adoption:${args.actorUserId}`,
    reason: `Verified adoption of ${args.source.externalId}`,
    batchesProcessed: 1,
    scanAdmissionBatches: 0,
    lastBatchWrites: 2,
    lastBatchReads: 4,
    startedAt: args.now,
    completedAt: args.now,
    updatedAt: args.now,
  });
}

export const materializeMirroredAdoptionInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    publisherId: v.id("publishers"),
    externalId: v.string(),
    sourceContentHash: v.string(),
    idempotencyKey: v.string(),
    expectedDestinationFingerprint: v.string(),
    githubOwnerId: v.number(),
    canonicalRepository: v.string(),
    githubPath: v.string(),
    githubCommit: v.string(),
  },
  handler: async (ctx, args) => {
    const preview = await buildMirroredPreview(ctx, {
      actorUserId: args.actorUserId,
      publisherId: args.publisherId,
      externalId: args.externalId,
      githubOwnerId: args.githubOwnerId,
      canonicalRepository: args.canonicalRepository,
      now: Date.now(),
    });
    if (!preview) throw new ConvexError("skills.sh mirror entry not found");
    if (
      preview.source.sourceContentHash !== args.sourceContentHash ||
      normalizedRepositoryPath(preview.source.githubPath) !==
        normalizedRepositoryPath(args.githubPath) ||
      preview.source.githubCommit.toLowerCase() !== args.githubCommit.toLowerCase()
    ) {
      throw new ConvexError("skills.sh mirror source changed during adoption");
    }
    if (!preview.canStart) {
      throw new ConvexError(`skills.sh adoption blocked: ${preview.blockingReason}`);
    }

    const now = Date.now();
    const existingEntry = await ctx.db
      .query("skillsShCatalogEntries")
      .withIndex("by_external_id", (q) => q.eq("externalId", preview.source.externalId))
      .unique();
    if (existingEntry?.publicVisible || existingEntry?.publishedScanAttemptId) {
      throw new ConvexError("A previously scanned catalog entry cannot be reused for adoption");
    }
    const existingEntryMatchesSource =
      existingEntry?.githubOwnerId === args.githubOwnerId &&
      existingEntry.githubPath === preview.source.githubPath &&
      existingEntry.githubCommit?.toLowerCase() === preview.source.githubCommit.toLowerCase() &&
      existingEntry.sourceContentHash === preview.source.sourceContentHash;
    const reusableScanStatus =
      existingEntryMatchesSource &&
      (existingEntry.scanStatus === "planned" || existingEntry.scanStatus === "queued")
        ? existingEntry.scanStatus
        : ("planned" as const);
    const entryPatch = {
      sourceKind: "staging-live" as const,
      githubOwnerId: args.githubOwnerId,
      owner: preview.source.owner,
      repo: preview.source.repo,
      slug: preview.source.slug,
      displayName: preview.source.displayName,
      sourceUrl: preview.source.sourceUrl,
      githubRepoUrl: `https://github.com/${args.canonicalRepository}`,
      githubPath: preview.source.githubPath,
      githubCommit: preview.source.githubCommit.toLowerCase(),
      githubContentHash: preview.source.sourceContentHash,
      sourceContentHash: preview.source.sourceContentHash,
      installs: preview.source.upstreamInstalls,
      sourceSnapshotId: preview.source.sourceSnapshotId,
      publicVisible: false,
      scanStatus: reusableScanStatus,
      lastObservedAt: now,
      updatedAt: now,
    };
    let entryId: Id<"skillsShCatalogEntries">;
    if (existingEntry) {
      entryId = existingEntry._id;
      await ctx.db.patch(existingEntry._id, entryPatch);
    } else {
      entryId = await ctx.db.insert("skillsShCatalogEntries", {
        externalId: preview.source.externalId,
        ...entryPatch,
        firstObservedAt: now,
        createdAt: now,
      });
    }
    const started = await startAdoptionForUser(
      ctx,
      {
        publisherId: args.publisherId,
        externalId: preview.source.externalId,
        sourceContentHash: args.sourceContentHash,
        idempotencyKey: args.idempotencyKey,
        expectedDestinationFingerprint: args.expectedDestinationFingerprint,
      },
      args.actorUserId,
    );
    const adoption = await ctx.db.get(started.adoptionId);
    if (!adoption) throw new ConvexError("skills.sh adoption not found");
    const canRefreshSourceLinkage =
      started.created || (adoption.status === "pending_scan" && !adoption.scanAttemptId);
    if (canRefreshSourceLinkage) {
      await ctx.db.patch(started.adoptionId, {
        entryId,
        mirrorDigestId: preview.source.mirrorDigestId,
        sourceUrl: preview.source.sourceUrl,
        canonicalRepository: args.canonicalRepository,
        updatedAt: now,
      });
    }
    if (!started.created) {
      if (adoption.status === "pending_scan" && !adoption.scanAttemptId) {
        const existingRun = adoption.scanRunId ? await ctx.db.get(adoption.scanRunId) : null;
        const runId =
          existingRun?.fixtureId === ADOPTION_RUN_FIXTURE_ID && existingRun.status === "completed"
            ? existingRun._id
            : await createMirroredAdoptionRun(ctx, {
                actorUserId: args.actorUserId,
                source: preview.source,
                existingEntry: true,
                now,
              });
        if (adoption.scanRunId !== runId) {
          await ctx.db.patch(adoption._id, { scanRunId: runId, updatedAt: now });
        }
        return { ...started, runId, entryId, shouldAdmit: true };
      }
      return { ...started, runId: null, entryId, shouldAdmit: false };
    }
    const runId = await createMirroredAdoptionRun(ctx, {
      actorUserId: args.actorUserId,
      source: preview.source,
      existingEntry: Boolean(existingEntry),
      now,
    });
    await ctx.db.patch(started.adoptionId, { scanRunId: runId, updatedAt: now });
    return { ...started, runId, entryId, shouldAdmit: true };
  },
});

export const failMirroredStartInternal = internalMutation({
  args: {
    adoptionId: v.id("skillsShAdoptions"),
    runId: v.id("skillsShCatalogRuns"),
  },
  handler: async (ctx, args) => {
    const [adoption, run] = await Promise.all([
      ctx.db.get(args.adoptionId),
      ctx.db.get(args.runId),
    ]);
    if (
      !adoption ||
      adoption.status !== "pending_scan" ||
      adoption.scanAttemptId ||
      adoption.scanRunId !== args.runId ||
      !run ||
      run.fixtureId !== ADOPTION_RUN_FIXTURE_ID
    ) {
      return { safeToDeleteArtifact: false };
    }
    const now = Date.now();
    await Promise.all([
      ctx.db.patch(adoption._id, {
        status: "canceled",
        rejectionReason: "scan_admission_failed",
        updatedAt: now,
      }),
      ctx.db.patch(run._id, {
        status: "failed",
        lastError: "skills.sh adoption scan admission failed",
        completedAt: now,
        updatedAt: now,
      }),
    ]);
    return { safeToDeleteArtifact: true };
  },
});

async function deleteStoredArtifact(ctx: ActionCtx, artifact: StoredArtifact) {
  await Promise.allSettled(
    artifact.files.map(async (file) => await ctx.storage.delete(file.storageId)),
  );
}

export const startMirroredInteractive = action({
  args: {
    publisherId: v.id("publishers"),
    externalId: v.string(),
    sourceContentHash: v.string(),
    idempotencyKey: v.string(),
    expectedDestinationFingerprint: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    adoptionId: Id<"skillsShAdoptions">;
    status: Doc<"skillsShAdoptions">["status"];
    destinationKind: "create" | "replace";
    destinationSkillId: Id<"skills"> | null;
    created: boolean;
  }> => {
    const { userId } = await requireUserFromAction(ctx);
    const digest = await ctx.runQuery(internal.skillsShMirror.getByExternalIdInternal, {
      externalId: normalizeExternalId(args.externalId),
    });
    const source = digest ? completeMirrorSource(digest) : null;
    if (!source) throw new ConvexError("skills.sh mirror entry not found");
    const identity = await fetchGitHubRepositoryIdentity(source.repository);
    const githubOwnerId = Number(identity.repositoryOwnerId);
    if (!Number.isSafeInteger(githubOwnerId)) {
      throw new ConvexError("GitHub repository owner identity is invalid");
    }
    const preview = await ctx.runQuery(internal.skillsShAdoption.getMirroredPreviewInternal, {
      actorUserId: userId,
      publisherId: args.publisherId,
      externalId: source.externalId,
      githubOwnerId,
      canonicalRepository: identity.repository,
    });
    if (!preview || !preview.canStart) {
      throw new ConvexError(
        preview ? `skills.sh adoption blocked: ${preview.blockingReason}` : "Publisher not found",
      );
    }
    if (
      preview.source.sourceContentHash !== args.sourceContentHash.trim().toLowerCase() ||
      preview.idempotencyKey !== args.idempotencyKey.trim() ||
      preview.destination.fingerprint !== args.expectedDestinationFingerprint
    ) {
      throw new ConvexError("skills.sh adoption preview changed; refresh before continuing");
    }
    const fetched = await fetchExactSkillsShAdoptionSource(source);
    if (
      fetched.sourceContentHash !== args.sourceContentHash.trim().toLowerCase() ||
      fetched.externalId !== source.externalId
    ) {
      throw new ConvexError("skills.sh mirror source changed; refresh the preview");
    }
    if (!Number.isSafeInteger(fetched.repositoryOwnerId)) {
      throw new ConvexError("GitHub repository owner identity is invalid");
    }
    const storedFiles: StoredArtifact["files"] = [];
    let artifactOwnedByScan = false;
    let createdStart: {
      adoptionId: Id<"skillsShAdoptions">;
      runId: Id<"skillsShCatalogRuns">;
    } | null = null;
    try {
      for (const file of fetched.files) {
        const storageId = await ctx.storage.store(
          new Blob([Uint8Array.from(file.bytes)], { type: file.contentType }),
        );
        storedFiles.push({
          path: file.path,
          size: file.bytes.byteLength,
          storageId,
          sha256: file.sha256,
          contentType: file.contentType,
        });
      }
      const artifact: StoredArtifact = {
        externalId: source.externalId,
        artifactContentHash: fetched.artifactContentHash,
        files: storedFiles,
      };
      const started = await ctx.runMutation(
        internal.skillsShAdoption.materializeMirroredAdoptionInternal,
        {
          actorUserId: userId,
          publisherId: args.publisherId,
          externalId: source.externalId,
          sourceContentHash: fetched.sourceContentHash,
          idempotencyKey: args.idempotencyKey,
          expectedDestinationFingerprint: args.expectedDestinationFingerprint,
          githubOwnerId: fetched.repositoryOwnerId,
          canonicalRepository: fetched.repository,
          githubPath: fetched.githubPath,
          githubCommit: fetched.githubCommit,
        },
      );
      if (started.status !== "pending_scan" || !started.shouldAdmit) {
        await deleteStoredArtifact(ctx, artifact);
        return started;
      }
      if (!started.runId) {
        throw new ConvexError("skills.sh adoption scan run was not created");
      }
      createdStart = {
        adoptionId: started.adoptionId,
        runId: started.runId,
      };
      const admitted = await ctx.runAction(internal.skillsShCatalog.admitRealScansInternal, {
        runId: started.runId,
        externalIds: [source.externalId],
        actorUserId: userId,
        adoptionId: started.adoptionId,
        artifacts: [artifact],
      });
      const admittedAttempt = admitted.admittedAttempts?.[0];
      if (!admittedAttempt) {
        throw new ConvexError("skills.sh adoption scan was not admitted");
      }
      if (admittedAttempt.reused) {
        await deleteStoredArtifact(ctx, artifact);
        return started;
      }
      artifactOwnedByScan = true;
      return started;
    } catch (error) {
      let safeToDeleteArtifact = !createdStart;
      if (!artifactOwnedByScan && createdStart) {
        try {
          const cleanup = await ctx.runMutation(
            internal.skillsShAdoption.failMirroredStartInternal,
            createdStart,
          );
          safeToDeleteArtifact = cleanup.safeToDeleteArtifact;
        } catch {
          safeToDeleteArtifact = false;
        }
      }
      if (!artifactOwnedByScan && safeToDeleteArtifact && storedFiles.length > 0) {
        await deleteStoredArtifact(ctx, {
          externalId: source.externalId,
          artifactContentHash: fetched.artifactContentHash,
          files: storedFiles,
        });
      }
      throw error;
    }
  },
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

function frontmatterDescription(frontmatter: Record<string, unknown>) {
  const value = frontmatter.description;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildMirroredInferencePatch(
  digest: Doc<"skillsShMirrorDigests"> | null,
  versionId: Id<"skillVersions">,
) {
  if (!digest) return {};
  return {
    inferredCategories:
      digest.inferredCategories && digest.inferredCategories.length > 0
        ? digest.inferredCategories
        : ["other"],
    inferredTopics: digest.inferredTopics ?? [],
    inferredFromVersionId: versionId,
    inferredCategoryConfidence: digest.inferredCategoryConfidence,
    inferredTopicConfidence: digest.inferredTopicConfidence,
    inferredClassifierVersion: digest.inferredClassifierVersion,
    inferredTopicClassifierVersion: digest.inferredTopicClassifierVersion,
    inferredInputHash: digest.inferredInputHash,
    inferredTopicInputHash: digest.inferredTopicInputHash,
    inferredAt: digest.inferredAt,
  };
}

function normalizedRepository(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function normalizedRepositoryPath(value: string | undefined) {
  const normalized = value?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  return normalized === "." ? "" : normalized;
}

function versionMatchesAdoptionArtifact(
  version: Doc<"skillVersions">,
  adoption: Doc<"skillsShAdoptions">,
  attempt: Doc<"skillsShCatalogScanAttempts">,
  request: Doc<"skillScanRequests">,
) {
  const provenance = version.sourceProvenance;
  const expectedRepository = adoption.canonicalRepository ?? `${adoption.owner}/${adoption.repo}`;
  if (
    version.softDeletedAt ||
    (version.publicationStatus !== "published" && version.publicationStatus !== "pending") ||
    version.fingerprint !== attempt.artifactContentHash ||
    version.sha256hash !== attempt.artifactContentHash ||
    !provenance ||
    normalizedRepository(provenance.repo) !== normalizedRepository(expectedRepository) ||
    provenance.commit?.toLowerCase() !== adoption.githubCommit.toLowerCase() ||
    normalizedRepositoryPath(provenance.path) !== normalizedRepositoryPath(adoption.githubPath)
  ) {
    return false;
  }
  const existingFiles = [...version.files]
    .map((file) => `${file.path}\0${file.size}\0${file.sha256.toLowerCase()}`)
    .sort();
  const scannedFiles = [...request.files]
    .map((file) => `${file.path}\0${file.size}\0${file.sha256.toLowerCase()}`)
    .sort();
  return (
    existingFiles.length === scannedFiles.length &&
    existingFiles.every((file, index) => file === scannedFiles[index])
  );
}

async function removeAdoptionCreatedStaging(
  ctx: MutationCtx,
  adoption: Doc<"skillsShAdoptions">,
  request: Doc<"skillScanRequests">,
  skill: Doc<"skills">,
  version: Doc<"skillVersions">,
) {
  if (
    !adoption.stagedVersionCreated ||
    adoption.stagedSkillId !== skill._id ||
    adoption.stagedVersionId !== version._id ||
    version.skillId !== skill._id ||
    skill.ownerPublisherId !== adoption.publisherId ||
    skill.slug !== adoption.slug ||
    version.publicationStatus === "published" ||
    skill.latestVersionId === version._id ||
    Object.values(skill.tags).includes(version._id)
  ) {
    return { removedVersion: false, removedSkill: false };
  }

  const [fingerprints, cardJobs] = await Promise.all([
    ctx.db
      .query("skillVersionFingerprints")
      .withIndex("by_version", (q) => q.eq("versionId", version._id))
      .collect(),
    ctx.db
      .query("skillCardGenerationJobs")
      .withIndex("by_skill_version", (q) => q.eq("skillVersionId", version._id))
      .collect(),
  ]);
  if (request.skillVersionId === version._id) {
    await ctx.db.patch(request._id, {
      skillVersionId: undefined,
      updatedAt: Date.now(),
    });
  }
  for (const fingerprint of fingerprints) await ctx.db.delete(fingerprint._id);
  for (const cardJob of cardJobs) await ctx.db.delete(cardJob._id);
  await ctx.db.delete(version._id);
  if (adoption.destinationKind !== "create") {
    return { removedVersion: true, removedSkill: false };
  }

  const remainingVersions = await ctx.db
    .query("skillVersions")
    .withIndex("by_skill_version", (q) => q.eq("skillId", skill._id))
    .take(1);
  if (remainingVersions.length > 0 || skill.latestVersionId || skill.tags.latest) {
    return { removedVersion: true, removedSkill: false };
  }
  await ctx.db.delete(skill._id);
  return { removedVersion: true, removedSkill: true };
}

function latestVersionSummary(version: Doc<"skillVersions">) {
  return {
    version: version.version,
    createdAt: version.createdAt,
    changelog: version.changelog,
    changelogSource: version.changelogSource,
    description: frontmatterDescription(version.parsed.frontmatter),
  };
}

async function restorePreviousPublishedVersion(
  ctx: MutationCtx,
  skill: Doc<"skills">,
  rejectedVersion: Doc<"skillVersions">,
) {
  const tags = Object.fromEntries(
    Object.entries(skill.tags).filter(([, versionId]) => versionId !== rejectedVersion._id),
  ) as Doc<"skills">["tags"];
  if (skill.latestVersionId !== rejectedVersion._id) {
    if (skill.latestVersionId) tags.latest = skill.latestVersionId;
    await ctx.db.patch(skill._id, {
      tags,
      updatedAt: Date.now(),
    });
    return;
  }
  const replacement = await ctx.db
    .query("skillVersions")
    .withIndex("by_skill_active_created", (q) =>
      q.eq("skillId", skill._id).eq("softDeletedAt", undefined),
    )
    .order("desc")
    .filter((q) => q.eq(q.field("publicationStatus"), "published"))
    .first();
  if (replacement) tags.latest = replacement._id;
  await ctx.db.patch(skill._id, {
    latestVersionId: replacement?._id,
    latestVersionSummary: replacement ? latestVersionSummary(replacement) : undefined,
    tags,
    updatedAt: Date.now(),
  });
}

async function stageAdoptionForStaticScan(
  ctx: MutationCtx,
  adoption: Doc<"skillsShAdoptions">,
  attempt: Doc<"skillsShCatalogScanAttempts">,
  request: Doc<"skillScanRequests">,
) {
  if (adoption.status === "promoted" && adoption.promotedSkillId && adoption.promotedVersionId) {
    return {
      status: "promoted" as const,
      skillId: adoption.promotedSkillId,
      versionId: adoption.promotedVersionId,
      canonicalRef: adoption.canonicalRef ?? null,
    };
  }
  if (
    adoption.status !== "ready_to_promote" ||
    !adoption.scanVerdict ||
    (adoption.scanVerdict !== "clean" && adoption.scanVerdict !== "suspicious")
  ) {
    throw new ConvexError("skills.sh adoption is not ready for promotion");
  }
  const artifactContentHash = attempt.artifactContentHash;
  if (!artifactContentHash || !request.llmAnalysis) {
    throw new ConvexError("skills.sh adoption completed scan report is unavailable");
  }
  const [publisher, digest, detail] = await Promise.all([
    ctx.db.get(adoption.publisherId),
    adoption.mirrorDigestId ? ctx.db.get(adoption.mirrorDigestId) : null,
    ctx.db
      .query("skillsShMirrorDetails")
      .withIndex("by_external_id", (q) => q.eq("externalId", adoption.externalId))
      .unique(),
  ]);
  if (!publisher || !isPublisherActive(publisher)) {
    throw new ConvexError("skills.sh adoption publisher is unavailable");
  }
  if (
    adoption.mirrorDigestId &&
    (!digest || digest.sourceContentHash !== adoption.sourceContentHash)
  ) {
    await ctx.db.patch(adoption._id, {
      status: "stale",
      rejectionReason: "catalog_source_changed",
      updatedAt: Date.now(),
    });
    return {
      status: "stale" as const,
      skillId: adoption.destinationSkillId ?? null,
      versionId: null,
      canonicalRef: null,
    };
  }
  const destination = await classifyDestination(ctx, publisher, adoption.slug);
  const destinationMatches =
    adoption.destinationKind === "create"
      ? destination.kind === "create" && destination.fingerprint === adoption.destinationFingerprint
      : destination.kind === "replace" &&
        destination.skillId === adoption.destinationSkillId &&
        destination.fingerprint === adoption.destinationFingerprint;
  if (!destinationMatches) {
    await ctx.db.patch(adoption._id, {
      status: "stale",
      rejectionReason: "destination_changed",
      updatedAt: Date.now(),
    });
    return {
      status: "stale" as const,
      skillId: adoption.destinationSkillId ?? null,
      versionId: null,
      canonicalRef: null,
    };
  }

  const now = Date.now();
  const parsedFrontmatter =
    detail?.contentKind === "skill-md" && detail.sourceContentHash === adoption.sourceContentHash
      ? parseFrontmatter(detail.content)
      : {};
  let skill =
    adoption.destinationKind === "replace" && adoption.destinationSkillId
      ? await ctx.db.get(adoption.destinationSkillId)
      : null;
  const createdSkill = !skill;
  if (!skill) {
    const skillId = await ctx.db.insert("skills", {
      slug: adoption.slug,
      displayName: digest?.displayName ?? adoption.slug,
      summary: frontmatterDescription(parsedFrontmatter),
      ownerUserId: adoption.actorUserId,
      ownerPublisherId: adoption.publisherId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      moderationReason: "skills-sh.adopted",
      moderationVerdict: adoption.scanVerdict,
      moderationSourceVersionId: undefined,
      isSuspicious: adoption.scanVerdict === "suspicious",
      statsDownloads: 0,
      statsStars: 0,
      statsInstallsCurrent: 0,
      statsInstallsAllTime: 0,
      statsSkillsShInstalls: digest?.upstreamInstalls ?? 0,
      stats: {
        downloads: 0,
        stars: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        versions: 0,
        comments: 0,
      },
      createdAt: now,
      updatedAt: now,
    });
    skill = await ctx.db.get(skillId);
  }
  if (!skill) throw new ConvexError("skills.sh adoption destination could not be created");

  const versionName = adoption.githubCommit.toLowerCase();
  let version = await ctx.db
    .query("skillVersions")
    .withIndex("by_skill_version", (q) => q.eq("skillId", skill._id).eq("version", versionName))
    .unique();
  const createdVersion = !version;
  if (
    version &&
    (version.publicationStatus !== "published" ||
      !versionMatchesAdoptionArtifact(version, adoption, attempt, request))
  ) {
    await ctx.db.patch(adoption._id, {
      status: "stale",
      rejectionReason: "destination_version_conflict",
      updatedAt: now,
    });
    return {
      status: "stale" as const,
      skillId: skill._id,
      versionId: version._id,
      canonicalRef: null,
    };
  }
  if (!version) {
    const repository = adoption.canonicalRepository ?? `${adoption.owner}/${adoption.repo}`;
    const sourcePath = normalizedRepositoryPath(adoption.githubPath);
    const versionId = await ctx.db.insert("skillVersions", {
      skillId: skill._id,
      version: versionName,
      publicationStatus: "pending",
      fingerprint: artifactContentHash,
      sourceProvenance: {
        kind: "github",
        url: `https://github.com/${repository}/tree/${adoption.githubCommit}${
          sourcePath ? `/${sourcePath}` : ""
        }`,
        repo: repository,
        ref: adoption.githubCommit,
        commit: adoption.githubCommit,
        path: adoption.githubPath,
        importedAt: now,
      },
      changelog: "Adopted from the mirrored skills.sh catalog.",
      changelogSource: "auto",
      files: request.files,
      parsed: {
        frontmatter: parsedFrontmatter,
      },
      createdBy: adoption.actorUserId,
      createdAt: now,
      sha256hash: artifactContentHash,
      llmAnalysis: request.llmAnalysis,
      skillSpectorAnalysis: request.skillSpectorAnalysis,
    });
    version = await ctx.db.get(versionId);
  } else {
    await ctx.db.patch(version._id, {
      llmAnalysis: request.llmAnalysis,
      ...(request.skillSpectorAnalysis
        ? { skillSpectorAnalysis: request.skillSpectorAnalysis }
        : {}),
    });
    version = await ctx.db.get(version._id);
  }
  if (!version) throw new ConvexError("skills.sh adoption version could not be created");

  if (createdSkill) {
    await ctx.db.patch(skill._id, buildMirroredInferencePatch(digest, version._id));
  }

  const sourceFingerprints = await ctx.db
    .query("skillVersionFingerprints")
    .withIndex("by_version_kind", (q) => q.eq("versionId", version!._id).eq("kind", "source"))
    .collect();
  if (!sourceFingerprints.some((entry) => entry.fingerprint === artifactContentHash)) {
    await ctx.db.insert("skillVersionFingerprints", {
      skillId: skill._id,
      versionId: version._id,
      fingerprint: artifactContentHash,
      kind: "source",
      createdAt: now,
    });
  }
  if (createdVersion && request.skillVersionId && request.skillVersionId !== version._id) {
    throw new ConvexError("skills.sh adoption scan request is bound to another version");
  }
  if (createdVersion && request.skillVersionId !== version._id) {
    await ctx.db.patch(request._id, {
      skillVersionId: version._id,
      updatedAt: now,
    });
  }

  await ctx.db.patch(adoption._id, {
    stagedSkillId: skill._id,
    stagedVersionId: version._id,
    stagedVersionCreated: createdVersion,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.skillsShAdoption.scanStagedVersionInternal, {
    adoptionId: adoption._id,
    skillId: skill._id,
    versionId: version._id,
  });
  return {
    status: "ready_to_promote" as const,
    skillId: skill._id,
    versionId: version._id,
    canonicalRef: null,
  };
}

export const beginStagedStaticScanInternal = internalMutation({
  args: {
    adoptionId: v.id("skillsShAdoptions"),
    skillId: v.id("skills"),
    versionId: v.id("skillVersions"),
  },
  handler: async (ctx, args) => {
    const adoption = await ctx.db.get(args.adoptionId);
    if (
      !adoption ||
      adoption.status !== "ready_to_promote" ||
      adoption.stagedSkillId !== args.skillId ||
      adoption.stagedVersionId !== args.versionId
    ) {
      return { shouldRun: false as const, attempt: 0 };
    }
    const attempt = (adoption.staticScanAttempts ?? 0) + 1;
    await ctx.db.patch(adoption._id, {
      staticScanAttempts: attempt,
      staticScanLastError: undefined,
      updatedAt: Date.now(),
    });
    return { shouldRun: true as const, attempt };
  },
});

export const recordStagedStaticScanFailureInternal = internalMutation({
  args: {
    adoptionId: v.id("skillsShAdoptions"),
    skillId: v.id("skills"),
    versionId: v.id("skillVersions"),
    attempt: v.number(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const adoption = await ctx.db.get(args.adoptionId);
    if (
      !adoption ||
      adoption.status !== "ready_to_promote" ||
      adoption.stagedSkillId !== args.skillId ||
      adoption.stagedVersionId !== args.versionId ||
      adoption.staticScanAttempts !== args.attempt
    ) {
      return { retry: false as const, canceled: false as const };
    }
    const now = Date.now();
    const error = args.error.trim().slice(0, 500) || "static scan execution failed";
    if (args.attempt < MAX_STAGED_STATIC_SCAN_ATTEMPTS) {
      await ctx.db.patch(adoption._id, {
        staticScanLastError: error,
        updatedAt: now,
      });
      return { retry: true as const, canceled: false as const };
    }

    const attempt = adoption.scanAttemptId ? await ctx.db.get(adoption.scanAttemptId) : null;
    const request =
      attempt?.skillScanRequestId !== undefined
        ? await ctx.db.get(attempt.skillScanRequestId)
        : null;
    const [skill, version] = await Promise.all([
      ctx.db.get(adoption.stagedSkillId),
      ctx.db.get(adoption.stagedVersionId),
    ]);
    if (request && skill && version) {
      await removeAdoptionCreatedStaging(ctx, adoption, request, skill, version);
      await ctx.db.patch(request._id, {
        writtenBack: true,
        updatedAt: now,
      });
    }
    await ctx.db.patch(adoption._id, {
      status: "canceled",
      stagedSkillId: undefined,
      stagedVersionId: undefined,
      stagedVersionCreated: undefined,
      staticScanLastError: error,
      rejectionReason: "static_scan_execution_failed",
      updatedAt: now,
    });
    return { retry: false as const, canceled: true as const };
  },
});

export const scanStagedVersionInternal: ReturnType<typeof internalAction> = internalAction({
  args: {
    adoptionId: v.id("skillsShAdoptions"),
    skillId: v.id("skills"),
    versionId: v.id("skillVersions"),
  },
  handler: async (ctx, args) => {
    const started = await ctx.runMutation(
      internal.skillsShAdoption.beginStagedStaticScanInternal,
      args,
    );
    if (!started.shouldRun) return { status: "skipped" as const };
    try {
      await ctx.runAction(internal.skills.scanSkillVersionStaticallyInternal, {
        skillId: args.skillId,
        versionId: args.versionId,
      });
      return await ctx.runMutation(internal.skillsShAdoption.finalizeStagedPromotionInternal, {
        adoptionId: args.adoptionId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = await ctx.runMutation(
        internal.skillsShAdoption.recordStagedStaticScanFailureInternal,
        {
          ...args,
          attempt: started.attempt,
          error: message,
        },
      );
      if (failure.retry) {
        await ctx.scheduler.runAfter(
          STAGED_STATIC_SCAN_RETRY_DELAY_MS * started.attempt,
          internal.skillsShAdoption.scanStagedVersionInternal,
          args,
        );
        return { status: "retry_scheduled" as const };
      }
      return { status: failure.canceled ? ("canceled" as const) : ("skipped" as const) };
    }
  },
});

export const finalizeStagedPromotionInternal = internalMutation({
  args: {
    adoptionId: v.id("skillsShAdoptions"),
  },
  handler: async (ctx, args) => {
    const adoption = await ctx.db.get(args.adoptionId);
    if (!adoption) throw new ConvexError("skills.sh adoption not found");
    if (adoption.status === "promoted") {
      return {
        status: adoption.status,
        skillId: adoption.promotedSkillId ?? null,
        versionId: adoption.promotedVersionId ?? null,
        canonicalRef: adoption.canonicalRef ?? null,
      };
    }
    if (
      adoption.status !== "ready_to_promote" ||
      !adoption.scanAttemptId ||
      !adoption.stagedSkillId ||
      !adoption.stagedVersionId
    ) {
      throw new ConvexError("skills.sh adoption has no staged promotion");
    }
    const [attempt, skill, version, publisher] = await Promise.all([
      ctx.db.get(adoption.scanAttemptId),
      ctx.db.get(adoption.stagedSkillId),
      ctx.db.get(adoption.stagedVersionId),
      ctx.db.get(adoption.publisherId),
    ]);
    const request =
      attempt?.skillScanRequestId !== undefined
        ? await ctx.db.get(attempt.skillScanRequestId)
        : null;
    if (!attempt || !request || !skill || !version || !publisher || !isPublisherActive(publisher)) {
      throw new ConvexError("skills.sh adoption staged promotion is unavailable");
    }
    if (
      version.skillId !== skill._id ||
      !versionMatchesAdoptionArtifact(version, adoption, attempt, request)
    ) {
      throw new ConvexError("skills.sh adoption staged version no longer matches the scan");
    }
    const staticStatus = version.staticScan?.status;
    if (staticStatus === "malicious") {
      const now = Date.now();
      const removedStaging = await removeAdoptionCreatedStaging(
        ctx,
        adoption,
        request,
        skill,
        version,
      );
      if (!removedStaging.removedVersion) {
        await ctx.db.patch(version._id, { publicationStatus: "blocked" });
        await restorePreviousPublishedVersion(ctx, skill, version);
      }
      await Promise.all([
        ctx.db.patch(request._id, {
          writtenBack: true,
          updatedAt: now,
        }),
        ctx.db.patch(adoption._id, {
          status: "rejected",
          stagedSkillId: undefined,
          stagedVersionId: undefined,
          stagedVersionCreated: undefined,
          rejectionReason: "static_scan_malicious",
          updatedAt: now,
        }),
      ]);
      return {
        status: "rejected" as const,
        skillId: removedStaging.removedSkill ? null : skill._id,
        versionId: removedStaging.removedVersion ? null : version._id,
        canonicalRef: null,
      };
    }
    if (staticStatus !== "clean" && staticStatus !== "suspicious") {
      throw new ConvexError("skills.sh adoption static scan is not complete");
    }

    const digest = adoption.mirrorDigestId ? await ctx.db.get(adoption.mirrorDigestId) : null;
    if (
      adoption.mirrorDigestId &&
      (!digest || digest.sourceContentHash !== adoption.sourceContentHash)
    ) {
      const now = Date.now();
      const removedStaging = await removeAdoptionCreatedStaging(
        ctx,
        adoption,
        request,
        skill,
        version,
      );
      if (!removedStaging.removedVersion && version.publicationStatus === "pending") {
        await ctx.db.patch(version._id, { publicationStatus: "blocked" });
      }
      await Promise.all([
        ctx.db.patch(request._id, {
          writtenBack: true,
          updatedAt: now,
        }),
        ctx.db.patch(adoption._id, {
          status: "stale",
          rejectionReason: "catalog_source_changed",
          updatedAt: now,
        }),
      ]);
      return {
        status: "stale" as const,
        skillId: removedStaging.removedSkill ? null : skill._id,
        versionId: removedStaging.removedVersion ? null : version._id,
        canonicalRef: null,
      };
    }

    const currentDestination =
      adoption.destinationKind === "replace"
        ? await classifyDestination(ctx, publisher, adoption.slug)
        : null;
    const destinationMatches =
      adoption.destinationKind === "create"
        ? skill.ownerPublisherId === publisher._id &&
          skill.slug === adoption.slug &&
          !skill.latestVersionId
        : skill._id === adoption.destinationSkillId &&
          currentDestination?.kind === "replace" &&
          currentDestination.fingerprint === adoption.destinationFingerprint;
    if (!destinationMatches) {
      const now = Date.now();
      const removedStaging = await removeAdoptionCreatedStaging(
        ctx,
        adoption,
        request,
        skill,
        version,
      );
      if (!removedStaging.removedVersion && version.publicationStatus === "pending") {
        await ctx.db.patch(version._id, { publicationStatus: "blocked" });
      }
      await Promise.all([
        ctx.db.patch(request._id, {
          writtenBack: true,
          updatedAt: now,
        }),
        ctx.db.patch(adoption._id, {
          status: "stale",
          rejectionReason: "destination_changed",
          updatedAt: now,
        }),
      ]);
      return {
        status: "stale" as const,
        skillId: removedStaging.removedSkill ? null : skill._id,
        versionId: removedStaging.removedVersion ? null : version._id,
        canonicalRef: null,
      };
    }

    const now = Date.now();
    const description = frontmatterDescription(version.parsed.frontmatter);
    const nextTags = { ...skill.tags, latest: version._id };
    const canonicalRef = `@${publisher.handle}/${adoption.slug}`;
    await ctx.db.patch(version._id, {
      publicationStatus: "published",
    });
    const skillPatch = {
      displayName: digest?.displayName ?? skill.displayName,
      summary: description ?? skill.summary,
      ...buildMirroredInferencePatch(digest, version._id),
      installKind: undefined,
      githubSourceId: undefined,
      githubPath: undefined,
      githubHasSkillCard: undefined,
      githubCurrentCommit: undefined,
      githubCurrentContentHash: undefined,
      githubCurrentStatus: undefined,
      githubCurrentCheckedAt: undefined,
      githubScanStatus: undefined,
      githubRemovedAt: undefined,
      latestVersionId: version._id,
      latestVersionSummary: {
        version: version.version,
        createdAt: version.createdAt,
        changelog: version.changelog,
        changelogSource: version.changelogSource,
        description,
      },
      tags: nextTags,
      moderationStatus: "active" as const,
      moderationReason: "skills-sh.adopted",
      moderationVerdict:
        adoption.scanVerdict === "clean" || adoption.scanVerdict === "suspicious"
          ? adoption.scanVerdict
          : undefined,
      moderationSourceVersionId: version._id,
      isSuspicious: adoption.scanVerdict === "suspicious" || staticStatus === "suspicious",
      statsSkillsShInstalls: digest?.upstreamInstalls ?? skill.statsSkillsShInstalls,
      stats: {
        ...skill.stats,
        versions: adoption.stagedVersionCreated ? skill.stats.versions + 1 : skill.stats.versions,
      },
      softDeletedAt: undefined,
      updatedAt: now,
    };
    await ctx.db.patch(skill._id, skillPatch);
    await Promise.all([
      ctx.db.patch(request._id, {
        ...(adoption.stagedVersionCreated ? { skillVersionId: version._id } : {}),
        writtenBack: true,
        updatedAt: now,
      }),
      ctx.db.patch(adoption._id, {
        status: "promoted",
        stagedSkillId: undefined,
        stagedVersionId: undefined,
        stagedVersionCreated: undefined,
        promotedSkillId: skill._id,
        promotedVersionId: version._id,
        canonicalRef,
        promotedAt: now,
        updatedAt: now,
      }),
      ctx.db.insert("auditLogs", {
        actorUserId: adoption.actorUserId,
        action: "skills_sh.adoption.promoted",
        targetType: "skillsShAdoption",
        targetId: adoption._id,
        metadata: {
          publisherId: adoption.publisherId,
          externalId: adoption.externalId,
          skillId: skill._id,
          versionId: version._id,
          canonicalRef,
          verdict: adoption.scanVerdict,
          staticScan: staticStatus,
        },
        createdAt: now,
      }),
    ]);
    return {
      status: "promoted" as const,
      skillId: skill._id,
      versionId: version._id,
      canonicalRef,
    };
  },
});

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
      await ctx.scheduler.runAfter(0, internal.skillsShAdoption.promoteReadyInternal, {
        adoptionId: adoption._id,
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

export const promoteReadyInternal = internalMutation({
  args: {
    adoptionId: v.id("skillsShAdoptions"),
  },
  handler: async (ctx, args) => {
    const adoption = await ctx.db.get(args.adoptionId);
    if (!adoption) throw new ConvexError("skills.sh adoption not found");
    if (adoption.status === "promoted") {
      return {
        status: adoption.status,
        skillId: adoption.promotedSkillId ?? null,
        versionId: adoption.promotedVersionId ?? null,
        canonicalRef: adoption.canonicalRef ?? null,
      };
    }
    if (adoption.stagedSkillId && adoption.stagedVersionId) {
      return {
        status: "ready_to_promote" as const,
        skillId: adoption.stagedSkillId,
        versionId: adoption.stagedVersionId,
        canonicalRef: null,
      };
    }
    if (!adoption.scanAttemptId) {
      throw new ConvexError("skills.sh adoption has no completed scan attempt");
    }
    const attempt = await ctx.db.get(adoption.scanAttemptId);
    const request =
      attempt?.skillScanRequestId !== undefined
        ? await ctx.db.get(attempt.skillScanRequestId)
        : null;
    if (!attempt || !request) {
      throw new ConvexError("skills.sh adoption scan artifact is unavailable");
    }
    return await stageAdoptionForStaticScan(ctx, adoption, attempt, request);
  },
});

export const getPromotedByExternalIdInternal = internalQuery({
  args: {
    externalId: v.string(),
  },
  handler: async (ctx, args) => {
    const adoption = await ctx.db
      .query("skillsShAdoptions")
      .withIndex("by_external_id_and_status", (q) =>
        q.eq("externalId", normalizeExternalId(args.externalId)).eq("status", "promoted"),
      )
      .order("desc")
      .first();
    if (!adoption) return null;
    const invalidated = {
      state: "invalidated" as const,
      externalId: adoption.externalId,
      reference: `skills-sh:${adoption.externalId}`,
    };
    if (!adoption.promotedSkillId || !adoption.promotedVersionId || !adoption.canonicalRef) {
      return invalidated;
    }
    const [skill, version, publisher] = await Promise.all([
      ctx.db.get(adoption.promotedSkillId),
      ctx.db.get(adoption.promotedVersionId),
      ctx.db.get(adoption.publisherId),
    ]);
    const staticScanAllowed =
      version?.staticScan?.status === "clean" || version?.staticScan?.status === "suspicious";
    const clawhubVerdict = version?.llmAnalysis?.verdict ?? version?.llmAnalysis?.status;
    const clawhubScanAllowed = clawhubVerdict === "clean" || clawhubVerdict === "suspicious";
    if (
      !skill ||
      skill.softDeletedAt ||
      !version ||
      version.softDeletedAt ||
      version.publicationStatus !== "published" ||
      version.skillId !== skill._id ||
      !staticScanAllowed ||
      !clawhubScanAllowed ||
      !publisher ||
      !isPublisherActive(publisher) ||
      skill.ownerPublisherId !== publisher._id
    ) {
      return invalidated;
    }
    return {
      state: "promoted" as const,
      externalId: adoption.externalId,
      reference: `skills-sh:${adoption.externalId}`,
      canonicalRef: adoption.canonicalRef,
      publisherHandle: publisher.handle,
      slug: skill.slug,
      skillId: skill._id,
      versionId: adoption.promotedVersionId,
      githubRepository: adoption.canonicalRepository ?? `${adoption.owner}/${adoption.repo}`,
      githubPath: adoption.githubPath,
      githubCommit: adoption.githubCommit,
      sourceContentHash: adoption.sourceContentHash,
      sourceUrl: adoption.sourceUrl ?? null,
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
