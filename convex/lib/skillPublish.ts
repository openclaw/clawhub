import {
  normalizeCatalogTopics,
  normalizeSkillCategories,
  normalizeTextContentType,
  resolveSkillCategories,
} from "clawhub-schema";
import { ConvexError } from "convex/values";
import semver from "semver";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { getSkillBadgeMap, isSkillHighlighted } from "./badges";
import { generateChangelogForPublish } from "./changelog";
import { generateEmbedding } from "./embeddings";
import { requireGitHubAccountAge } from "./githubAccount";
import type { PublicUser } from "./public";
import {
  findOversizedPublishFile,
  getPublishFileSizeError,
  getPublishTotalSizeError,
  MAX_PUBLISH_TOTAL_BYTES,
} from "./publishLimits";
import { isSkillCardPath } from "./skillCards";
import {
  computeQualitySignals,
  evaluateQuality,
  getTrustTier,
  type QualityAssessment,
  toStructuralFingerprint,
} from "./skillQuality";
import {
  buildEmbeddingText,
  getFrontmatterMetadata,
  getFrontmatterValue,
  hashSkillFiles,
  isMacJunkPath,
  isTextFile,
  parseClawdisMetadata,
  parseFrontmatter,
  sanitizePath,
} from "./skills";
import { assertValidSkillSlug, normalizeSkillSlug } from "./skillSlugValidator";
import { generateSkillSummary } from "./skillSummary";
import { runStaticPublishScan } from "./staticPublishScan";
import { getWebhookConfig, type WebhookSkillPayload } from "./webhooks";

const MAX_FILES_FOR_EMBEDDING = 40;
const QUALITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const QUALITY_ACTIVITY_LIMIT = 60;
const PLATFORM_SKILL_LICENSE = "MIT-0" as const;
const SECURITY_SCAN_ENQUEUE_BACKUP_DELAY_MS = 15_000;
const MAX_PUBLISH_SUMMARY_LENGTH = 300;

type FingerprintFile = { path: string; sha256: string };
type SafePublishFile = PublishVersionArgs["files"][number] & { path: string };
type PublishFileBlob = { file: SafePublishFile; blob: Blob };
type DeferredAiEnrichment = {
  summary: {
    mode: "generate" | "literal";
    literal?: string;
    currentSummary?: string;
  };
  changelog: {
    source: "auto" | "user";
    supplied: string;
  };
};

function normalizeStoredSkillCategoryOverride(categories: readonly string[] | undefined) {
  if (categories === undefined) return undefined;
  try {
    return normalizeSkillCategories(categories);
  } catch {
    return undefined;
  }
}

export type PublishResult = {
  skillId: Id<"skills">;
  versionId: Id<"skillVersions">;
  embeddingId: Id<"skillEmbeddings">;
};

export type PendingPublishResult = {
  status: "pending";
  attemptId: Id<"publishAttempts">;
  slug: string;
  version: string;
};

type SkillPublishFollowup = {
  skipWebhook?: boolean;
  ownerHandle?: string;
  slug: string;
  version: string;
  displayName: string;
};

export type SkillPublishResult = PublishResult | PendingPublishResult;

export type PublishVersionArgs = {
  slug: string;
  displayName: string;
  version: string;
  changelog: string;
  tags?: string[];
  categories?: string[];
  topics?: string[];
  summary?: string;
  forkOf?: { slug: string; ownerHandle?: string; version?: string };
  source?: {
    kind: "github";
    url: string;
    repo: string;
    ref: string;
    commit: string;
    path: string;
    importedAt: number;
  };
  files: Array<{
    path: string;
    size: number;
    storageId: Id<"_storage">;
    sha256: string;
    contentType?: string;
  }>;
};

export type PublishOptions = {
  bypassGitHubAccountAge?: boolean;
  bypassNewSkillRateLimit?: boolean;
  bypassQualityGate?: boolean;
  skipWebhook?: boolean;
  ownerHandle?: string;
  ownerPublisherId?: Id<"publishers">;
  sourceOwnerPublisherId?: Id<"publishers">;
  sourceProvenance?: PublishVersionArgs["source"];
  // Explicit opt-in to owner migration. The `insertVersion` mutation refuses
  // to rewrite a skill's `ownerPublisherId` unless this is `true`, so default
  // publishes (including older CLIs that never pass this flag) can never
  // accidentally transfer ownership.
  migrateOwner?: boolean;
  stagePrePublicationChecks?: boolean;
};

type InternalPublishOptions = PublishOptions;

export async function publishVersionForUser(
  ctx: ActionCtx,
  userId: Id<"users">,
  args: PublishVersionArgs,
  options: PublishOptions = {},
): Promise<SkillPublishResult> {
  return await publishVersionForUserInternal(ctx, userId, args, {
    ...options,
    stagePrePublicationChecks:
      options.stagePrePublicationChecks ?? stagedPrePublicationPublishesEnabled(),
  });
}

export async function stageSkillPublishAttemptForUser(
  ctx: ActionCtx,
  userId: Id<"users">,
  args: PublishVersionArgs,
  options: PublishOptions & { stagePrePublicationChecks?: boolean } = {},
): Promise<SkillPublishResult> {
  return await publishVersionForUserInternal(ctx, userId, args, {
    ...options,
    stagePrePublicationChecks: options.stagePrePublicationChecks ?? true,
  });
}

function stagedPrePublicationPublishesEnabled() {
  return process.env.CLAWHUB_STAGED_PREPUBLICATION_PUBLISHES === "1";
}

async function publishVersionForUserInternal(
  ctx: ActionCtx,
  userId: Id<"users">,
  args: PublishVersionArgs,
  options: InternalPublishOptions,
): Promise<SkillPublishResult> {
  const version = args.version.trim();
  // Normalize first so we can look up the existing skill before deciding
  // how strictly to validate. The reserved-word blocklist and length floor
  // are only enforced for brand-new skills; owners of grandfathered slugs
  // (reserved, <3 chars, or >48 chars) must still be able to publish new
  // versions without being blocked by the write-path validator.
  const normalizedSlug = normalizeSkillSlug(args.slug);
  if (!normalizedSlug) throw new ConvexError("Slug is required.");

  const displayName = args.displayName.trim();
  if (!displayName) throw new ConvexError("Display name required");
  if (!semver.valid(version)) {
    throw new ConvexError("Version must be valid semver");
  }

  if (!options.bypassGitHubAccountAge) {
    await requireGitHubAccountAge(ctx, userId);
  }
  const existingSkill = (await ctx.runQuery(internal.skills.getSkillForPublishPreflightInternal, {
    userId,
    slug: normalizedSlug,
    ownerPublisherId: options.ownerPublisherId,
    sourceOwnerPublisherId: options.sourceOwnerPublisherId,
    migrateOwner: options.migrateOwner,
  })) as Doc<"skills"> | null;
  if (options.stagePrePublicationChecks && existingSkill && !existingSkill.softDeletedAt) {
    const existingVersion = (await ctx.runQuery(
      internal.skills.getVersionBySkillAndVersionInternal,
      {
        skillId: existingSkill._id,
        version,
      },
    )) as Doc<"skillVersions"> | null;
    if (existingVersion) {
      throw new ConvexError(
        `Version ${version} already exists. Increment the version number and try again.`,
      );
    }
  }
  const isNewSkill = !existingSkill;

  // For new skills, enforce the full write-path rules (length, pattern,
  // reserved-word blocklist). For existing skills the slug is already
  // persisted and grandfathered — re-validating it would block legitimate
  // version publishes on legacy rows.
  if (isNewSkill) {
    assertValidSkillSlug(normalizedSlug);
  }
  const slug = normalizedSlug;

  const suppliedChangelog = args.changelog.trim();
  const changelogSource = suppliedChangelog ? ("user" as const) : ("auto" as const);

  const sanitizedFiles = args.files.map((file) => ({
    ...file,
    path: sanitizePath(file.path),
    contentType: normalizeTextContentType(file.path, file.contentType),
  }));
  if (sanitizedFiles.some((file) => !file.path)) {
    throw new ConvexError("Invalid file paths");
  }
  const safeFiles = sanitizedFiles.map((file) => ({
    ...file,
    path: file.path as string,
  }));
  const publishFilesWithCallerMetadata = safeFiles.filter((file) => !isMacJunkPath(file.path));
  if (publishFilesWithCallerMetadata.some((file) => isSkillCardPath(file.path))) {
    throw new ConvexError("skill-card.md is generated by ClawHub and cannot be published directly");
  }

  const publishFiles = await derivePublishFilesFromStorage(ctx, publishFilesWithCallerMetadata);

  const readmeFile = publishFiles.find(
    (file) => file.path?.toLowerCase() === "skill.md" || file.path?.toLowerCase() === "skills.md",
  );
  if (!readmeFile) throw new ConvexError("SKILL.md is required");

  const readmeText = await fetchText(ctx, readmeFile.storageId);
  const frontmatter = parseFrontmatter(readmeText);
  const clawdis = parseClawdisMetadata(frontmatter);
  const owner = (await ctx.runQuery(internal.users.getByIdInternal, {
    userId,
  })) as Doc<"users"> | null;
  const ownerCreatedAt = owner?.createdAt ?? owner?._creationTime ?? Date.now();
  const now = Date.now();
  const frontmatterMetadata = getFrontmatterMetadata(frontmatter);
  // Check for description in metadata.description (nested) or description (direct frontmatter field)
  const metadataDescription =
    frontmatterMetadata &&
    typeof frontmatterMetadata === "object" &&
    !Array.isArray(frontmatterMetadata) &&
    typeof (frontmatterMetadata as Record<string, unknown>).description === "string"
      ? ((frontmatterMetadata as Record<string, unknown>).description as string)
      : undefined;
  const directDescription = getFrontmatterValue(frontmatter, "description");
  // Prioritize the new description from frontmatter over the existing skill summary
  // This ensures updates to the description are reflected on subsequent publishes (#301)
  const summaryFromFrontmatter = metadataDescription ?? directDescription;
  const explicitSummary = args.summary?.trim();
  if (explicitSummary && explicitSummary.length > MAX_PUBLISH_SUMMARY_LENGTH) {
    throw new ConvexError(`Summary must be ${MAX_PUBLISH_SUMMARY_LENGTH} characters or less`);
  }
  const shouldDeferAiEnrichment = options.stagePrePublicationChecks === true;
  const summary =
    explicitSummary ||
    (shouldDeferAiEnrichment
      ? (summaryFromFrontmatter ?? existingSkill?.summary ?? "")
      : await generateSkillSummary({
          slug,
          displayName,
          readmeText,
          currentSummary: summaryFromFrontmatter ?? existingSkill?.summary ?? undefined,
        }));

  let qualityAssessment: QualityAssessment | null = null;
  if (isNewSkill && !options.bypassQualityGate) {
    const ownerActivity = (await ctx.runQuery(internal.skills.getOwnerSkillActivityInternal, {
      ownerUserId: userId,
      limit: QUALITY_ACTIVITY_LIMIT,
    })) as Array<{
      slug: string;
      summary?: string;
      createdAt: number;
      latestVersionId?: Id<"skillVersions">;
    }>;

    const trustTier = getTrustTier(now - ownerCreatedAt, ownerActivity.length);
    const qualitySignals = computeQualitySignals({
      readmeText,
      summary,
    });
    const recentCandidates = ownerActivity.filter(
      (entry) =>
        entry.slug !== slug && entry.createdAt >= now - QUALITY_WINDOW_MS && entry.latestVersionId,
    );
    let similarRecentCount = 0;
    for (const entry of recentCandidates) {
      const recentVersion = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
        versionId: entry.latestVersionId as Id<"skillVersions">,
      })) as Doc<"skillVersions"> | null;
      if (!recentVersion) continue;
      const candidateReadmeFile = recentVersion.files.find((file) => {
        const lower = file.path.toLowerCase();
        return lower === "skill.md" || lower === "skills.md";
      });
      if (!candidateReadmeFile) continue;
      const candidateText = await fetchText(ctx, candidateReadmeFile.storageId);
      if (toStructuralFingerprint(candidateText) === qualitySignals.structuralFingerprint) {
        similarRecentCount += 1;
      }
    }

    qualityAssessment = evaluateQuality({
      signals: qualitySignals,
      trustTier,
      similarRecentCount,
    });
    if (qualityAssessment.decision === "reject") {
      throw new ConvexError(qualityAssessment.reason);
    }
  }

  const metadata = mergeSourceIntoMetadata(frontmatterMetadata, args.source, qualityAssessment);

  const fileContents: Array<{ path: string; content: string }> = [
    { path: readmeFile.path, content: readmeText },
  ];
  for (const file of publishFiles) {
    if (!file.path || file.storageId === readmeFile.storageId) continue;
    if (!isTextFile(file.path, file.contentType ?? undefined)) continue;
    const content = await fetchText(ctx, file.storageId);
    fileContents.push({ path: file.path, content });
  }

  const otherFiles = fileContents
    .filter((file) => !file.path.toLowerCase().endsWith(".md"))
    .slice(0, MAX_FILES_FOR_EMBEDDING);
  let categories: string[];
  let topics: string[];
  try {
    categories = resolveSkillCategories({
      declared: args.categories ?? normalizeStoredSkillCategoryOverride(existingSkill?.categories),
    });
    topics = normalizeCatalogTopics(args.topics ?? existingSkill?.topics);
  } catch (error) {
    throw new ConvexError(error instanceof Error ? error.message : "Invalid catalog metadata");
  }

  const staticScan = await runStaticPublishScan(ctx, {
    slug,
    displayName,
    summary,
    frontmatter,
    metadata,
    files: publishFiles,
  });

  const embeddingText = buildEmbeddingText({
    frontmatter,
    readme: readmeText,
    otherFiles,
  });
  const fingerprintPromise = buildPublishSourceFingerprint(
    publishFiles.map((file) => ({ path: file.path, sha256: file.sha256 })),
  );

  const changelogPromise =
    changelogSource === "user" || shouldDeferAiEnrichment
      ? Promise.resolve(suppliedChangelog)
      : generateChangelogForPublish(ctx, {
          slug,
          version,
          readmeText,
          files: publishFiles.map((file) => ({ path: file.path, sha256: file.sha256 })),
        });

  const embeddingPromise = shouldDeferAiEnrichment
    ? Promise.resolve([] as number[])
    : generateEmbedding(embeddingText);

  const [fingerprint, changelogText, embedding] = await Promise.all([
    fingerprintPromise,
    changelogPromise,
    embeddingPromise.catch((error) => {
      throw new ConvexError(formatEmbeddingError(error));
    }),
  ]);

  const skillInsertArgs = {
    userId,
    ownerPublisherId: options.ownerPublisherId,
    sourceOwnerPublisherId: options.sourceOwnerPublisherId,
    migrateOwner: options.migrateOwner,
    slug,
    displayName,
    version,
    changelog: changelogText,
    changelogSource,
    sourceProvenance: options.sourceProvenance,
    tags: args.tags?.map((tag) => tag.trim()).filter(Boolean),
    categories,
    topics: topics.length ? topics : undefined,
    fingerprint,
    forkOf: args.forkOf
      ? {
          slug: args.forkOf.slug.trim().toLowerCase(),
          ownerHandle: args.forkOf.ownerHandle?.trim().replace(/^@+/, "") || undefined,
          version: args.forkOf.version?.trim() || undefined,
        }
      : undefined,
    bypassNewSkillRateLimit: options.bypassNewSkillRateLimit || undefined,
    files: publishFiles.map((file) => ({
      ...file,
      path: file.path,
    })),
    parsed: {
      frontmatter,
      metadata,
      clawdis,
      license: PLATFORM_SKILL_LICENSE,
    },
    summary,
    staticScan,
    embedding,
    deferredAiEnrichment: shouldDeferAiEnrichment
      ? ({
          summary: explicitSummary
            ? { mode: "literal", literal: explicitSummary }
            : {
                mode: "generate",
                currentSummary: summaryFromFrontmatter ?? existingSkill?.summary ?? undefined,
              },
          changelog: {
            source: changelogSource,
            supplied: suppliedChangelog,
          },
        } satisfies DeferredAiEnrichment)
      : undefined,
    qualityAssessment: qualityAssessment
      ? {
          decision: qualityAssessment.decision,
          score: qualityAssessment.score,
          reason: qualityAssessment.reason,
          trustTier: qualityAssessment.trustTier,
          similarRecentCount: qualityAssessment.similarRecentCount,
          signals: qualityAssessment.signals,
        }
      : undefined,
  };

  let ownerHandle = options.ownerHandle;
  if (!ownerHandle && options.ownerPublisherId !== undefined) {
    const targetPublisher = (await ctx.runQuery(internal.publishers.getByIdInternal, {
      publisherId: options.ownerPublisherId,
    })) as Doc<"publishers"> | null;
    ownerHandle = targetPublisher?.handle;
  }
  ownerHandle ??= owner?.handle ?? owner?.displayName ?? owner?.name;

  const followup = {
    skipWebhook: options.skipWebhook || undefined,
    ownerHandle,
    slug,
    version,
    displayName,
  };

  if (!options.stagePrePublicationChecks) {
    const publishResult = (await ctx.runMutation(
      internal.skills.insertVersion,
      skillInsertArgs,
    )) as PublishResult;
    await scheduleSkillPublishFollowups(ctx, publishResult, followup);
    return publishResult;
  }

  const staged = (await ctx.runMutation(
    internal.publishAttempts.createSkillPublishAttemptInternal,
    {
      userId,
      ownerPublisherId: options.ownerPublisherId,
      sourceOwnerPublisherId: options.sourceOwnerPublisherId,
      slug,
      displayName,
      version,
      idempotencyKey: buildSkillPublishAttemptIdempotencyKey({
        userId,
        ownerPublisherId: options.ownerPublisherId,
        slug,
        version,
        fingerprint,
      }),
      artifactFingerprint: fingerprint,
      files: publishFiles.map((file) => ({
        ...file,
        path: file.path,
      })),
      skillInsertArgs: stripUndefinedForStoredAttempt(skillInsertArgs),
      followup: {
        skipWebhook: followup.skipWebhook,
        ownerHandle,
      },
    },
  )) as {
    attemptId: Id<"publishAttempts">;
    status: string;
    result?: PublishResult;
  };

  if (staged.status === "finalized" && staged.result) {
    return staged.result;
  }

  return { status: "pending", attemptId: staged.attemptId, slug, version };
}

export async function finalizeSkillPublishAttempt(
  ctx: ActionCtx,
  attemptId: Id<"publishAttempts">,
): Promise<PublishResult> {
  const claimId = buildFinalizationClaimId();
  const claim = (await ctx.runMutation(
    internal.publishAttempts.claimSkillPublishAttemptForFinalizationInternal,
    { attemptId, claimId },
  )) as
    | {
        status: "claimed";
        attemptId: Id<"publishAttempts">;
        skillInsertArgs: unknown;
        followup: SkillPublishFollowup;
      }
    | {
        status: "finalized";
        attemptId: Id<"publishAttempts">;
        result: PublishResult;
        followup: SkillPublishFollowup;
      };

  if (claim.status === "finalized") {
    return claim.result;
  }

  let publishResult: PublishResult;
  try {
    const skillInsertArgs = await prepareSkillInsertArgsForFinalization(ctx, claim.skillInsertArgs);
    publishResult = (await ctx.runMutation(
      internal.skills.insertVersion,
      skillInsertArgs as never,
    )) as PublishResult;
  } catch (error) {
    const existingResult = (await ctx.runQuery(
      internal.publishAttempts.findSkillPublishAttemptPublicResultInternal,
      { attemptId: claim.attemptId },
    )) as PublishResult | null;
    if (!existingResult) {
      await releaseSkillPublishAttemptFinalizationClaim(ctx, claim.attemptId, claimId, error);
      throw error;
    }
    publishResult = existingResult;
  }

  try {
    await scheduleSkillPublishFollowups(ctx, publishResult, claim.followup);

    await ctx.runMutation(internal.publishAttempts.recordSkillPublishAttemptFinalizedInternal, {
      attemptId: claim.attemptId,
      claimId,
      result: publishResult,
    });
  } catch (error) {
    await releaseSkillPublishAttemptFinalizationClaim(ctx, claim.attemptId, claimId, error);
    throw error;
  }

  return publishResult;
}

async function prepareSkillInsertArgsForFinalization(
  ctx: ActionCtx,
  rawInsertArgs: unknown,
): Promise<unknown> {
  if (!rawInsertArgs || typeof rawInsertArgs !== "object" || Array.isArray(rawInsertArgs)) {
    return rawInsertArgs;
  }
  const insertArgs = rawInsertArgs as Record<string, unknown>;
  const deferred = insertArgs.deferredAiEnrichment as DeferredAiEnrichment | undefined;
  if (!deferred) return rawInsertArgs;

  const { deferredAiEnrichment: _deferredAiEnrichment, ...prepared } = insertArgs;
  const files = Array.isArray(prepared.files)
    ? (prepared.files as Array<{
        path?: unknown;
        storageId?: unknown;
        contentType?: unknown;
        sha256?: unknown;
      }>)
    : [];
  const readmeFile = files.find((file) => {
    const path = typeof file.path === "string" ? file.path.toLowerCase() : "";
    return path === "skill.md" || path === "skills.md";
  });
  if (!readmeFile?.storageId || typeof readmeFile.storageId !== "string") {
    throw new ConvexError("SKILL.md is required");
  }

  const readmeText = await fetchText(ctx, readmeFile.storageId as Id<"_storage">);
  const frontmatter = parseFrontmatter(readmeText);
  const otherFiles: Array<{ path: string; content: string }> = [];
  for (const file of files) {
    if (file === readmeFile || typeof file.path !== "string") continue;
    if (
      !isTextFile(file.path, typeof file.contentType === "string" ? file.contentType : undefined)
    ) {
      continue;
    }
    if (!file.storageId || typeof file.storageId !== "string") continue;
    const content = await fetchText(ctx, file.storageId as Id<"_storage">);
    otherFiles.push({ path: file.path, content });
    if (otherFiles.length >= MAX_FILES_FOR_EMBEDDING) break;
  }

  const summary =
    deferred.summary.mode === "literal"
      ? (deferred.summary.literal ?? "")
      : await generateSkillSummary({
          slug: stringField(prepared, "slug"),
          displayName: stringField(prepared, "displayName"),
          readmeText,
          currentSummary: deferred.summary.currentSummary,
        });
  const changelog =
    deferred.changelog.source === "user"
      ? deferred.changelog.supplied
      : await generateChangelogForPublish(ctx, {
          slug: stringField(prepared, "slug"),
          version: stringField(prepared, "version"),
          readmeText,
          files: files
            .filter(
              (file): file is { path: string; sha256: string } =>
                typeof file.path === "string" && typeof file.sha256 === "string",
            )
            .map((file) => ({ path: file.path, sha256: file.sha256 })),
        });
  const embeddingText = buildEmbeddingText({
    frontmatter,
    readme: readmeText,
    otherFiles,
  });
  const embedding = await generateEmbedding(embeddingText).catch((error) => {
    throw new ConvexError(formatEmbeddingError(error));
  });

  return {
    ...prepared,
    summary,
    changelog,
    embedding,
  };
}

function stringField(record: Record<string, unknown>, field: string) {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

async function releaseSkillPublishAttemptFinalizationClaim(
  ctx: ActionCtx,
  attemptId: Id<"publishAttempts">,
  claimId: string,
  error: unknown,
) {
  await ctx.runMutation(
    internal.publishAttempts.releaseSkillPublishAttemptFinalizationClaimInternal,
    {
      attemptId,
      claimId,
      error: formatPublishAttemptFinalizationError(error),
    },
  );
}

async function scheduleSkillPublishFollowups(
  ctx: ActionCtx,
  publishResult: PublishResult,
  followup: SkillPublishFollowup,
) {
  await ctx.scheduler.runAfter(0, internal.vt.scanWithVirusTotal, {
    versionId: publishResult.versionId,
  });

  await ctx.scheduler.runAfter(0, internal.securityScan.enqueueSkillVersionScanInternal, {
    versionId: publishResult.versionId,
    source: "publish",
  });
  await ctx.scheduler.runAfter(2_000, internal.securityScan.enqueueSkillVersionScanInternal, {
    versionId: publishResult.versionId,
    source: "publish",
    preserveActiveJob: true,
    preserveExistingJob: true,
  });
  await ctx.scheduler.runAfter(
    SECURITY_SCAN_ENQUEUE_BACKUP_DELAY_MS,
    internal.securityScan.enqueueSkillVersionScanInternal,
    {
      versionId: publishResult.versionId,
      source: "publish",
      preserveActiveJob: true,
      preserveExistingJob: true,
    },
  );

  if (!followup.skipWebhook && getWebhookConfig().url) {
    void schedulePublishWebhook(ctx, {
      slug: followup.slug,
      version: followup.version,
      displayName: followup.displayName,
      ownerHandle: followup.ownerHandle,
    });
  }
}

function mergeSourceIntoMetadata(
  metadata: unknown,
  source: PublishVersionArgs["source"],
  qualityAssessment: QualityAssessment | null = null,
) {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};

  if (source) {
    base.source = {
      kind: source.kind,
      url: source.url,
      repo: source.repo,
      ref: source.ref,
      commit: source.commit,
      path: source.path,
      importedAt: source.importedAt,
    };
  }

  if (qualityAssessment) {
    base._clawhubQuality = {
      score: qualityAssessment.score,
      decision: qualityAssessment.decision,
      trustTier: qualityAssessment.trustTier,
      similarRecentCount: qualityAssessment.similarRecentCount,
      signals: qualityAssessment.signals,
      reason: qualityAssessment.reason,
      evaluatedAt: Date.now(),
    };
  }

  return Object.keys(base).length ? base : undefined;
}

function buildSkillPublishAttemptIdempotencyKey(args: {
  userId: Id<"users">;
  ownerPublisherId?: Id<"publishers">;
  slug: string;
  version: string;
  fingerprint: string;
}) {
  const ownerScope = args.ownerPublisherId
    ? `publisher:${args.ownerPublisherId}`
    : `user:${args.userId}`;
  return ["skill", ownerScope, args.slug, args.version, args.fingerprint].join(":");
}

function stripUndefinedForStoredAttempt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefinedForStoredAttempt);
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested !== undefined) result[key] = stripUndefinedForStoredAttempt(nested);
  }
  return result;
}

function buildFinalizationClaimId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

async function buildPublishSourceFingerprint(files: FingerprintFile[]) {
  return await hashSkillFiles(files.filter((file) => !isSkillCardPath(file.path)));
}

export const __test = {
  buildPublishSourceFingerprint,
  mergeSourceIntoMetadata,
  computeQualitySignals,
  evaluateQuality,
  toStructuralFingerprint,
  derivePublishFilesFromStorage,
  buildSkillPublishAttemptIdempotencyKey,
};

export async function queueHighlightedWebhook(ctx: MutationCtx, skillId: Id<"skills">) {
  const skill = await ctx.db.get(skillId);
  if (!skill) return;
  const owner = await ctx.db.get(skill.ownerUserId);
  const latestVersion = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;

  const badges = await getSkillBadgeMap(ctx, skillId);
  const payload: WebhookSkillPayload = {
    slug: skill.slug,
    displayName: skill.displayName,
    summary: skill.summary ?? undefined,
    version: latestVersion?.version ?? undefined,
    ownerHandle: owner?.handle ?? owner?.name ?? undefined,
    highlighted: isSkillHighlighted({ badges }),
    tags: Object.keys(skill.tags ?? {}),
  };

  await ctx.scheduler.runAfter(0, internal.webhooks.sendDiscordWebhook, {
    event: "skill.highlighted",
    skill: payload,
  });
}

export async function fetchText(
  ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null> } },
  storageId: Id<"_storage">,
) {
  const blob = await ctx.storage.get(storageId);
  if (!blob) throw new Error("File missing in storage");
  return blob.text();
}

async function loadPublishFileBlobs(
  ctx: Pick<ActionCtx, "storage">,
  files: SafePublishFile[],
): Promise<PublishFileBlob[]> {
  const filesWithBlobs: PublishFileBlob[] = [];
  for (const file of files) {
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) throw new ConvexError("File missing in storage");
    const storedContentType = blob.type || file.contentType;
    const contentType = normalizeTextContentType(file.path, storedContentType) ?? storedContentType;
    filesWithBlobs.push({
      blob,
      file: {
        ...file,
        size: blob.size,
        contentType,
      },
    });
  }
  return filesWithBlobs;
}

async function derivePublishFilesFromStorage(
  ctx: Pick<ActionCtx, "storage">,
  files: SafePublishFile[],
) {
  const publishFileBlobs = await loadPublishFileBlobs(ctx, files);
  const publishFilesWithStorageMetadata = publishFileBlobs.map(({ file }) => file);
  if (
    publishFilesWithStorageMetadata.some(
      (file) => !isTextFile(file.path, file.contentType ?? undefined),
    )
  ) {
    throw new ConvexError("Only text-based files are allowed");
  }

  const oversizedFile = findOversizedPublishFile(publishFilesWithStorageMetadata);
  if (oversizedFile) {
    throw new ConvexError(getPublishFileSizeError(oversizedFile.path));
  }

  const totalBytes = publishFilesWithStorageMetadata.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_PUBLISH_TOTAL_BYTES) {
    throw new ConvexError(getPublishTotalSizeError("skill bundle"));
  }

  return await hashStoredPublishFiles(publishFileBlobs);
}

async function hashStoredPublishFiles(filesWithBlobs: PublishFileBlob[]) {
  const publishFiles: SafePublishFile[] = [];
  for (const { file, blob } of filesWithBlobs) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    publishFiles.push({
      ...file,
      sha256: await sha256Hex(bytes),
    });
  }
  return publishFiles;
}

async function sha256Hex(bytes: Uint8Array) {
  const data = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array) {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function formatEmbeddingError(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes("OPENAI_API_KEY")) {
      return "OPENAI_API_KEY is not configured.";
    }
    if (error.message.startsWith("Embedding failed")) {
      return error.message;
    }
  }
  return "Embedding failed. Please try again.";
}

function formatPublishAttemptFinalizationError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

async function schedulePublishWebhook(
  ctx: ActionCtx,
  params: { slug: string; version: string; displayName: string; ownerHandle?: string },
) {
  const result = (await ctx.runQuery(api.skills.getBySlug, {
    slug: params.slug,
    ownerHandle: params.ownerHandle,
  })) as { skill: Doc<"skills">; owner: PublicUser | null } | null;
  if (!result?.skill) return;

  const payload: WebhookSkillPayload = {
    slug: result.skill.slug,
    displayName: result.skill.displayName || params.displayName,
    summary: result.skill.summary ?? undefined,
    version: params.version,
    ownerHandle: result.owner?.handle ?? result.owner?.name ?? undefined,
    highlighted: isSkillHighlighted(result.skill),
    tags: Object.keys(result.skill.tags ?? {}),
  };

  await ctx.scheduler.runAfter(0, internal.webhooks.sendDiscordWebhook, {
    event: "skill.publish",
    skill: payload,
  });
}
