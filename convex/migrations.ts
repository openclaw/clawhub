import { Migrations, runToCompletion } from "@convex-dev/migrations";
import {
  normalizeInferredCatalogTopics,
  normalizePluginCategories,
  normalizeSkillCategories,
} from "clawhub-schema";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { syncPackageSearchDigestForPackageId } from "./functions";
import { derivePluginManifestSummary } from "./lib/packageRegistry";
import { adjustPublisherStatsForSkillChange } from "./lib/publisherStats";
import {
  buildSkillInstallBackfillPatch,
  INSTALL_BACKFILL_CLEAN_WINDOW,
  INSTALL_BACKFILL_CLEAN_WINDOW_READY_CURSOR_CREATION_TIME,
  INSTALL_BACKFILL_DEFAULTS,
} from "./lib/skillInstallBackfill";
import { syncSkillSearchDigestForSkill } from "./lib/skillSearchDigest";
import schema from "./schema";

const CANONICALIZE_CATALOG_METADATA_CONFIRM = "canonicalize-catalog-metadata";
const APPLY_SKILL_INSTALL_BACKFILL_CONFIRM = "apply-skill-install-backfill";
const BACKFILL_PLUGIN_MANIFEST_SUMMARIES_CONFIRM = "backfill-plugin-manifest-summaries";
const SKILL_STAT_EVENTS_CURSOR_KEY = "skill_stat_events";
const MAX_PENDING_SKILL_STAT_EVENTS_PER_SKILL = 1_000;
const PLUGIN_PACKAGE_FAMILIES = ["code-plugin", "bundle-plugin"] as const;
const PLUGIN_MANIFEST_SUMMARY_BACKFILL_PAGE_SIZE = 50;
const PLUGIN_MANIFEST_SUMMARY_BACKFILL_MAX_PACKAGES = 5_000;
const pluginPackageFamilyValidator = v.union(v.literal("code-plugin"), v.literal("bundle-plugin"));

export const migrations = new Migrations(components.migrations, {
  schema,
  defaultBatchSize: 25,
});

type CanonicalCatalogMetadataFields = Pick<
  Doc<"skills">,
  | "categories"
  | "topics"
  | "inferredCategories"
  | "inferredTopics"
  | "inferredCategoryConfidence"
  | "inferredTopicConfidence"
  | "inferredClassifierVersion"
  | "inferredTopicClassifierVersion"
  | "inferredInputHash"
  | "inferredTopicInputHash"
  | "inferredAt"
>;

function normalizeInferredCategories(
  categoryKind: "skill" | "plugin" | "none",
  values: readonly string[] | null | undefined,
) {
  if (categoryKind === "none") return [];
  try {
    return categoryKind === "skill"
      ? normalizeSkillCategories(values)
      : normalizePluginCategories(values);
  } catch {
    return [];
  }
}

export function buildCanonicalCatalogMetadataPatch(
  input: CanonicalCatalogMetadataFields & {
    categoryKind: "skill" | "plugin" | "none";
    currentSourceId?: string | null;
    inferredSourceId?: string | null;
    hasPublisherCatalogIntent?: boolean;
  },
): Partial<CanonicalCatalogMetadataFields> | null {
  const hasInferredCatalogState =
    input.inferredSourceId !== undefined ||
    input.inferredCategories !== undefined ||
    input.inferredTopics !== undefined ||
    input.inferredCategoryConfidence !== undefined ||
    input.inferredTopicConfidence !== undefined ||
    input.inferredClassifierVersion !== undefined ||
    input.inferredTopicClassifierVersion !== undefined ||
    input.inferredInputHash !== undefined ||
    input.inferredTopicInputHash !== undefined ||
    input.inferredAt !== undefined;
  if (!hasInferredCatalogState) return null;

  // Stale inference described an older artifact and must not become publisher-owned metadata.
  const inferenceCurrent =
    Boolean(input.currentSourceId) && input.currentSourceId === input.inferredSourceId;
  const inferredCategories =
    input.categories === undefined && !input.hasPublisherCatalogIntent && inferenceCurrent
      ? normalizeInferredCategories(input.categoryKind, input.inferredCategories)
      : [];
  const inferredTopics =
    input.topics === undefined && !input.hasPublisherCatalogIntent && inferenceCurrent
      ? normalizeInferredCatalogTopics(input.inferredTopics)
      : [];

  return {
    ...(inferredCategories.length > 0 ? { categories: inferredCategories } : {}),
    ...(inferredTopics.length > 0 ? { topics: inferredTopics } : {}),
    inferredCategories: undefined,
    inferredTopics: undefined,
    inferredCategoryConfidence: undefined,
    inferredTopicConfidence: undefined,
    inferredClassifierVersion: undefined,
    inferredTopicClassifierVersion: undefined,
    inferredInputHash: undefined,
    inferredTopicInputHash: undefined,
    inferredAt: undefined,
  };
}

async function hasPublisherCatalogIntent(
  ctx: Pick<MutationCtx, "db">,
  targetType: "skill" | "package",
  targetId: string,
  action: "skill.catalog_metadata.set" | "package.catalog_metadata.set",
): Promise<boolean> {
  // Historical explicit topic clears were stored as an absent field, so any settings save wins.
  const auditLog = await ctx.db
    .query("auditLogs")
    .withIndex("by_target_action", (q) =>
      q.eq("targetType", targetType).eq("targetId", targetId).eq("action", action),
    )
    .first();
  return auditLog !== null;
}

export const canonicalizeSkillCatalogMetadata = migrations.define({
  table: "skills",
  batchSize: 10,
  migrateOne: async (ctx, skill) => {
    const publisherCatalogIntent =
      skill.latestVersionId === skill.inferredFromVersionId &&
      ((skill.categories === undefined && Boolean(skill.inferredCategories?.length)) ||
        (skill.topics === undefined && Boolean(skill.inferredTopics?.length)))
        ? await hasPublisherCatalogIntent(ctx, "skill", skill._id, "skill.catalog_metadata.set")
        : false;
    const catalogPatch = buildCanonicalCatalogMetadataPatch({
      categoryKind: "skill",
      categories: skill.categories,
      topics: skill.topics,
      inferredCategories: skill.inferredCategories,
      inferredTopics: skill.inferredTopics,
      currentSourceId: skill.latestVersionId,
      inferredSourceId: skill.inferredFromVersionId,
      inferredCategoryConfidence: skill.inferredCategoryConfidence,
      inferredTopicConfidence: skill.inferredTopicConfidence,
      inferredClassifierVersion: skill.inferredClassifierVersion,
      inferredTopicClassifierVersion: skill.inferredTopicClassifierVersion,
      inferredInputHash: skill.inferredInputHash,
      inferredTopicInputHash: skill.inferredTopicInputHash,
      inferredAt: skill.inferredAt,
      hasPublisherCatalogIntent: publisherCatalogIntent,
    });
    if (!catalogPatch) return;

    const patch: Partial<Doc<"skills">> = {
      ...catalogPatch,
      inferredFromVersionId: undefined,
    };
    const nextSkill: Doc<"skills"> = { ...skill, ...patch };
    await ctx.db.patch(skill._id, patch);
    await syncSkillSearchDigestForSkill(ctx, nextSkill);
  },
});

export const canonicalizePackageCatalogMetadata = migrations.define({
  table: "packages",
  batchSize: 10,
  migrateOne: async (ctx, pkg) => {
    const publisherCatalogIntent =
      pkg.latestReleaseId === pkg.inferredFromReleaseId &&
      ((pkg.categories === undefined && Boolean(pkg.inferredCategories?.length)) ||
        (pkg.topics === undefined && Boolean(pkg.inferredTopics?.length)))
        ? await hasPublisherCatalogIntent(ctx, "package", pkg._id, "package.catalog_metadata.set")
        : false;
    const catalogPatch = buildCanonicalCatalogMetadataPatch({
      categoryKind: pkg.family === "skill" ? "none" : "plugin",
      categories: pkg.categories,
      topics: pkg.topics,
      inferredCategories: pkg.inferredCategories,
      inferredTopics: pkg.inferredTopics,
      currentSourceId: pkg.latestReleaseId,
      inferredSourceId: pkg.inferredFromReleaseId,
      inferredCategoryConfidence: pkg.inferredCategoryConfidence,
      inferredTopicConfidence: pkg.inferredTopicConfidence,
      inferredClassifierVersion: pkg.inferredClassifierVersion,
      inferredTopicClassifierVersion: pkg.inferredTopicClassifierVersion,
      inferredInputHash: pkg.inferredInputHash,
      inferredTopicInputHash: pkg.inferredTopicInputHash,
      inferredAt: pkg.inferredAt,
      hasPublisherCatalogIntent: publisherCatalogIntent,
    });
    if (!catalogPatch) return;

    const patch: Partial<Doc<"packages">> = {
      ...catalogPatch,
      inferredFromReleaseId: undefined,
    };
    await ctx.db.patch(pkg._id, patch);
    await syncPackageSearchDigestForPackageId(ctx, pkg._id);
  },
});

async function readSkillInstallCleanWindowStats(
  ctx: Pick<MutationCtx, "db">,
  skillId: Id<"skills">,
) {
  let downloads = 0;
  let installs = 0;
  for (
    let day = INSTALL_BACKFILL_CLEAN_WINDOW.startDay;
    day <= INSTALL_BACKFILL_CLEAN_WINDOW.endDay;
    day += 1
  ) {
    const stat = await ctx.db
      .query("skillDailyStats")
      .withIndex("by_skill_day", (q) => q.eq("skillId", skillId).eq("day", day))
      .unique();
    downloads += stat?.downloads ?? 0;
    installs += stat?.installs ?? 0;
  }
  return { downloads, installs };
}

async function readDailyStatsAppliedPendingSkillDocDeltas(
  ctx: Pick<MutationCtx, "db">,
  skillId: Id<"skills">,
  now: number,
) {
  const cursor = await ctx.db
    .query("skillStatUpdateCursors")
    .withIndex("by_key", (q) => q.eq("key", SKILL_STAT_EVENTS_CURSOR_KEY))
    .unique();
  const cursorCreationTime = cursor?.cursorCreationTime;
  if (cursorCreationTime === undefined) {
    throw new ConvexError(
      "Skill install backfill requires skill stat daily aggregation through the clean window before applying.",
    );
  }
  if (cursorCreationTime < INSTALL_BACKFILL_CLEAN_WINDOW_READY_CURSOR_CREATION_TIME) {
    if (now < INSTALL_BACKFILL_CLEAN_WINDOW_READY_CURSOR_CREATION_TIME) {
      throw new ConvexError(
        "Skill install backfill requires skill stat daily aggregation through the clean window before applying.",
      );
    }
    const nextEvent = await ctx.db
      .query("skillStatEvents")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", cursorCreationTime))
      .take(1);
    if (nextEvent.length > 0) {
      throw new ConvexError(
        "Skill install backfill requires skill stat daily aggregation through the clean window before applying.",
      );
    }
  }

  const pendingEvents = await ctx.db
    .query("skillStatEvents")
    .withIndex("by_skill_processed", (q) => q.eq("skillId", skillId).eq("processedAt", undefined))
    .take(MAX_PENDING_SKILL_STAT_EVENTS_PER_SKILL + 1);
  if (pendingEvents.length > MAX_PENDING_SKILL_STAT_EVENTS_PER_SKILL) {
    throw new ConvexError(
      "Skill install backfill requires draining skill stat doc sync before applying.",
    );
  }

  let downloads = 0;
  let installsAllTime = 0;
  for (const event of pendingEvents) {
    if (event._creationTime > cursorCreationTime) continue;
    if (event.kind === "download") {
      downloads += 1;
    } else if (event.kind === "install_new") {
      installsAllTime += 1;
    } else if (event.kind === "install_clear") {
      installsAllTime += event.delta?.allTime ?? 0;
    }
  }
  return { downloads, installsAllTime };
}

export async function backfillOneSkillInstallEstimate(
  ctx: Pick<MutationCtx, "db">,
  skill: Doc<"skills">,
  now: number = Date.now(),
) {
  const cleanStats = await readSkillInstallCleanWindowStats(ctx, skill._id);
  const pendingSkillDocDeltas = await readDailyStatsAppliedPendingSkillDocDeltas(
    ctx,
    skill._id,
    now,
  );
  const patch = buildSkillInstallBackfillPatch({
    skill,
    cleanStats,
    now,
    pendingSkillDocDownloads: pendingSkillDocDeltas.downloads,
    pendingSkillDocInstallsAllTime: pendingSkillDocDeltas.installsAllTime,
  });
  if (!patch) return false;

  const nextSkill: Doc<"skills"> = { ...skill, ...patch };
  await ctx.db.patch(skill._id, patch);
  // If pending stat events were already counted in daily stats, this writes the
  // temporary target-minus-pending value. The later doc-sync mutation uses the
  // trigger-wrapped internalMutation from ./functions, so its skill patch
  // resyncs publisher stats and search digests when those pending events land.
  await adjustPublisherStatsForSkillChange(ctx, skill, nextSkill);
  await syncSkillSearchDigestForSkill(ctx, nextSkill);
  return true;
}

export const backfillSkillInstallEstimates = migrations.define({
  table: "skills",
  batchSize: 10,
  migrateOne: async (ctx, skill) => {
    await backfillOneSkillInstallEstimate(ctx, skill);
  },
});

type PluginPackageFamily = (typeof PLUGIN_PACKAGE_FAMILIES)[number];

type LatestPluginManifestSummaryCandidate = {
  packageName: string;
  displayName: string;
  release: Doc<"packageReleases"> | null;
};

type LatestPluginManifestSummaryCandidatePage = {
  page: LatestPluginManifestSummaryCandidate[];
  isDone: boolean;
  continueCursor: string;
};

type PluginManifestSummaryBackfillSample = {
  packageName: string;
  displayName: string;
  version: string;
  releaseId: Id<"packageReleases">;
  configFieldCount: number;
  mcpServerCount: number;
  bundledSkillCount: number;
};

type PluginManifestSummaryBackfillResult = {
  ok: true;
  dryRun: boolean;
  confirmRequired?: string;
  scannedPackages: number;
  eligibleReleases: number;
  changedReleases: number;
  patchedReleases: number;
  unchangedReleases: number;
  skippedMissingRelease: number;
  skippedMissingManifest: number;
  skippedSkillMarkdownReadErrorReleases: number;
  skillMarkdownReadErrors: number;
  samples: PluginManifestSummaryBackfillSample[];
};

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSkillMarkdownPath(path: string) {
  const lowerPath = path.toLowerCase();
  return lowerPath === "skill.md" || lowerPath.endsWith("/skill.md");
}

function isPluginManifestPath(path: string) {
  return path.toLowerCase() === "openclaw.plugin.json";
}

async function readStorageText(ctx: Pick<ActionCtx, "storage">, storageId: string) {
  const blob = await ctx.storage.get(storageId as never);
  if (!blob) throw new ConvexError("Uploaded file no longer exists");
  return await blob.text();
}

async function readStoredPluginManifestForBackfill(
  ctx: Pick<ActionCtx, "storage">,
  files: Doc<"packageReleases">["files"],
) {
  const manifestFile = files.find((file) => isPluginManifestPath(file.path));
  if (!manifestFile) return null;
  try {
    const text = await readStorageText(ctx, manifestFile.storageId);
    const parsed: unknown = JSON.parse(text);
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function resolvePluginManifestForSummaryBackfill(
  ctx: Pick<ActionCtx, "storage">,
  release: Doc<"packageReleases">,
) {
  if (isJsonRecord(release.extractedPluginManifest)) return release.extractedPluginManifest;
  return await readStoredPluginManifestForBackfill(ctx, release.files);
}

async function withSkillMarkdownTextsForPluginManifestSummaryBackfill(
  ctx: Pick<ActionCtx, "storage">,
  files: Doc<"packageReleases">["files"],
) {
  let readErrors = 0;
  const nextFiles = await Promise.all(
    files.map(async (file) => {
      if (!isSkillMarkdownPath(file.path)) return file;
      try {
        return {
          ...file,
          text: await readStorageText(ctx, file.storageId),
        };
      } catch {
        readErrors += 1;
        return file;
      }
    }),
  );
  return { files: nextFiles, readErrors };
}

function hasSamePluginManifestSummary(
  release: Doc<"packageReleases">,
  pluginManifestSummary: unknown,
) {
  return (
    JSON.stringify(release.pluginManifestSummary ?? null) === JSON.stringify(pluginManifestSummary)
  );
}

export const listLatestPluginManifestSummaryBackfillCandidates = internalQuery({
  args: {
    family: v.union(v.literal("code-plugin"), v.literal("bundle-plugin")),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.object({
    page: v.array(
      v.object({
        packageName: v.string(),
        displayName: v.string(),
        release: v.union(v.any(), v.null()),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const numItems = Math.max(1, Math.min(100, Math.floor(args.limit)));
    const page = await ctx.db
      .query("packages")
      .withIndex("by_active_family_recommended_score", (q) =>
        q.eq("softDeletedAt", undefined).eq("family", args.family),
      )
      .paginate({ cursor: args.cursor, numItems });
    const candidates = await Promise.all(
      page.page.map(async (pkg) => ({
        packageName: pkg.normalizedName,
        displayName: pkg.displayName,
        release: pkg.latestReleaseId ? await ctx.db.get(pkg.latestReleaseId) : null,
      })),
    );
    return {
      page: candidates,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const applyPluginManifestSummaryBackfillPatch = internalMutation({
  args: {
    releaseId: v.id("packageReleases"),
    pluginManifestSummary: v.any(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const release = await ctx.db.get(args.releaseId);
    if (!release || release.softDeletedAt !== undefined) return false;
    await ctx.db.patch(args.releaseId, {
      pluginManifestSummary: args.pluginManifestSummary,
    });
    return true;
  },
});

async function backfillLatestPluginManifestSummariesForFamily(
  ctx: Pick<ActionCtx, "runMutation" | "runQuery" | "storage">,
  family: PluginPackageFamily,
  dryRun: boolean,
  maxPackages: number,
) {
  let cursor: string | null = null;
  let scannedPackages = 0;
  let eligibleReleases = 0;
  let changedReleases = 0;
  let patchedReleases = 0;
  let unchangedReleases = 0;
  let skippedMissingRelease = 0;
  let skippedMissingManifest = 0;
  let skippedSkillMarkdownReadErrorReleases = 0;
  let skillMarkdownReadErrors = 0;
  const samples: PluginManifestSummaryBackfillSample[] = [];

  while (scannedPackages < maxPackages) {
    const page: LatestPluginManifestSummaryCandidatePage = await ctx.runQuery(
      internal.migrations.listLatestPluginManifestSummaryBackfillCandidates,
      {
        family,
        cursor,
        limit: Math.min(PLUGIN_MANIFEST_SUMMARY_BACKFILL_PAGE_SIZE, maxPackages - scannedPackages),
      },
    );

    for (const candidate of page.page) {
      scannedPackages += 1;
      if (!candidate.release || candidate.release.softDeletedAt !== undefined) {
        skippedMissingRelease += 1;
        continue;
      }

      const pluginManifest = await resolvePluginManifestForSummaryBackfill(ctx, candidate.release);
      if (!isJsonRecord(pluginManifest)) {
        skippedMissingManifest += 1;
        continue;
      }

      eligibleReleases += 1;
      const filesResult = await withSkillMarkdownTextsForPluginManifestSummaryBackfill(
        ctx,
        candidate.release.files,
      );
      skillMarkdownReadErrors += filesResult.readErrors;
      if (filesResult.readErrors > 0) {
        skippedSkillMarkdownReadErrorReleases += 1;
        continue;
      }
      const summary = derivePluginManifestSummary({
        pluginManifest,
        ...(isJsonRecord(candidate.release.normalizedBundleManifest)
          ? { skillManifest: candidate.release.normalizedBundleManifest }
          : {}),
        compatibility: candidate.release.compatibility,
        files: filesResult.files,
      });
      if (hasSamePluginManifestSummary(candidate.release, summary)) {
        unchangedReleases += 1;
        continue;
      }

      changedReleases += 1;
      if (!dryRun) {
        const patched: boolean = await ctx.runMutation(
          internal.migrations.applyPluginManifestSummaryBackfillPatch,
          {
            releaseId: candidate.release._id,
            pluginManifestSummary: summary,
          },
        );
        if (patched) patchedReleases += 1;
      }
      if (samples.length < 10) {
        samples.push({
          packageName: candidate.packageName,
          displayName: candidate.displayName,
          version: candidate.release.version,
          releaseId: candidate.release._id,
          configFieldCount: summary.configFields.length,
          mcpServerCount: summary.mcpServers.length,
          bundledSkillCount: summary.bundledSkills.length,
        });
      }
    }

    if (page.isDone || scannedPackages >= maxPackages) break;
    cursor = page.continueCursor;
  }

  return {
    scannedPackages,
    eligibleReleases,
    changedReleases,
    patchedReleases,
    unchangedReleases,
    skippedMissingRelease,
    skippedMissingManifest,
    skippedSkillMarkdownReadErrorReleases,
    skillMarkdownReadErrors,
    samples,
  };
}

export const runPluginManifestSummaryBackfill = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    confirm: v.optional(v.string()),
    maxPackages: v.optional(v.number()),
  },
  returns: v.object({
    ok: v.literal(true),
    dryRun: v.boolean(),
    confirmRequired: v.optional(v.string()),
    scannedPackages: v.number(),
    eligibleReleases: v.number(),
    changedReleases: v.number(),
    patchedReleases: v.number(),
    unchangedReleases: v.number(),
    skippedMissingRelease: v.number(),
    skippedMissingManifest: v.number(),
    skippedSkillMarkdownReadErrorReleases: v.number(),
    skillMarkdownReadErrors: v.number(),
    samples: v.array(
      v.object({
        packageName: v.string(),
        displayName: v.string(),
        version: v.string(),
        releaseId: v.id("packageReleases"),
        configFieldCount: v.number(),
        mcpServerCount: v.number(),
        bundledSkillCount: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args): Promise<PluginManifestSummaryBackfillResult> => {
    const dryRun = args.dryRun !== false;
    if (!dryRun && args.confirm !== BACKFILL_PLUGIN_MANIFEST_SUMMARIES_CONFIRM) {
      throw new ConvexError(
        `Pass confirm="${BACKFILL_PLUGIN_MANIFEST_SUMMARIES_CONFIRM}" to apply.`,
      );
    }

    const maxPackages = Math.max(
      1,
      Math.min(
        PLUGIN_MANIFEST_SUMMARY_BACKFILL_MAX_PACKAGES,
        Math.floor(args.maxPackages ?? PLUGIN_MANIFEST_SUMMARY_BACKFILL_MAX_PACKAGES),
      ),
    );
    const totals: PluginManifestSummaryBackfillResult = {
      ok: true,
      dryRun,
      confirmRequired: dryRun ? BACKFILL_PLUGIN_MANIFEST_SUMMARIES_CONFIRM : undefined,
      scannedPackages: 0,
      eligibleReleases: 0,
      changedReleases: 0,
      patchedReleases: 0,
      unchangedReleases: 0,
      skippedMissingRelease: 0,
      skippedMissingManifest: 0,
      skippedSkillMarkdownReadErrorReleases: 0,
      skillMarkdownReadErrors: 0,
      samples: [],
    };

    for (const family of PLUGIN_PACKAGE_FAMILIES) {
      const result = await backfillLatestPluginManifestSummariesForFamily(
        ctx,
        family,
        dryRun,
        maxPackages - totals.scannedPackages,
      );
      totals.scannedPackages += result.scannedPackages;
      totals.eligibleReleases += result.eligibleReleases;
      totals.changedReleases += result.changedReleases;
      totals.patchedReleases += result.patchedReleases;
      totals.unchangedReleases += result.unchangedReleases;
      totals.skippedMissingRelease += result.skippedMissingRelease;
      totals.skippedMissingManifest += result.skippedMissingManifest;
      totals.skippedSkillMarkdownReadErrorReleases += result.skippedSkillMarkdownReadErrorReleases;
      totals.skillMarkdownReadErrors += result.skillMarkdownReadErrors;
      totals.samples.push(...result.samples.slice(0, 10 - totals.samples.length));
      if (totals.scannedPackages >= maxPackages) break;
    }

    return totals;
  },
});

export const runPluginManifestSummaryBackfillPage = internalAction({
  args: {
    family: pluginPackageFamilyValidator,
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    confirm: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.literal(true),
    dryRun: v.boolean(),
    confirmRequired: v.optional(v.string()),
    family: pluginPackageFamilyValidator,
    continueCursor: v.string(),
    isDone: v.boolean(),
    scannedPackages: v.number(),
    eligibleReleases: v.number(),
    changedReleases: v.number(),
    patchedReleases: v.number(),
    unchangedReleases: v.number(),
    skippedMissingRelease: v.number(),
    skippedMissingManifest: v.number(),
    skippedSkillMarkdownReadErrorReleases: v.number(),
    skillMarkdownReadErrors: v.number(),
    samples: v.array(
      v.object({
        packageName: v.string(),
        displayName: v.string(),
        version: v.string(),
        releaseId: v.id("packageReleases"),
        configFieldCount: v.number(),
        mcpServerCount: v.number(),
        bundledSkillCount: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false;
    if (!dryRun && args.confirm !== BACKFILL_PLUGIN_MANIFEST_SUMMARIES_CONFIRM) {
      throw new ConvexError(
        `Pass confirm="${BACKFILL_PLUGIN_MANIFEST_SUMMARIES_CONFIRM}" to apply.`,
      );
    }

    const limit = Math.max(
      1,
      Math.min(
        PLUGIN_MANIFEST_SUMMARY_BACKFILL_PAGE_SIZE,
        Math.floor(args.limit ?? PLUGIN_MANIFEST_SUMMARY_BACKFILL_PAGE_SIZE),
      ),
    );
    const page: LatestPluginManifestSummaryCandidatePage = await ctx.runQuery(
      internal.migrations.listLatestPluginManifestSummaryBackfillCandidates,
      {
        family: args.family,
        cursor: args.cursor ?? null,
        limit,
      },
    );

    let eligibleReleases = 0;
    let changedReleases = 0;
    let patchedReleases = 0;
    let unchangedReleases = 0;
    let skippedMissingRelease = 0;
    let skippedMissingManifest = 0;
    let skippedSkillMarkdownReadErrorReleases = 0;
    let skillMarkdownReadErrors = 0;
    const samples: PluginManifestSummaryBackfillSample[] = [];

    for (const candidate of page.page) {
      if (!candidate.release || candidate.release.softDeletedAt !== undefined) {
        skippedMissingRelease += 1;
        continue;
      }

      const pluginManifest = await resolvePluginManifestForSummaryBackfill(ctx, candidate.release);
      if (!isJsonRecord(pluginManifest)) {
        skippedMissingManifest += 1;
        continue;
      }

      eligibleReleases += 1;
      const filesResult = await withSkillMarkdownTextsForPluginManifestSummaryBackfill(
        ctx,
        candidate.release.files,
      );
      skillMarkdownReadErrors += filesResult.readErrors;
      if (filesResult.readErrors > 0) {
        skippedSkillMarkdownReadErrorReleases += 1;
        continue;
      }

      const summary = derivePluginManifestSummary({
        pluginManifest,
        ...(isJsonRecord(candidate.release.normalizedBundleManifest)
          ? { skillManifest: candidate.release.normalizedBundleManifest }
          : {}),
        compatibility: candidate.release.compatibility,
        files: filesResult.files,
      });
      if (hasSamePluginManifestSummary(candidate.release, summary)) {
        unchangedReleases += 1;
        continue;
      }

      changedReleases += 1;
      if (!dryRun) {
        const patched: boolean = await ctx.runMutation(
          internal.migrations.applyPluginManifestSummaryBackfillPatch,
          {
            releaseId: candidate.release._id,
            pluginManifestSummary: summary,
          },
        );
        if (patched) patchedReleases += 1;
      }
      if (samples.length < 10) {
        samples.push({
          packageName: candidate.packageName,
          displayName: candidate.displayName,
          version: candidate.release.version,
          releaseId: candidate.release._id,
          configFieldCount: summary.configFields.length,
          mcpServerCount: summary.mcpServers.length,
          bundledSkillCount: summary.bundledSkills.length,
        });
      }
    }

    return {
      ok: true as const,
      dryRun,
      confirmRequired: dryRun ? BACKFILL_PLUGIN_MANIFEST_SUMMARIES_CONFIRM : undefined,
      family: args.family,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      scannedPackages: page.page.length,
      eligibleReleases,
      changedReleases,
      patchedReleases,
      unchangedReleases,
      skippedMissingRelease,
      skippedMissingManifest,
      skippedSkillMarkdownReadErrorReleases,
      skillMarkdownReadErrors,
      samples,
    };
  },
});

export const run = migrations.runner();

export const runCatalogMetadataCanonicalization = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    confirm: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.literal(true),
    dryRun: v.boolean(),
    confirmRequired: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false;
    if (!dryRun && args.confirm !== CANONICALIZE_CATALOG_METADATA_CONFIRM) {
      throw new ConvexError(`Pass confirm="${CANONICALIZE_CATALOG_METADATA_CONFIRM}" to apply.`);
    }
    if (dryRun) {
      for (const fn of [
        "migrations:canonicalizeSkillCatalogMetadata",
        "migrations:canonicalizePackageCatalogMetadata",
      ]) {
        await ctx.runMutation(internal.migrations.run, {
          fn,
          dryRun: true,
          reset: true,
        });
      }
    } else {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.migrations.canonicalizeSkillCatalogMetadata,
      );
      await runToCompletion(
        ctx,
        components.migrations,
        internal.migrations.canonicalizePackageCatalogMetadata,
      );
    }
    return {
      ok: true as const,
      dryRun,
      confirmRequired: dryRun ? CANONICALIZE_CATALOG_METADATA_CONFIRM : undefined,
    };
  },
});

export const runSkillInstallBackfill = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    confirm: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.literal(true),
    dryRun: v.boolean(),
    confirmRequired: v.optional(v.string()),
    model: v.object({
      cleanWindowStartDay: v.number(),
      cleanWindowEndDay: v.number(),
      globalCleanDownloads: v.number(),
      globalCleanInstalls: v.number(),
      priorDownloads: v.number(),
      minimumCleanDownloads: v.number(),
      maxSmoothedRate: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false;
    if (!dryRun && args.confirm !== APPLY_SKILL_INSTALL_BACKFILL_CONFIRM) {
      throw new ConvexError(`Pass confirm="${APPLY_SKILL_INSTALL_BACKFILL_CONFIRM}" to apply.`);
    }
    if (dryRun) {
      await ctx.runMutation(internal.migrations.run, {
        fn: "migrations:backfillSkillInstallEstimates",
        dryRun: true,
        reset: true,
      });
    } else {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.migrations.backfillSkillInstallEstimates,
      );
    }
    return {
      ok: true as const,
      dryRun,
      confirmRequired: dryRun ? APPLY_SKILL_INSTALL_BACKFILL_CONFIRM : undefined,
      model: {
        cleanWindowStartDay: INSTALL_BACKFILL_CLEAN_WINDOW.startDay,
        cleanWindowEndDay: INSTALL_BACKFILL_CLEAN_WINDOW.endDay,
        ...INSTALL_BACKFILL_DEFAULTS,
      },
    };
  },
});
