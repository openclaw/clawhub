"use node";

import { gzipSync } from "node:zlib";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { action, internalAction } from "./functions";
import { readRedactedBundleFiles, readRedactedSkillMdContent } from "./lib/securityDatasetContent";
import { totalBundleBytes } from "./lib/securityDatasetRedaction";

const MAX_EXPORT_BATCH_PAGES = 20;
const MAX_REDACTED_BUNDLE_BYTES_PER_RESPONSE = 256 * 1024;

type ArtifactExportPage = {
  page: unknown[];
  isDone: boolean;
  continueCursor: string;
  exportMode: "public";
};

type DatasetLineage = {
  exportMode: "public";
  generatedAt: number;
  maxExportPageSize: number;
  maxExportBatchPages: number;
  redactionPolicyVersion: string;
  sourceTables: readonly string[];
  scannerSources: readonly string[];
  sourceBounds: Array<{
    sourceKind: "skill" | "package";
    minCreatedAt: number | null;
    maxCreatedAt: number | null;
  }>;
};

type ArtifactExportBatchArgs = {
  sourceKind: "skill" | "package";
  mode?: "public";
  createdAtGte?: number;
  createdAtLt?: number;
  paginationOpts: {
    cursor: string | null;
    numItems: number;
  };
  pageCount: number;
};

function assertDatasetExportWorkerToken(token: string) {
  // Shared worker credential already used by the security and Skill Card GitHub workers.
  const expected = process.env.SECURITY_SCAN_WORKER_TOKEN;
  if (!expected || token !== expected) throw new ConvexError("Unauthorized");
}

export const listArtifactExportBatchCompressedInternal = internalAction({
  args: {
    sourceKind: v.union(v.literal("skill"), v.literal("package")),
    mode: v.optional(v.literal("public")),
    createdAtGte: v.optional(v.number()),
    createdAtLt: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
    pageCount: v.number(),
  },
  handler: async (ctx, args) => listArtifactExportBatchCompressedForWorker(ctx, args),
});

export const listArtifactExportBatchCompressed = action({
  args: {
    token: v.string(),
    sourceKind: v.union(v.literal("skill"), v.literal("package")),
    mode: v.optional(v.literal("public")),
    createdAtGte: v.optional(v.number()),
    createdAtLt: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
    pageCount: v.number(),
  },
  handler: async (ctx, args) => {
    assertDatasetExportWorkerToken(args.token);
    return await listArtifactExportBatchCompressedForWorker(ctx, args);
  },
});

export const getDatasetLineage = action({
  args: {
    token: v.string(),
    mode: v.optional(v.literal("public")),
  },
  handler: async (ctx, args): Promise<DatasetLineage> => {
    assertDatasetExportWorkerToken(args.token);
    return await ctx.runQuery(internal.securityDataset.getDatasetLineageInternal, {
      mode: args.mode,
    });
  },
});

async function listArtifactExportBatchCompressedForWorker(
  ctx: ActionCtx,
  args: ArtifactExportBatchArgs,
) {
  const pageCount = Math.min(Math.max(1, Math.floor(args.pageCount)), MAX_EXPORT_BATCH_PAGES);
  let cursor = args.paginationOpts.cursor;
  const page: ArtifactExportPage["page"] = [];
  let isDone = false;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const result: ArtifactExportPage = await ctx.runQuery(
      internal.securityDataset.listArtifactExportPageInternal,
      {
        sourceKind: args.sourceKind,
        mode: args.mode,
        createdAtGte: args.createdAtGte,
        createdAtLt: args.createdAtLt,
        paginationOpts: {
          cursor,
          numItems: args.paginationOpts.numItems,
        },
      },
    );
    page.push(...result.page);
    cursor = result.continueCursor;
    isDone = result.isDone;
    if (isDone) break;
  }
  const json = JSON.stringify({
    page: await enrichAndSanitizeArtifactRows(ctx, page),
    isDone,
    continueCursor: cursor,
    exportMode: args.mode ?? "public",
  });
  return {
    encoding: "gzip-base64-json" as const,
    payload: gzipSync(json).toString("base64"),
  };
}

async function enrichAndSanitizeArtifactRows(ctx: ActionCtx, rows: unknown[]) {
  const enrichedRows = [];
  let remainingBundleBytes = MAX_REDACTED_BUNDLE_BYTES_PER_RESPONSE;
  for (const row of rows) {
    if (!isRecord(row)) {
      enrichedRows.push(row);
      continue;
    }
    const files = Array.isArray(row.files) ? row.files : [];
    const skillContent =
      row.sourceKind === "skill" ? await readRedactedSkillMdContent(ctx, files) : null;
    const bundleFiles =
      row.sourceKind === "skill"
        ? await readRedactedBundleFiles(ctx, files, remainingBundleBytes)
        : [];
    remainingBundleBytes -= totalBundleBytes(bundleFiles);
    enrichedRows.push({
      ...row,
      ...(skillContent ? { skillMdContentRedacted: skillContent } : {}),
      ...(bundleFiles.length > 0 ? { bundleFilesRedacted: bundleFiles } : {}),
      files: files.map((file) => {
        if (!isRecord(file)) return file;
        const { storageId: _storageId, ...rest } = file;
        return rest;
      }),
    });
  }
  return enrichedRows;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
