"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import type {
  CatalogClassificationActionResult,
  CatalogClassificationPageItem,
  CatalogClassificationPageResult,
  StoredCatalogClassificationInput,
} from "./catalogClassification";
import {
  prepareCatalogClassificationResult,
  type CatalogClassificationConfidence,
} from "./lib/catalogClassification";
import { classifyPlugin, classifySkill } from "./lib/catalogClassifier.mjs";

const DEFAULT_MAX_BATCHES = 1;
const MAX_MAX_BATCHES = 20;
const MAX_CLASSIFICATION_TEXT_LENGTH = 40_000;

function clampMaxBatches(value: number | undefined) {
  const integer = Number.isFinite(value) ? Math.floor(value ?? 0) : DEFAULT_MAX_BATCHES;
  return Math.max(1, Math.min(MAX_MAX_BATCHES, integer));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

async function readTextFiles(ctx: Pick<ActionCtx, "storage">, files: Array<{ storageId: never }>) {
  const chunks: string[] = [];
  for (const file of files) {
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) continue;
    chunks.push((await blob.text()).slice(0, MAX_CLASSIFICATION_TEXT_LENGTH));
    if (chunks.join("\n").length >= MAX_CLASSIFICATION_TEXT_LENGTH) break;
  }
  return chunks.join("\n").slice(0, MAX_CLASSIFICATION_TEXT_LENGTH);
}

async function classifySkillItem(
  ctx: Pick<ActionCtx, "storage">,
  item: Extract<CatalogClassificationPageItem, { kind: "skill" }>,
): Promise<StoredCatalogClassificationInput> {
  const storedText = item.textFile
    ? await readTextFiles(ctx, [{ storageId: item.textFile.storageId as never }])
    : "";
  const text =
    storedText ||
    `---\nname: ${item.displayName}\ndescription: ${item.summary ?? ""}\n---\n# ${item.displayName}`;
  return {
    targetKind: "skill",
    skillId: item.skillId,
    skillVersionId: item.skillVersionId,
    ...prepareCatalogClassificationResult(
      classifySkill({
        slug: item.slug,
        text,
        explicitCategories: item.categories,
        explicitTopics: item.topics,
      }),
    ),
  };
}

async function classifyPluginItem(
  ctx: Pick<ActionCtx, "storage">,
  item: Extract<CatalogClassificationPageItem, { kind: "plugin" }>,
): Promise<StoredCatalogClassificationInput> {
  const manifest = asRecord(item.pluginManifest);
  const packageJson = asRecord(item.packageJson);
  const bundleManifest = asRecord(item.bundleManifest);
  const fileText = await readTextFiles(
    ctx,
    item.textFiles.map((file) => ({ storageId: file.storageId as never })),
  );
  const packageKeywords = stringArray(packageJson.keywords);
  const primaryText = [
    item.displayName,
    item.summary,
    stringValue(manifest.description),
    stringValue(packageJson.description),
    stringValue(bundleManifest.description),
  ]
    .filter(Boolean)
    .join("\n");
  const text = [item.name, primaryText, packageKeywords.join(" "), fileText]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_CLASSIFICATION_TEXT_LENGTH);
  const topicText = [primaryText, fileText]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_CLASSIFICATION_TEXT_LENGTH);
  return {
    targetKind: "plugin",
    packageId: item.packageId,
    packageReleaseId: item.packageReleaseId,
    ...prepareCatalogClassificationResult(
      classifyPlugin({
        manifest,
        slug: item.name,
        text,
        topicText,
        topicTags: packageKeywords,
        explicitCategories: item.categories,
        explicitTopics: item.topics,
      }),
    ),
  };
}

function emptyConfidenceCounts(): Record<CatalogClassificationConfidence, number> {
  return { high: 0, medium: 0, low: 0 };
}

export async function classifyCatalogInternalHandler(
  ctx: ActionCtx,
  args: {
    targetKind: "skill" | "plugin";
    cursor?: string;
    batchSize?: number;
    maxBatches?: number;
    continueOnIncomplete?: boolean;
  },
): Promise<CatalogClassificationActionResult> {
  const maxBatches = clampMaxBatches(args.maxBatches);
  const confidence = emptyConfidenceCounts();
  const topicConfidence = emptyConfidenceCounts();
  let cursor = args.cursor ?? null;
  let isDone = false;
  let scanned = 0;
  let classified = 0;
  let skipped = 0;
  let failed = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const page: CatalogClassificationPageResult = await ctx.runQuery(
      internal.catalogClassification.getCatalogClassificationPageInternal,
      {
        targetKind: args.targetKind,
        cursor: cursor ?? undefined,
        batchSize: args.batchSize,
      },
    );
    scanned += page.items.length;
    const results: StoredCatalogClassificationInput[] = [];
    for (const item of page.items) {
      if (item.kind === "skip") {
        skipped += 1;
        continue;
      }
      try {
        const result =
          item.kind === "skill"
            ? await classifySkillItem(ctx, item)
            : await classifyPluginItem(ctx, item);
        results.push(result);
        confidence[result.categoryConfidence] += 1;
        topicConfidence[result.topicConfidence] += 1;
        classified += 1;
      } catch (error) {
        console.error("Catalog classification failed", {
          targetKind: args.targetKind,
          error: error instanceof Error ? error.message : String(error),
        });
        failed += 1;
      }
    }
    if (results.length > 0) {
      await ctx.runMutation(
        internal.catalogClassification.upsertCatalogClassificationResultsInternal,
        {
          results,
        },
      );
    }
    cursor = page.cursor;
    isDone = page.isDone;
    if (page.isDone) break;
  }

  const scheduledNext = !isDone && Boolean(args.continueOnIncomplete);
  if (scheduledNext) {
    await ctx.scheduler.runAfter(0, internal.catalogClassificationNode.classifyCatalogInternal, {
      ...args,
      cursor: cursor ?? undefined,
    });
  }

  return {
    ok: true,
    targetKind: args.targetKind,
    scanned,
    classified,
    skipped,
    failed,
    confidence,
    topicConfidence,
    cursor,
    isDone,
    scheduledNext,
  };
}

export const classifyCatalogInternal = internalAction({
  args: {
    targetKind: v.union(v.literal("skill"), v.literal("plugin")),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    continueOnIncomplete: v.optional(v.boolean()),
  },
  handler: classifyCatalogInternalHandler,
});
