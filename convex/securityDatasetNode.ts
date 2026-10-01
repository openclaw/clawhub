"use node";

import { gzipSync } from "node:zlib";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { action, internalAction } from "./functions";

const MAX_EXPORT_BATCH_PAGES = 20;
const MAX_REDACTED_BUNDLE_FILE_BYTES = 192 * 1024;
const MAX_REDACTED_BUNDLE_BYTES_PER_ARTIFACT = 256 * 1024;
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

const SECRET_PATTERNS: RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:api[_-]?key|token|secret|password|passwd|pwd|authorization code|auth code)\s*[:=]\s*["']?[^"',\s;)`]{6,}/gi,
  /\b(?:authorization|x-api-key)\s*[:=]\s*["']?(?:bearer|basic)?\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----/g,
  /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@[^\s)'"`]+/gi,
  /(["'`])(?=[A-Za-z0-9+/=_-]{32,}\1)(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9+/=_-]+\1/g,
];

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

async function readRedactedBundleFiles(
  ctx: Pick<ActionCtx, "storage">,
  files: unknown[],
  remainingResponseBytes: number,
) {
  const bundleFiles: Array<{ path: string; content: string }> = [];
  let remainingArtifactBytes = Math.min(
    remainingResponseBytes,
    MAX_REDACTED_BUNDLE_BYTES_PER_ARTIFACT,
  );
  for (const file of files) {
    if (
      !isRecord(file) ||
      typeof file.path !== "string" ||
      typeof file.storageId !== "string" ||
      isExcludedSkillBundlePath(file.path)
    ) {
      continue;
    }
    if (typeof file.size === "number" && file.size > MAX_REDACTED_BUNDLE_FILE_BYTES) continue;
    if (remainingArtifactBytes <= 0) break;
    const blob = await ctx.storage.get(file.storageId as never);
    if (!blob) continue;
    const content = redactBundleContent(await blob.text());
    const contentBytes = utf8Bytes(content);
    if (contentBytes > MAX_REDACTED_BUNDLE_FILE_BYTES || contentBytes > remainingArtifactBytes) {
      continue;
    }
    bundleFiles.push({ path: file.path, content });
    remainingArtifactBytes -= contentBytes;
  }
  return bundleFiles;
}

function isExcludedSkillBundlePath(path: string) {
  return (
    isPrimarySkillReadmePath(path) || normalizeBundlePathForComparison(path) === "skill-card.md"
  );
}

function isPrimarySkillReadmePath(path: string) {
  const normalized = normalizeBundlePathForComparison(path);
  return normalized === "skill.md" || normalized === "skills.md";
}

function normalizeBundlePathForComparison(path: string) {
  return path
    .trim()
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/")
    .toLowerCase();
}

function totalBundleBytes(files: Array<{ content: string }>) {
  return files.reduce((sum, file) => sum + utf8Bytes(file.content), 0);
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

async function readRedactedSkillMdContent(ctx: Pick<ActionCtx, "storage">, files: unknown[]) {
  const skillFile = files.find((file) => {
    if (!isRecord(file) || typeof file.path !== "string") return false;
    return isPrimarySkillReadmePath(file.path);
  });
  if (!isRecord(skillFile) || typeof skillFile.storageId !== "string") return null;
  const blob = await ctx.storage.get(skillFile.storageId as never);
  if (!blob) return null;
  return redactSkillContent(await blob.text());
}

function redactSkillContent(value: string) {
  let redacted = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    redacted += code < 32 && code !== 9 && code !== 10 && code !== 13 ? " " : value.charAt(index);
  }
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  }
  return redacted.trim();
}

function redactBundleContent(value: string) {
  let redacted = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    redacted += code < 32 && code !== 9 && code !== 10 && code !== 13 ? " " : value.charAt(index);
  }
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  }
  return redacted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
