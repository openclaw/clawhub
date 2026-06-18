import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { assertRole, requireUserFromAction } from "./lib/access";
import type {
  CatalogClassificationConfidence,
  CatalogClassifierResult,
} from "./lib/catalogClassification";

const DEFAULT_CLASSIFICATION_BATCH_SIZE = 10;
const MAX_CLASSIFICATION_BATCH_SIZE = 25;
const MAX_STATIC_TEXT_FILE_SIZE = 512_000;
const MAX_PLUGIN_TEXT_FILES = 8;

const targetKindValidator = v.union(v.literal("skill"), v.literal("plugin"));
const confidenceValidator = v.union(v.literal("high"), v.literal("medium"), v.literal("low"));
const categoryCandidateValidator = v.object({
  category: v.string(),
  score: v.number(),
  sources: v.array(v.string()),
  evidence: v.array(v.string()),
  strongEvidence: v.optional(v.boolean()),
  primaryEvidence: v.optional(v.boolean()),
  strongPrimaryEvidence: v.optional(v.boolean()),
  primaryEvidenceCount: v.optional(v.number()),
});
const topicCandidateValidator = v.object({
  topic: v.string(),
  slug: v.string(),
  score: v.number(),
  sources: v.array(v.string()),
  evidence: v.array(v.string()),
  primaryEvidence: v.boolean(),
  primarySourceCount: v.number(),
  strongEvidence: v.boolean(),
  confidence: confidenceValidator,
  suppressedBy: v.optional(v.string()),
});

const classificationResultInputValidator = v.object({
  targetKind: targetKindValidator,
  skillId: v.optional(v.id("skills")),
  packageId: v.optional(v.id("packages")),
  skillVersionId: v.optional(v.id("skillVersions")),
  packageReleaseId: v.optional(v.id("packageReleases")),
  categories: v.array(v.string()),
  topics: v.array(v.string()),
  categoryCandidates: v.array(categoryCandidateValidator),
  topicCandidates: v.array(topicCandidateValidator),
  categoryCandidateCount: v.number(),
  topicCandidateCount: v.number(),
  categoryConfidence: confidenceValidator,
  topicConfidence: confidenceValidator,
  categoryNeedsReview: v.boolean(),
  topicNeedsReview: v.boolean(),
  unknownSignals: v.array(v.string()),
  classifierVersion: v.string(),
  topicClassifierVersion: v.string(),
  inputHash: v.string(),
  topicInputHash: v.string(),
});

type CatalogTextFile = {
  path: string;
  storageId: Id<"_storage">;
};

export type CatalogClassificationPageItem =
  | {
      kind: "skill";
      skillId: Id<"skills">;
      skillVersionId: Id<"skillVersions">;
      slug: string;
      displayName: string;
      summary?: string;
      categories?: string[];
      topics?: string[];
      textFile?: CatalogTextFile;
    }
  | {
      kind: "plugin";
      packageId: Id<"packages">;
      packageReleaseId: Id<"packageReleases">;
      name: string;
      displayName: string;
      summary?: string;
      categories?: string[];
      topics?: string[];
      pluginManifest?: unknown;
      packageJson?: unknown;
      bundleManifest?: unknown;
      textFiles: CatalogTextFile[];
    }
  | {
      kind: "skip";
      targetKind: "skill" | "plugin";
      reason: "soft-deleted" | "not-plugin" | "missing-latest-version" | "missing-latest-release";
    };

export type CatalogClassificationPageResult = {
  items: CatalogClassificationPageItem[];
  cursor: string | null;
  isDone: boolean;
};

export type CatalogClassificationActionResult = {
  ok: true;
  targetKind: "skill" | "plugin";
  scanned: number;
  classified: number;
  skipped: number;
  failed: number;
  confidence: Record<CatalogClassificationConfidence, number>;
  topicConfidence: Record<CatalogClassificationConfidence, number>;
  cursor: string | null;
  isDone: boolean;
  scheduledNext: boolean;
};

function clampBatchSize(value: number | undefined) {
  const integer = Number.isFinite(value)
    ? Math.floor(value ?? 0)
    : DEFAULT_CLASSIFICATION_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_CLASSIFICATION_BATCH_SIZE, integer));
}

function findSkillTextFile(version: Doc<"skillVersions">): CatalogTextFile | undefined {
  const file = version.files.find((candidate) => {
    const path = candidate.path.toLowerCase();
    return (
      candidate.size <= MAX_STATIC_TEXT_FILE_SIZE &&
      (path === "skill.md" || path === "skills.md" || path.endsWith("/skill.md"))
    );
  });
  return file ? { path: file.path, storageId: file.storageId } : undefined;
}

function findPluginTextFiles(release: Doc<"packageReleases">): CatalogTextFile[] {
  return release.files
    .filter((file) => {
      if (file.size > MAX_STATIC_TEXT_FILE_SIZE) return false;
      const name = file.path.split("/").at(-1)?.toLowerCase();
      return name === "readme.md" || name === "skill.md" || name === "skills.md";
    })
    .slice(0, MAX_PLUGIN_TEXT_FILES)
    .map((file) => ({ path: file.path, storageId: file.storageId }));
}

async function getSkillClassificationPage(
  ctx: Pick<QueryCtx, "db">,
  cursor: string | undefined,
  batchSize: number,
): Promise<CatalogClassificationPageResult> {
  const { page, isDone, continueCursor } = await ctx.db
    .query("skills")
    .order("asc")
    .paginate({ cursor: cursor ?? null, numItems: batchSize });
  const items: CatalogClassificationPageItem[] = [];
  for (const skill of page) {
    if (skill.softDeletedAt) {
      items.push({ kind: "skip", targetKind: "skill", reason: "soft-deleted" });
      continue;
    }
    if (!skill.latestVersionId) {
      items.push({ kind: "skip", targetKind: "skill", reason: "missing-latest-version" });
      continue;
    }
    const version = await ctx.db.get(skill.latestVersionId);
    if (!version || version.softDeletedAt || version.skillId !== skill._id) {
      items.push({ kind: "skip", targetKind: "skill", reason: "missing-latest-version" });
      continue;
    }
    items.push({
      kind: "skill",
      skillId: skill._id,
      skillVersionId: version._id,
      slug: skill.slug,
      displayName: skill.displayName,
      summary: skill.summary,
      categories: skill.categories,
      topics: skill.topics,
      textFile: findSkillTextFile(version),
    });
  }
  return { items, cursor: continueCursor, isDone };
}

async function getPluginClassificationPage(
  ctx: Pick<QueryCtx, "db">,
  cursor: string | undefined,
  batchSize: number,
): Promise<CatalogClassificationPageResult> {
  const { page, isDone, continueCursor } = await ctx.db
    .query("packages")
    .order("asc")
    .paginate({ cursor: cursor ?? null, numItems: batchSize });
  const items: CatalogClassificationPageItem[] = [];
  for (const pkg of page) {
    if (pkg.family === "skill") {
      items.push({ kind: "skip", targetKind: "plugin", reason: "not-plugin" });
      continue;
    }
    if (pkg.softDeletedAt) {
      items.push({ kind: "skip", targetKind: "plugin", reason: "soft-deleted" });
      continue;
    }
    if (!pkg.latestReleaseId) {
      items.push({ kind: "skip", targetKind: "plugin", reason: "missing-latest-release" });
      continue;
    }
    const release = await ctx.db.get(pkg.latestReleaseId);
    if (!release || release.softDeletedAt || release.packageId !== pkg._id) {
      items.push({ kind: "skip", targetKind: "plugin", reason: "missing-latest-release" });
      continue;
    }
    items.push({
      kind: "plugin",
      packageId: pkg._id,
      packageReleaseId: release._id,
      name: pkg.name,
      displayName: pkg.displayName,
      summary: pkg.summary,
      categories: pkg.categories,
      topics: pkg.topics,
      pluginManifest: release.extractedPluginManifest,
      packageJson: release.extractedPackageJson,
      bundleManifest: release.normalizedBundleManifest,
      textFiles: findPluginTextFiles(release),
    });
  }
  return { items, cursor: continueCursor, isDone };
}

export async function getCatalogClassificationPageInternalHandler(
  ctx: Pick<QueryCtx, "db">,
  args: {
    targetKind: "skill" | "plugin";
    cursor?: string;
    batchSize?: number;
  },
): Promise<CatalogClassificationPageResult> {
  const batchSize = clampBatchSize(args.batchSize);
  return args.targetKind === "skill"
    ? getSkillClassificationPage(ctx, args.cursor, batchSize)
    : getPluginClassificationPage(ctx, args.cursor, batchSize);
}

export const getCatalogClassificationPageInternal = internalQuery({
  args: {
    targetKind: targetKindValidator,
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: getCatalogClassificationPageInternalHandler,
});

export const upsertCatalogClassificationResultsInternal = internalMutation({
  args: { results: v.array(classificationResultInputValidator) },
  returns: v.object({ ok: v.literal(true), upserted: v.number() }),
  handler: async (ctx, args) => {
    const classifiedAt = Date.now();
    for (const result of args.results) {
      const isSkill = result.targetKind === "skill";
      if (
        (isSkill && (!result.skillId || !result.skillVersionId || result.packageId)) ||
        (!isSkill && (!result.packageId || !result.packageReleaseId || result.skillId))
      ) {
        throw new ConvexError("Catalog classification result target is inconsistent");
      }
      const existing = isSkill
        ? await ctx.db
            .query("catalogClassificationResults")
            .withIndex("by_skill", (q) => q.eq("skillId", result.skillId))
            .unique()
        : await ctx.db
            .query("catalogClassificationResults")
            .withIndex("by_package", (q) => q.eq("packageId", result.packageId))
            .unique();
      const value = {
        ...result,
        applyStatus: "preview" as const,
        error: undefined,
        classifiedAt,
        appliedAt: undefined,
      };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert("catalogClassificationResults", value);
    }
    return { ok: true as const, upserted: args.results.length };
  },
});

export const classifyCatalog: ReturnType<typeof action> = action({
  args: {
    targetKind: targetKindValidator,
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    continueOnIncomplete: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CatalogClassificationActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(internal.catalogClassificationNode.classifyCatalogInternal, args);
  },
});

export type StoredCatalogClassificationInput = ReturnType<
  typeof import("./lib/catalogClassification").prepareCatalogClassificationResult
> & {
  targetKind: "skill" | "plugin";
  skillId?: Id<"skills">;
  packageId?: Id<"packages">;
  skillVersionId?: Id<"skillVersions">;
  packageReleaseId?: Id<"packageReleases">;
};

export type CatalogClassifierFunctionResult = CatalogClassifierResult;
