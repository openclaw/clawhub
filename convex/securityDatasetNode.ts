"use node";

import { gzipSync } from "node:zlib";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./functions";

const MAX_EXPORT_BATCH_PAGES = 20;

type ArtifactExportPage = {
  page: unknown[];
  isDone: boolean;
  continueCursor: string;
  exportMode: "public";
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

export const listArtifactExportBatchCompressedInternal = internalAction({
  args: {
    sourceKind: v.union(v.literal("skill"), v.literal("package")),
    mode: v.optional(v.literal("public")),
    createdAtGte: v.optional(v.number()),
    createdAtLt: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
    pageCount: v.number(),
  },
  handler: async (ctx, args) => {
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
  },
});

async function enrichAndSanitizeArtifactRows(ctx: ActionCtx, rows: unknown[]) {
  return await Promise.all(
    rows.map(async (row) => {
      if (!isRecord(row)) return row;
      const files = Array.isArray(row.files) ? row.files : [];
      const skillContent =
        row.sourceKind === "skill" ? await readRedactedSkillMdContent(ctx, files) : null;
      return {
        ...row,
        ...(skillContent ? { skillMdContentRedacted: skillContent } : {}),
        files: files.map((file) => {
          if (!isRecord(file)) return file;
          const { storageId: _storageId, ...rest } = file;
          return rest;
        }),
      };
    }),
  );
}

async function readRedactedSkillMdContent(ctx: Pick<ActionCtx, "storage">, files: unknown[]) {
  const skillFile = files.find((file) => {
    if (!isRecord(file) || typeof file.path !== "string") return false;
    const path = file.path.toLowerCase();
    return path === "skill.md" || path.endsWith("/skill.md");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
