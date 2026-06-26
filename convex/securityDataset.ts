import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalQuery } from "./functions";
import { getPackageReleaseArtifactSha256 } from "./lib/packageArtifacts";
import { getOwnerPublisher } from "./lib/publishers";

const MAX_EXPORT_PAGE_SIZE = 50;
const MAX_EXPORT_BATCH_PAGES = 20;
const MAX_REDACTED_BUNDLE_FILE_BYTES = 192 * 1024;
const MAX_REDACTED_BUNDLE_BYTES_PER_ARTIFACT = 256 * 1024;
const MAX_REDACTED_BUNDLE_BYTES_PER_RESPONSE = 256 * 1024;
const REDACTION_POLICY_VERSION = "public-signals-v2-bundle-files";
const SOURCE_TABLES = ["skillVersions", "packageReleases"] as const;
const SCANNER_SOURCES = [
  "static",
  "virustotal",
  "skillspector",
  "llm",
  "moderation_consensus",
] as const;
type StoredVtAnalysis = Doc<"skillVersions">["vtAnalysis"];
type StoredSkillSpectorAnalysis = Doc<"skillVersions">["skillSpectorAnalysis"];
type StoredLlmAnalysis = Doc<"skillVersions">["llmAnalysis"];
type ArtifactExportRow =
  | Awaited<ReturnType<typeof skillVersionPageToLatestExportRows>>[number]
  | Awaited<ReturnType<typeof packageReleasePageToExportRows>>[number];
type ArtifactExportPage = {
  page: ArtifactExportRow[];
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

export const listArtifactExportPageInternal = internalQuery({
  args: {
    sourceKind: v.union(v.literal("skill"), v.literal("package")),
    mode: v.optional(v.literal("public")),
    createdAtGte: v.optional(v.number()),
    createdAtLt: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const paginationOpts = {
      cursor: args.paginationOpts.cursor,
      numItems: Math.min(args.paginationOpts.numItems, MAX_EXPORT_PAGE_SIZE),
    };
    if (args.sourceKind === "skill") {
      const page = await ctx.db
        .query("skillVersions")
        .withIndex("by_active_created", (q) => {
          const range = q.eq("softDeletedAt", undefined);
          if (args.createdAtGte !== undefined && args.createdAtLt !== undefined) {
            return range.gte("createdAt", args.createdAtGte).lt("createdAt", args.createdAtLt);
          }
          if (args.createdAtGte !== undefined) return range.gte("createdAt", args.createdAtGte);
          if (args.createdAtLt !== undefined) return range.lt("createdAt", args.createdAtLt);
          return range;
        })
        .order("asc")
        .paginate(paginationOpts);
      return {
        page: await skillVersionPageToLatestExportRows(ctx, page.page),
        isDone: page.isDone,
        continueCursor: page.continueCursor,
        exportMode: args.mode ?? "public",
      };
    }

    const page = await ctx.db
      .query("packageReleases")
      .withIndex("by_active_created", (q) => {
        const range = q.eq("softDeletedAt", undefined);
        if (args.createdAtGte !== undefined && args.createdAtLt !== undefined) {
          return range.gte("createdAt", args.createdAtGte).lt("createdAt", args.createdAtLt);
        }
        if (args.createdAtGte !== undefined) return range.gte("createdAt", args.createdAtGte);
        if (args.createdAtLt !== undefined) return range.lt("createdAt", args.createdAtLt);
        return range;
      })
      .order("asc")
      .paginate(paginationOpts);
    return {
      page: await packageReleasePageToExportRows(ctx, page.page),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      exportMode: args.mode ?? "public",
    };
  },
});

export const getArtifactExportBoundsInternal = internalQuery({
  args: {
    sourceKind: v.union(v.literal("skill"), v.literal("package")),
  },
  handler: async (ctx, args) => {
    return await getActiveCreatedBounds(ctx, args.sourceKind);
  },
});

export const listArtifactExportBatchInternal = internalAction({
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
    return {
      page: await enrichAndSanitizeArtifactRows(ctx, page),
      isDone,
      continueCursor: cursor,
      exportMode: args.mode ?? "public",
    };
  },
});

export const getDatasetLineageInternal = internalQuery({
  args: {
    mode: v.optional(v.literal("public")),
  },
  handler: async (ctx, args) => {
    const sourceBounds = [
      await getActiveCreatedBounds(ctx, "skill"),
      await getActiveCreatedBounds(ctx, "package"),
    ];
    return {
      exportMode: args.mode ?? "public",
      generatedAt: Date.now(),
      maxExportPageSize: MAX_EXPORT_PAGE_SIZE,
      maxExportBatchPages: MAX_EXPORT_BATCH_PAGES,
      redactionPolicyVersion: REDACTION_POLICY_VERSION,
      sourceTables: SOURCE_TABLES,
      scannerSources: SCANNER_SOURCES,
      sourceBounds,
    };
  },
});

async function getActiveCreatedBounds(ctx: QueryCtx, sourceKind: "skill" | "package") {
  if (sourceKind === "skill") {
    const first = await ctx.db
      .query("skillVersions")
      .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
      .order("asc")
      .first();
    const last = await ctx.db
      .query("skillVersions")
      .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
      .order("desc")
      .first();
    return {
      sourceKind,
      minCreatedAt: first?.createdAt ?? null,
      maxCreatedAt: last?.createdAt ?? null,
    };
  }

  const first = await ctx.db
    .query("packageReleases")
    .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
    .order("asc")
    .first();
  const last = await ctx.db
    .query("packageReleases")
    .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
    .order("desc")
    .first();
  return {
    sourceKind,
    minCreatedAt: first?.createdAt ?? null,
    maxCreatedAt: last?.createdAt ?? null,
  };
}

export async function skillVersionPageToLatestExportRows(
  ctx: Pick<QueryCtx, "db">,
  versions: Array<Doc<"skillVersions">>,
) {
  const rows = [];
  for (const version of versions) {
    const skill = await ctx.db.get(version.skillId);
    if (!skill || skill.softDeletedAt || skill.latestVersionId !== version._id) continue;
    const publicOwnerHandle = await getPublicOwnerHandle(ctx, skill);
    rows.push({
      sourceKind: "skill" as const,
      sourceDocId: version._id,
      parentDocId: skill._id,
      publicName: skill.displayName,
      publicOwnerHandle,
      publicSlug: skill.slug,
      version: version.version,
      artifactSha256: version.sha256hash ?? null,
      createdAt: version.createdAt,
      softDeletedAt: version.softDeletedAt ?? null,
      files: sanitizeFiles(version.files),
      packageFamily: null,
      packageChannel: null,
      sourceRepoHost: null,
      vtAnalysis: normalizeVtAnalysis(version.vtAnalysis),
      skillSpectorAnalysis: normalizeSkillSpectorAnalysis(version.skillSpectorAnalysis),
      staticScan: version.staticScan ?? null,
      llmAnalysis: normalizeLlmAnalysis(version.llmAnalysis),
      moderationConsensus:
        skill.moderationSourceVersionId === version._id
          ? {
              verdict: skill.moderationVerdict ?? null,
              reasonCodes: skill.moderationReasonCodes ?? [],
              summary: skill.moderationSummary ?? null,
              engineVersion: skill.moderationEngineVersion ?? null,
              evaluatedAt: skill.moderationEvaluatedAt ?? null,
            }
          : null,
    });
  }
  return rows;
}

async function packageReleasePageToExportRows(
  ctx: QueryCtx,
  releases: Array<Doc<"packageReleases">>,
) {
  const rows = [];
  for (const release of releases) {
    const pkg = await ctx.db.get(release.packageId);
    if (!pkg || pkg.softDeletedAt || pkg.channel === "private") continue;
    const publicOwnerHandle = await getPublicOwnerHandle(ctx, pkg);
    rows.push({
      sourceKind: "package" as const,
      sourceDocId: release._id,
      parentDocId: pkg._id,
      publicName: pkg.displayName,
      publicOwnerHandle,
      publicSlug: pkg.name,
      version: release.version,
      artifactSha256: getPackageReleaseArtifactSha256(release),
      createdAt: release.createdAt,
      softDeletedAt: release.softDeletedAt ?? null,
      files: sanitizeFiles(release.files),
      packageFamily: pkg.family,
      packageChannel: pkg.channel,
      sourceRepoHost: sourceRepoHost(pkg.sourceRepo),
      vtAnalysis: normalizeVtAnalysis(release.vtAnalysis),
      skillSpectorAnalysis: normalizeSkillSpectorAnalysis(release.skillSpectorAnalysis),
      staticScan: release.staticScan ?? null,
      llmAnalysis: normalizeLlmAnalysis(release.llmAnalysis),
      moderationConsensus: null,
    });
  }
  return rows;
}

function sanitizeFiles(files: Array<Doc<"skillVersions">["files"][number]>) {
  return files.map((file) => ({
    path: file.path,
    size: file.size,
    sha256: file.sha256,
    storageId: file.storageId,
    contentType: file.contentType ?? null,
  }));
}

async function enrichAndSanitizeArtifactRows(ctx: ActionCtx, rows: ArtifactExportRow[]) {
  const enrichedRows = [];
  let remainingBundleBytes = MAX_REDACTED_BUNDLE_BYTES_PER_RESPONSE;
  for (const row of rows) {
    const skillContent =
      row.sourceKind === "skill" ? await readRedactedSkillMdContent(ctx, row.files) : null;
    const bundleFiles =
      row.sourceKind === "skill"
        ? await readRedactedBundleFiles(ctx, row.files, remainingBundleBytes)
        : [];
    remainingBundleBytes -= totalBundleBytes(bundleFiles);
    enrichedRows.push({
      ...row,
      ...(skillContent ? { skillMdContentRedacted: skillContent } : {}),
      ...(bundleFiles.length > 0 ? { bundleFilesRedacted: bundleFiles } : {}),
      files: row.files.map(({ storageId: _storageId, ...file }) => file),
    });
  }
  return enrichedRows;
}

async function readRedactedBundleFiles(
  ctx: Pick<ActionCtx, "storage">,
  files: Array<{ path: string; size?: number; storageId?: unknown }>,
  remainingResponseBytes: number,
) {
  const bundleFiles: Array<{ path: string; content: string }> = [];
  let remainingArtifactBytes = Math.min(
    remainingResponseBytes,
    MAX_REDACTED_BUNDLE_BYTES_PER_ARTIFACT,
  );
  for (const file of files) {
    if (isExcludedSkillBundlePath(file.path) || typeof file.storageId !== "string") continue;
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

async function readRedactedSkillMdContent(
  ctx: Pick<ActionCtx, "storage">,
  files: Array<{ path: string; storageId?: unknown }>,
) {
  const skillFile = files.find((file) => {
    return isPrimarySkillReadmePath(file.path);
  });
  if (!skillFile || typeof skillFile.storageId !== "string") return null;
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

function normalizeVtAnalysis(analysis: StoredVtAnalysis) {
  if (!analysis) return null;
  return {
    status: analysis.status,
    verdict: analysis.verdict ?? null,
    analysis: analysis.analysis ?? null,
    source: analysis.source ?? null,
    scanner: analysis.scanner ?? null,
    engineStats: analysis.engineStats ?? null,
    checkedAt: analysis.checkedAt,
  };
}

function normalizeSkillSpectorAnalysis(analysis: StoredSkillSpectorAnalysis) {
  if (!analysis) return null;
  return {
    status: analysis.status,
    score: analysis.score ?? null,
    severity: analysis.severity ?? null,
    recommendation: analysis.recommendation ?? null,
    issueCount: analysis.issueCount,
    issues: analysis.issues.map((issue) => ({
      issueId: issue.issueId,
      category: issue.category ?? null,
      severity: issue.severity,
      confidence: issue.confidence ?? null,
      explanation: issue.explanation,
    })),
    scannerVersion: analysis.scannerVersion ?? null,
    summary: analysis.summary ?? null,
    error: analysis.error ?? null,
    checkedAt: analysis.checkedAt,
  };
}

function normalizeLlmAnalysis(analysis: StoredLlmAnalysis) {
  if (!analysis) return null;
  return {
    status: analysis.status,
    verdict: analysis.verdict ?? null,
    confidence: analysis.confidence ?? null,
    summary: analysis.summary ?? null,
    dimensions: analysis.dimensions ?? null,
    guidance: analysis.guidance ?? null,
    findings: analysis.findings ?? null,
    agenticRiskFindings: analysis.agenticRiskFindings ?? [],
    model: analysis.model ?? null,
    checkedAt: analysis.checkedAt,
  };
}

async function getPublicOwnerHandle(
  ctx: Pick<QueryCtx, "db">,
  source: Pick<Doc<"skills"> | Doc<"packages">, "ownerPublisherId" | "ownerUserId">,
) {
  const owner = await getOwnerPublisher(ctx, {
    ownerPublisherId: source.ownerPublisherId,
    ownerUserId: source.ownerUserId,
  });
  return owner?.handle ?? null;
}

function sourceRepoHost(sourceRepo: string | undefined) {
  if (!sourceRepo) return null;
  try {
    return new URL(sourceRepo).host.toLowerCase();
  } catch {
    const match = sourceRepo.match(/^[^/:]+[:/](?<owner>[^/]+)\/(?<repo>[^/]+)$/);
    return match?.groups?.owner && match.groups.repo ? "github.com" : null;
  }
}
