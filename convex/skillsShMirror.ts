import {
  getCatalogTopicSlugs,
  normalizeCatalogTopic,
  normalizeCatalogTopics,
} from "clawhub-schema";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./functions";
import { tokenize } from "./lib/searchText";
import { assertSkillsShFixtureEnvironmentAllowed } from "./lib/skillsShCatalogEnvironment";

const CONTROL_KEY = "global";
const ENABLE_CONFIRM = "enable-skills-sh-mirror-test";
const PAUSE_CONFIRM = "set-skills-sh-mirror-pause";
const CANCEL_CONFIRM = "cancel-skills-sh-mirror-test-run";
const MAX_ROWS_PER_RUN = 50_000;
const MAX_ROWS_PER_BATCH = 50;
const MAX_DETAIL_BYTES = 64 * 1024;
const MAX_DETAIL_PAGE_ROWS = 50;
const MAX_RECONCILE_ROWS = 250;
const MAX_SOURCE_ATTEMPTS = 4;
// Accounting includes consumed upstream bodies, including at most one bounded
// 8 MiB GitHub tree per distinct repository. Retryable API/identity responses
// and non-OK tree responses are canceled unread, so retries do not multiply
// tree bytes. This is not the Convex mutation payload size.
const MAX_ACCOUNTED_SOURCE_BYTES_PER_BATCH = 512 * 1024 * 1024;
const MAX_SEARCH_ROWS = 50;
const MAX_SCANNER_STATUS_LENGTH = 32;
const MAX_SCANNER_URL_LENGTH = 2_048;
const MAX_UPSTREAM_SOURCE_TYPE_LENGTH = 64;
const MAX_QUARANTINE_REASON_LENGTH = 64;
const MAX_INFERRED_CATEGORIES = 3;
const MAX_INFERRED_TOPICS = 5;
const MAX_INFERENCE_METADATA_LENGTH = 128;
const BATCH_LEASE_DURATION_MS = 5 * 60 * 1_000;
const MAX_BATCH_LEASE_TOKEN_LENGTH = 128;
const SKILLS_SH_PROOF_SNAPSHOT_PREFIX = "skills-sh:proof:";
const PRESERVE_EXISTING_QUARANTINE_REASONS = new Set(["identity-page-fetch-failed"]);

const detailValidator = v.object({
  contentKind: v.union(v.literal("skill-md"), v.literal("readme")),
  path: v.string(),
  content: v.string(),
  contentBytes: v.number(),
  sourceBytes: v.number(),
  sourceFileCount: v.number(),
  truncated: v.boolean(),
});

const upstreamScannerValidator = v.object({
  status: v.string(),
  sourceCheckedAt: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
});

const upstreamScannersValidator = v.object({
  genAgentTrustHub: upstreamScannerValidator,
  socket: upstreamScannerValidator,
  snyk: upstreamScannerValidator,
});

const classificationConfidenceValidator = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);

const sourceListRowValidator = v.object({
  id: v.string(),
  installUrl: v.union(v.string(), v.null()),
  installs: v.number(),
  name: v.string(),
  slug: v.string(),
  source: v.string(),
  sourceType: v.string(),
  url: v.string(),
});

const rowValidator = v.object({
  externalId: v.string(),
  sourceType: v.union(v.literal("github"), v.literal("well-known")),
  upstreamSourceType: v.string(),
  owner: v.optional(v.string()),
  repo: v.optional(v.string()),
  sourceHost: v.optional(v.string()),
  slug: v.string(),
  displayName: v.string(),
  sourceUrl: v.string(),
  canonicalRepoUrl: v.optional(v.string()),
  githubPath: v.optional(v.string()),
  githubCommit: v.optional(v.string()),
  sourceContentHash: v.optional(v.string()),
  upstreamInstalls: v.number(),
  upstreamScanners: upstreamScannersValidator,
  inferredCategories: v.array(v.string()),
  inferredTopics: v.array(v.string()),
  inferredCategoryConfidence: classificationConfidenceValidator,
  inferredTopicConfidence: classificationConfidenceValidator,
  inferredClassifierVersion: v.string(),
  inferredTopicClassifierVersion: v.string(),
  inferredInputHash: v.string(),
  inferredTopicInputHash: v.string(),
  inferredAt: v.number(),
  detail: v.optional(detailValidator),
});

type MirrorRow = Infer<typeof rowValidator>;

const quarantinedRowValidator = v.object({
  quarantined: v.literal(true),
  externalId: v.string(),
  upstreamSourceType: v.string(),
  reason: v.string(),
});

type QuarantinedRow = Infer<typeof quarantinedRowValidator>;
type BatchRow = MirrorRow | QuarantinedRow;

function assertIntegerInRange(name: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConvexError(`${name} must be an integer between ${min} and ${max}`);
  }
}

function normalizedSourceSnapshotHash(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ConvexError("sourceSnapshotHash must be a SHA-256 hex digest");
  }
  return normalized;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function compactSourceSnapshotId(snapshotId: string) {
  if (!snapshotId.startsWith(SKILLS_SH_PROOF_SNAPSHOT_PREFIX)) return snapshotId;
  const evidenceHashSeparator = snapshotId.indexOf(".", SKILLS_SH_PROOF_SNAPSHOT_PREFIX.length);
  if (evidenceHashSeparator === -1) return snapshotId;
  const evidenceSeparator = snapshotId.indexOf(".", evidenceHashSeparator + 1);
  // The retained hash identifies the exact measured pagination evidence without copying it to rows.
  return evidenceSeparator === -1 ? snapshotId : snapshotId.slice(0, evidenceSeparator);
}

function emptyCounts(): Doc<"skillsShMirrorRuns">["counts"] {
  return {
    observed: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    quarantined: 0,
    quarantinedPreserved: 0,
    conflicts: 0,
    detailsInserted: 0,
    detailsUpdated: 0,
    detailsUnchanged: 0,
    detailsMissing: 0,
    detailsTruncated: 0,
    tombstoned: 0,
    reactivated: 0,
    scansPlanned: 0,
    scansAdmitted: 0,
  };
}

function addOperations(
  current: Doc<"skillsShMirrorRuns">["operations"],
  delta: Partial<Doc<"skillsShMirrorRuns">["operations"]>,
) {
  return {
    functionCalls: current.functionCalls + (delta.functionCalls ?? 0),
    dbReads: current.dbReads + (delta.dbReads ?? 0),
    dbWrites: current.dbWrites + (delta.dbWrites ?? 0),
    sourceRequests: current.sourceRequests + (delta.sourceRequests ?? 0),
    sourceBytes: current.sourceBytes + (delta.sourceBytes ?? 0),
  };
}

async function getControl(ctx: Pick<QueryCtx | MutationCtx, "db">) {
  return await ctx.db
    .query("skillsShMirrorControls")
    .withIndex("by_key", (q) => q.eq("key", CONTROL_KEY))
    .unique();
}

function requireActiveControl(control: Doc<"skillsShMirrorControls"> | null) {
  if (!control?.enabled) throw new ConvexError("skills.sh mirror is disabled");
  if (control.paused) throw new ConvexError("skills.sh mirror is paused");
  return control;
}

function normalizedLeaseToken(value: string) {
  const token = value.trim();
  if (!token || token.length > MAX_BATCH_LEASE_TOKEN_LENGTH) {
    throw new ConvexError(
      `leaseToken must be between 1 and ${MAX_BATCH_LEASE_TOKEN_LENGTH} characters`,
    );
  }
  return token;
}

function requireExactRunCursor(run: Doc<"skillsShMirrorRuns">, page: number, offset: number) {
  if (page !== run.page || offset !== run.offset) {
    throw new ConvexError(`skills.sh mirror cursor mismatch: expected ${run.page}:${run.offset}`);
  }
}

function normalizeRow(row: MirrorRow): MirrorRow {
  const externalId = row.externalId.trim().toLowerCase();
  const slug = row.slug.trim().toLowerCase();
  return {
    ...row,
    externalId,
    slug,
    displayName: row.displayName.trim() || slug,
    sourceUrl: row.sourceUrl.trim(),
    owner: row.owner?.trim().toLowerCase(),
    repo: row.repo?.trim().toLowerCase(),
    sourceHost: row.sourceHost?.trim().toLowerCase(),
    canonicalRepoUrl: row.canonicalRepoUrl?.trim(),
    githubPath: row.githubPath?.trim(),
    githubCommit: row.githubCommit?.trim().toLowerCase(),
    sourceContentHash: row.sourceContentHash?.trim().toLowerCase(),
    upstreamSourceType: row.upstreamSourceType.trim().toLowerCase(),
    upstreamScanners: {
      genAgentTrustHub: normalizeScanner(row.upstreamScanners.genAgentTrustHub),
      socket: normalizeScanner(row.upstreamScanners.socket),
      snyk: normalizeScanner(row.upstreamScanners.snyk),
    },
    inferredCategories: row.inferredCategories.map(normalizedSearchText),
    inferredTopics: row.inferredTopics.map(normalizedTopicLabel),
    inferredClassifierVersion: row.inferredClassifierVersion.trim(),
    inferredTopicClassifierVersion: row.inferredTopicClassifierVersion.trim(),
    inferredInputHash: row.inferredInputHash.trim(),
    inferredTopicInputHash: row.inferredTopicInputHash.trim(),
  };
}

function normalizeQuarantinedRow(row: QuarantinedRow) {
  return {
    externalId: row.externalId.trim().toLowerCase(),
    upstreamSourceType: row.upstreamSourceType.trim().toLowerCase(),
    reason: row.reason.trim().toLowerCase(),
  };
}

function normalizeScanner(scanner: MirrorRow["upstreamScanners"]["socket"]) {
  return {
    status: scanner.status.trim().toLowerCase(),
    ...(scanner.sourceCheckedAt ? { sourceCheckedAt: scanner.sourceCheckedAt.trim() } : {}),
    ...(scanner.sourceUrl ? { sourceUrl: scanner.sourceUrl.trim() } : {}),
  };
}

function validScanner(scanner: MirrorRow["upstreamScanners"]["socket"]) {
  if (
    !scanner.status ||
    scanner.status.length > MAX_SCANNER_STATUS_LENGTH ||
    !/^[a-z0-9][a-z0-9-]*$/.test(scanner.status)
  ) {
    return false;
  }
  if (scanner.sourceCheckedAt !== undefined && Number.isNaN(Date.parse(scanner.sourceCheckedAt))) {
    return false;
  }
  if (scanner.sourceUrl !== undefined) {
    if (scanner.sourceUrl.length > MAX_SCANNER_URL_LENGTH) return false;
    try {
      const url = new URL(scanner.sourceUrl);
      if (url.protocol !== "https:" || !["skills.sh", "www.skills.sh"].includes(url.hostname)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function normalizedSearchText(value: string) {
  return value.trim().toLowerCase();
}

function normalizedTopicLabel(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function firstSearchToken(value: string) {
  return tokenize(value)[0] ?? normalizedSearchText(value);
}

function requiredSearchValue(name: string, value: string) {
  const normalized = normalizedSearchText(value);
  if (!normalized) throw new ConvexError(`${name} is required`);
  return normalized;
}

function searchLimit(limit: number) {
  assertIntegerInRange("limit", limit, 1, MAX_SEARCH_ROWS);
  return limit;
}

function prefixUpperBound(prefix: string) {
  return `${prefix}\uffff`;
}

function searchFields(row: MirrorRow) {
  const normalizedSlug = normalizedSearchText(row.slug);
  const normalizedDisplayName = normalizedSearchText(row.displayName);
  return {
    normalizedSlug,
    normalizedSlugFirstToken: firstSearchToken(row.slug),
    normalizedDisplayName,
    normalizedDisplayNameFirstToken: firstSearchToken(row.displayName),
    searchText: [
      row.displayName,
      row.slug,
      row.owner,
      row.repo,
      row.sourceHost,
      ...row.inferredCategories,
      ...row.inferredTopics,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" "),
  };
}

function validCategoryInferenceTerms(values: string[], min: number, max: number) {
  return (
    values.length >= min &&
    values.length <= max &&
    new Set(values).size === values.length &&
    values.every(
      (value) => value.length > 0 && value.length <= 64 && /^[a-z0-9][a-z0-9-]*$/.test(value),
    )
  );
}

function validTopicInferenceTerms(values: string[]) {
  if (values.length > MAX_INFERRED_TOPICS) return false;
  try {
    const normalized = normalizeCatalogTopics(values);
    return (
      normalized.length === values.length &&
      normalized.every((value, index) => value === values[index])
    );
  } catch {
    return false;
  }
}

function validInference(row: MirrorRow) {
  return (
    validCategoryInferenceTerms(row.inferredCategories, 1, MAX_INFERRED_CATEGORIES) &&
    validTopicInferenceTerms(row.inferredTopics) &&
    [
      row.inferredClassifierVersion,
      row.inferredTopicClassifierVersion,
      row.inferredInputHash,
      row.inferredTopicInputHash,
    ].every((value) => value.length > 0 && value.length <= MAX_INFERENCE_METADATA_LENGTH) &&
    Number.isSafeInteger(row.inferredAt) &&
    row.inferredAt > 0
  );
}

function validIdentity(row: MirrorRow) {
  if (
    !row.externalId ||
    !row.slug ||
    !row.sourceUrl ||
    !row.upstreamSourceType ||
    row.upstreamSourceType.length > MAX_UPSTREAM_SOURCE_TYPE_LENGTH ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(row.upstreamSourceType)
  ) {
    return false;
  }
  if (row.sourceType === "github") {
    return (
      Boolean(row.owner && row.repo && row.canonicalRepoUrl) &&
      !row.sourceHost &&
      row.externalId === `${row.owner}/${row.repo}/${row.slug}`
    );
  }
  return (
    Boolean(row.sourceHost) &&
    !row.owner &&
    !row.repo &&
    !row.canonicalRepoUrl &&
    row.externalId === `${row.sourceHost}/${row.slug}`
  );
}

function observationFingerprint(row: MirrorRow) {
  return JSON.stringify({
    externalId: row.externalId,
    sourceType: row.sourceType,
    upstreamSourceType: row.upstreamSourceType,
    owner: row.owner ?? null,
    repo: row.repo ?? null,
    sourceHost: row.sourceHost ?? null,
    slug: row.slug,
    displayName: row.displayName,
    sourceUrl: row.sourceUrl,
    canonicalRepoUrl: row.canonicalRepoUrl ?? null,
    githubPath: row.githubPath ?? null,
    githubCommit: row.githubCommit ?? null,
    sourceContentHash: row.sourceContentHash ?? null,
    upstreamInstalls: row.upstreamInstalls,
    upstreamScanners: row.upstreamScanners,
    inferredCategories: row.inferredCategories,
    inferredTopics: row.inferredTopics,
    inferredCategoryConfidence: row.inferredCategoryConfidence,
    inferredTopicConfidence: row.inferredTopicConfidence,
    inferredClassifierVersion: row.inferredClassifierVersion,
    inferredTopicClassifierVersion: row.inferredTopicClassifierVersion,
    inferredInputHash: row.inferredInputHash,
    inferredTopicInputHash: row.inferredTopicInputHash,
    detail: row.detail ?? null,
  });
}

function sameDetail(detail: Doc<"skillsShMirrorDetails">, row: MirrorRow) {
  const next = row.detail;
  return (
    next !== undefined &&
    detail.contentKind === next.contentKind &&
    detail.path === next.path &&
    detail.content === next.content &&
    detail.contentBytes === next.contentBytes &&
    detail.sourceBytes === next.sourceBytes &&
    detail.sourceFileCount === next.sourceFileCount &&
    detail.truncated === next.truncated &&
    detail.sourceContentHash === row.sourceContentHash
  );
}

async function syncFacets(
  ctx: MutationCtx,
  digestId: Id<"skillsShMirrorDigests">,
  row: MirrorRow,
  now: number,
) {
  const desired = new Map(
    [
      ...row.inferredCategories.map((term) => ({
        key: `category:${term}`,
        kind: "category" as const,
        term,
      })),
      // Full mirror replay migrates legacy topic-label facets by replacing them with canonical slugs.
      ...getCatalogTopicSlugs(row.inferredTopics).map((term) => ({
        key: `topic:${term}`,
        kind: "topic" as const,
        term,
      })),
    ].map((facet) => [facet.key, facet]),
  );
  const existing = await ctx.db
    .query("skillsShMirrorFacets")
    .withIndex("by_digest_id_and_kind_and_term", (q) => q.eq("digestId", digestId))
    .collect();
  let writes = 0;
  for (const facet of existing) {
    const key = `${facet.kind}:${facet.term}`;
    if (!desired.delete(key)) {
      if (facet.active) {
        await ctx.db.patch(facet._id, {
          active: false,
          updatedAt: now,
        });
        writes += 1;
      }
      continue;
    }
    if (!facet.active || facet.installs !== row.upstreamInstalls) {
      await ctx.db.patch(facet._id, {
        active: true,
        installs: row.upstreamInstalls,
        updatedAt: now,
      });
      writes += 1;
    }
  }
  for (const facet of desired.values()) {
    await ctx.db.insert("skillsShMirrorFacets", {
      digestId,
      externalId: row.externalId,
      kind: facet.kind,
      term: facet.term,
      active: true,
      installs: row.upstreamInstalls,
      createdAt: now,
      updatedAt: now,
    });
    writes += 1;
  }
  return { reads: existing.length + 1, writes };
}

function runCounts(counts: Doc<"skillsShMirrorRuns">["counts"]) {
  return {
    ...counts,
    quarantined: counts.quarantined ?? 0,
    quarantinedPreserved: counts.quarantinedPreserved ?? 0,
  };
}

type SummarizableMirrorRun = Pick<
  Doc<"skillsShMirrorRuns">,
  | "_id"
  | "snapshotId"
  | "sourceSnapshotHash"
  | "sourceCaptureWrites"
  | "status"
  | "sourceTotal"
  | "sourcePageSize"
  | "sourceMeasuredAt"
  | "page"
  | "offset"
  | "counts"
  | "operations"
  | "startedAt"
  | "completedAt"
  | "updatedAt"
>;

function summarizeRun(run: SummarizableMirrorRun) {
  return {
    runId: run._id,
    snapshotId: run.snapshotId,
    sourceSnapshotHash: run.sourceSnapshotHash ?? null,
    sourceCaptureWrites: run.sourceCaptureWrites ?? 0,
    status: run.status,
    sourceTotal: run.sourceTotal,
    sourcePageSize: run.sourcePageSize,
    sourceMeasuredAt: run.sourceMeasuredAt,
    page: run.page,
    offset: run.offset,
    counts: runCounts(run.counts),
    operations: run.operations,
    startedAt: run.startedAt,
    completedAt: run.completedAt ?? null,
    updatedAt: run.updatedAt,
  };
}

export const configureInternal = internalMutation({
  args: {
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
    enabled: v.boolean(),
    maxRowsPerRun: v.number(),
    maxRowsPerBatch: v.number(),
    maxDetailBytes: v.number(),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    if (args.confirm !== ENABLE_CONFIRM) {
      throw new ConvexError(`Pass confirm="${ENABLE_CONFIRM}" to configure the mirror.`);
    }
    assertIntegerInRange("maxRowsPerRun", args.maxRowsPerRun, 1, MAX_ROWS_PER_RUN);
    assertIntegerInRange("maxRowsPerBatch", args.maxRowsPerBatch, 1, MAX_ROWS_PER_BATCH);
    assertIntegerInRange("maxDetailBytes", args.maxDetailBytes, 1, MAX_DETAIL_BYTES);
    const now = Date.now();
    const existing = await getControl(ctx);
    const next = {
      enabled: args.enabled,
      paused: !args.enabled,
      maxRowsPerRun: args.maxRowsPerRun,
      maxRowsPerBatch: args.maxRowsPerBatch,
      maxDetailBytes: args.maxDetailBytes,
      updatedBy: args.actor.trim(),
      reason: args.reason.trim(),
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("skillsShMirrorControls", { key: CONTROL_KEY, ...next });
    return {
      ...next,
      environment: assertSkillsShFixtureEnvironmentAllowed().environment,
      publicVisible: false as const,
      installable: false as const,
      scanPlanningEnabled: false as const,
      scanAdmissionEnabled: false as const,
    };
  },
});

export const startRunInternal = internalMutation({
  args: {
    actor: v.string(),
    reason: v.string(),
    snapshotId: v.string(),
    sourceSnapshotHash: v.optional(v.string()),
    sourceCaptureWrites: v.optional(v.number()),
    sourceTotal: v.number(),
    sourcePageSize: v.number(),
    sourceMeasuredAt: v.string(),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const control = requireActiveControl(await getControl(ctx));
    assertIntegerInRange("sourceTotal", args.sourceTotal, 1, control.maxRowsPerRun);
    assertIntegerInRange("sourcePageSize", args.sourcePageSize, 1, 500);
    if (Number.isNaN(Date.parse(args.sourceMeasuredAt))) {
      throw new ConvexError("sourceMeasuredAt must be an ISO timestamp");
    }
    assertIntegerInRange("sourceCaptureWrites", args.sourceCaptureWrites ?? 0, 0, 100);
    const activeRuns = await ctx.db
      .query("skillsShMirrorRuns")
      .withIndex("by_started_at")
      .order("desc")
      .take(20);
    if (
      activeRuns.some(
        (run) =>
          run.status === "running" || run.status === "paused" || run.status === "reconciling",
      )
    ) {
      throw new ConvexError("skills.sh mirror already has an active run");
    }
    const now = Date.now();
    const run = {
      snapshotId: args.snapshotId.trim(),
      ...(args.sourceSnapshotHash
        ? { sourceSnapshotHash: normalizedSourceSnapshotHash(args.sourceSnapshotHash) }
        : {}),
      sourceCaptureWrites: args.sourceCaptureWrites ?? 0,
      status: "running" as const,
      sourceTotal: args.sourceTotal,
      sourcePageSize: args.sourcePageSize,
      sourceMeasuredAt: args.sourceMeasuredAt,
      page: 0,
      offset: 0,
      counts: emptyCounts(),
      operations: {
        functionCalls: 1,
        dbReads: 2,
        dbWrites: 1,
        sourceRequests: 0,
        sourceBytes: 0,
      },
      actor: args.actor.trim(),
      reason: args.reason.trim(),
      startedAt: now,
      updatedAt: now,
    };
    const runId = await ctx.db.insert("skillsShMirrorRuns", run);
    return summarizeRun({ _id: runId, ...run });
  },
});

export const storeSourcePageInternal = internalMutation({
  args: {
    snapshotHash: v.string(),
    page: v.number(),
    sourceTotal: v.number(),
    pageLength: v.number(),
    hasMore: v.boolean(),
    identityHash: v.string(),
    contentHash: v.string(),
    sourceBytes: v.number(),
    serializedBytes: v.number(),
    rows: v.array(sourceListRowValidator),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const control = requireActiveControl(await getControl(ctx));
    const snapshotHash = normalizedSourceSnapshotHash(args.snapshotHash);
    const identityHash = normalizedSourceSnapshotHash(args.identityHash);
    const contentHash = normalizedSourceSnapshotHash(args.contentHash);
    assertIntegerInRange("page", args.page, 0, Math.ceil(control.maxRowsPerRun / 500) - 1);
    assertIntegerInRange("sourceTotal", args.sourceTotal, 1, control.maxRowsPerRun);
    assertIntegerInRange("pageLength", args.pageLength, 1, 500);
    assertIntegerInRange("rows.length", args.rows.length, 1, 500);
    assertIntegerInRange("sourceBytes", args.sourceBytes, 1, 1024 * 1024);
    assertIntegerInRange("serializedBytes", args.serializedBytes, 1, 1024 * 1024);
    if (args.rows.length !== args.pageLength) {
      throw new ConvexError("captured skills.sh source page length mismatch");
    }
    const [computedIdentityHash, computedContentHash] = await Promise.all([
      sha256Hex(args.rows.map((row) => `${row.id.trim().toLowerCase()}\n`).join("")),
      sha256Hex(JSON.stringify(args.rows)),
    ]);
    if (computedIdentityHash !== identityHash) {
      throw new ConvexError("captured skills.sh source page identity hash mismatch");
    }
    if (computedContentHash !== contentHash) {
      throw new ConvexError("captured skills.sh source page content hash mismatch");
    }
    const existing = await ctx.db
      .query("skillsShMirrorSourcePages")
      .withIndex("by_snapshot_hash_and_page", (q) =>
        q.eq("snapshotHash", snapshotHash).eq("page", args.page),
      )
      .unique();
    const value = {
      snapshotHash,
      page: args.page,
      sourceTotal: args.sourceTotal,
      pageLength: args.pageLength,
      hasMore: args.hasMore,
      identityHash,
      contentHash,
      sourceBytes: args.sourceBytes,
      serializedBytes: args.serializedBytes,
      rows: args.rows,
    };
    if (existing) {
      const comparable = {
        snapshotHash: existing.snapshotHash,
        page: existing.page,
        sourceTotal: existing.sourceTotal,
        pageLength: existing.pageLength,
        hasMore: existing.hasMore,
        identityHash: existing.identityHash,
        contentHash: existing.contentHash,
        sourceBytes: existing.sourceBytes,
        serializedBytes: existing.serializedBytes,
        rows: existing.rows,
      };
      if (JSON.stringify(comparable) !== JSON.stringify(value)) {
        throw new ConvexError("captured skills.sh source page is immutable");
      }
      return { stored: false as const, page: existing.page, rows: existing.pageLength };
    }
    await ctx.db.insert("skillsShMirrorSourcePages", {
      ...value,
      createdAt: Date.now(),
    });
    return { stored: true as const, page: args.page, rows: args.pageLength };
  },
});

export const getSourceCaptureSummaryInternal = internalQuery({
  args: { snapshotHash: v.string() },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const snapshotHash = normalizedSourceSnapshotHash(args.snapshotHash);
    const pages = await ctx.db
      .query("skillsShMirrorSourcePages")
      .withIndex("by_snapshot_hash_and_page", (q) => q.eq("snapshotHash", snapshotHash))
      .take(Math.ceil(MAX_ROWS_PER_RUN / 500) + 1);
    if (pages.length > Math.ceil(MAX_ROWS_PER_RUN / 500)) {
      throw new ConvexError("captured skills.sh source exceeds the page limit");
    }
    return {
      snapshotHash,
      pageDocuments: pages.length,
      rows: pages.reduce((sum, page) => sum + page.pageLength, 0),
      sourceBytes: pages.reduce((sum, page) => sum + page.sourceBytes, 0),
      serializedBytes: pages.reduce((sum, page) => sum + page.serializedBytes, 0),
    };
  },
});

export const setPausedInternal = internalMutation({
  args: {
    runId: v.id("skillsShMirrorRuns"),
    paused: v.boolean(),
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    if (args.confirm !== PAUSE_CONFIRM) {
      throw new ConvexError(`Pass confirm="${PAUSE_CONFIRM}" to change mirror pause state.`);
    }
    const [control, run] = await Promise.all([getControl(ctx), ctx.db.get(args.runId)]);
    if (!control || !run) throw new ConvexError("skills.sh mirror state not found");
    if (run.status !== "running" && run.status !== "paused") {
      throw new ConvexError(`Cannot change pause state for ${run.status} run`);
    }
    if (!args.paused && !control.enabled) {
      throw new ConvexError("skills.sh mirror is disabled");
    }
    const now = Date.now();
    await ctx.db.patch(control._id, {
      paused: args.paused,
      updatedBy: args.actor.trim(),
      reason: args.reason.trim(),
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: args.paused ? "paused" : "running",
      batchLeaseToken: undefined,
      batchLeaseExpiresAt: undefined,
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: 2,
        dbWrites: 2,
      }),
      updatedAt: now,
    });
    return { runId: run._id, status: args.paused ? ("paused" as const) : ("running" as const) };
  },
});

export const cancelRunInternal = internalMutation({
  args: {
    runId: v.id("skillsShMirrorRuns"),
    actor: v.string(),
    reason: v.string(),
    confirm: v.string(),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    if (args.confirm !== CANCEL_CONFIRM) {
      throw new ConvexError(`Pass confirm="${CANCEL_CONFIRM}" to cancel a mirror run.`);
    }
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError("skills.sh mirror run not found");
    if (!["running", "paused", "reconciling"].includes(run.status)) {
      throw new ConvexError(`Cannot cancel a ${run.status} skills.sh mirror run`);
    }
    const now = Date.now();
    const patch = {
      status: "canceled" as const,
      batchLeaseToken: undefined,
      batchLeaseExpiresAt: undefined,
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: 1,
        dbWrites: 1,
      }),
      actor: args.actor.trim(),
      reason: args.reason.trim(),
      completedAt: now,
      updatedAt: now,
    };
    await ctx.db.patch(run._id, patch);
    return summarizeRun({ ...run, ...patch });
  },
});

export const claimBatchLeaseInternal = internalMutation({
  args: {
    runId: v.id("skillsShMirrorRuns"),
    page: v.number(),
    offset: v.number(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    requireActiveControl(await getControl(ctx));
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError("skills.sh mirror run not found");
    if (run.status === "paused") throw new ConvexError("skills.sh mirror run is paused");
    if (run.status !== "running") {
      throw new ConvexError(`Cannot lease a ${run.status} skills.sh mirror run`);
    }
    requireExactRunCursor(run, args.page, args.offset);
    const leaseToken = normalizedLeaseToken(args.leaseToken);
    const now = Date.now();
    if (
      run.batchLeaseToken &&
      run.batchLeaseExpiresAt !== undefined &&
      run.batchLeaseExpiresAt > now
    ) {
      if (run.batchLeaseToken !== leaseToken) {
        throw new ConvexError(
          `skills.sh mirror cursor ${run.page}:${run.offset} is already leased`,
        );
      }
    }
    const leaseExpiresAt = now + BATCH_LEASE_DURATION_MS;
    const sourcePage = run.sourceSnapshotHash
      ? await ctx.db
          .query("skillsShMirrorSourcePages")
          .withIndex("by_snapshot_hash_and_page", (q) =>
            q.eq("snapshotHash", run.sourceSnapshotHash!).eq("page", run.page),
          )
          .unique()
      : null;
    await ctx.db.patch(run._id, {
      batchLeaseToken: leaseToken,
      batchLeaseExpiresAt: leaseExpiresAt,
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: run.sourceSnapshotHash ? 3 : 2,
        dbWrites: 1,
      }),
      updatedAt: now,
    });
    return {
      runId: run._id,
      snapshotId: run.snapshotId,
      sourceTotal: run.sourceTotal,
      sourcePageSize: run.sourcePageSize,
      sourcePage,
      page: run.page,
      offset: run.offset,
      leaseToken,
      leaseExpiresAt,
    };
  },
});

export const releaseBatchLeaseInternal = internalMutation({
  args: {
    runId: v.id("skillsShMirrorRuns"),
    page: v.number(),
    offset: v.number(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError("skills.sh mirror run not found");
    requireExactRunCursor(run, args.page, args.offset);
    const leaseToken = normalizedLeaseToken(args.leaseToken);
    if (!run.batchLeaseToken) return { released: false as const };
    if (run.batchLeaseToken !== leaseToken) {
      throw new ConvexError("skills.sh mirror lease token mismatch");
    }
    const now = Date.now();
    await ctx.db.patch(run._id, {
      batchLeaseToken: undefined,
      batchLeaseExpiresAt: undefined,
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: 1,
        dbWrites: 1,
      }),
      updatedAt: now,
    });
    return { released: true as const };
  },
});

export const processBatchInternal = internalMutation({
  args: {
    runId: v.id("skillsShMirrorRuns"),
    page: v.number(),
    offset: v.number(),
    leaseToken: v.string(),
    pageLength: v.number(),
    hasMore: v.boolean(),
    sourceTotal: v.number(),
    sourceRequests: v.number(),
    sourceBytes: v.number(),
    rows: v.array(v.union(rowValidator, quarantinedRowValidator)),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const [controlDoc, run] = await Promise.all([getControl(ctx), ctx.db.get(args.runId)]);
    const control = requireActiveControl(controlDoc);
    if (!run) throw new ConvexError("skills.sh mirror run not found");
    if (run.status === "paused") throw new ConvexError("skills.sh mirror run is paused");
    if (run.status !== "running") return summarizeRun(run);
    requireExactRunCursor(run, args.page, args.offset);
    const leaseToken = normalizedLeaseToken(args.leaseToken);
    if (run.batchLeaseToken !== leaseToken) {
      throw new ConvexError("skills.sh mirror lease token mismatch");
    }
    if (run.batchLeaseExpiresAt === undefined || run.batchLeaseExpiresAt <= Date.now()) {
      throw new ConvexError("skills.sh mirror batch lease expired");
    }
    if (args.sourceTotal !== run.sourceTotal) {
      throw new ConvexError("skills.sh mirror source total changed during the run");
    }
    assertIntegerInRange("page", args.page, 0, 100_000);
    assertIntegerInRange("offset", args.offset, 0, run.sourcePageSize);
    assertIntegerInRange("pageLength", args.pageLength, 1, run.sourcePageSize);
    assertIntegerInRange("rows.length", args.rows.length, 1, control.maxRowsPerBatch);
    assertIntegerInRange(
      "sourceRequests",
      args.sourceRequests,
      0,
      MAX_SOURCE_ATTEMPTS * (1 + 5 * args.rows.length),
    );
    assertIntegerInRange("sourceBytes", args.sourceBytes, 0, MAX_ACCOUNTED_SOURCE_BYTES_PER_BATCH);
    if (args.offset + args.rows.length > args.pageLength) {
      throw new ConvexError("skills.sh mirror batch exceeds the source page");
    }

    const counts = runCounts(run.counts);
    let reads = 2;
    let writes = 0;
    const now = Date.now();
    const sourceSnapshotId = compactSourceSnapshotId(run.snapshotId);
    for (let index = 0; index < args.rows.length; index += 1) {
      const batchRow: BatchRow = args.rows[index]!;
      counts.observed += 1;
      if ("quarantined" in batchRow) {
        const row = normalizeQuarantinedRow(batchRow);
        if (
          !row.externalId ||
          row.externalId.length > 512 ||
          !row.upstreamSourceType ||
          row.upstreamSourceType.length > MAX_UPSTREAM_SOURCE_TYPE_LENGTH ||
          !/^[a-z0-9][a-z0-9._-]*$/.test(row.upstreamSourceType) ||
          !row.reason ||
          row.reason.length > MAX_QUARANTINE_REASON_LENGTH ||
          !/^[a-z0-9][a-z0-9-]*$/.test(row.reason)
        ) {
          throw new ConvexError("skills.sh mirror quarantine record is invalid");
        }
        await ctx.db.insert("skillsShMirrorConflicts", {
          runId: run._id,
          externalId: row.externalId,
          kind: "source-quarantine",
          reason: row.reason,
          upstreamSourceType: row.upstreamSourceType,
          observedFingerprint: JSON.stringify(row),
          page: args.page,
          offset: args.offset + index,
          createdAt: now,
        });
        counts.rejected += 1;
        counts.quarantined += 1;
        counts.conflicts += 1;
        writes += 1;
        if (PRESERVE_EXISTING_QUARANTINE_REASONS.has(row.reason)) {
          const existing = await ctx.db
            .query("skillsShMirrorDigests")
            .withIndex("by_external_id", (q) => q.eq("externalId", row.externalId))
            .unique();
          reads += 1;
          if (existing?.active && existing.lastObservedRunId !== run._id) {
            counts.quarantinedPreserved += 1;
            await ctx.db.patch(existing._id, {
              upstreamSourceType: row.upstreamSourceType,
              lastObservedRunId: run._id,
              sourceFreshnessStatus: "stale",
              staleQuarantineReason: row.reason,
              updatedAt: now,
            });
            writes += 1;
          }
        }
        continue;
      }
      const row = normalizeRow(batchRow);
      const fingerprint = observationFingerprint(row);
      if (
        !validIdentity(row) ||
        !validInference(row) ||
        !Number.isSafeInteger(row.upstreamInstalls) ||
        row.upstreamInstalls < 0 ||
        (row.sourceContentHash !== undefined && !/^[a-f0-9]{64}$/.test(row.sourceContentHash)) ||
        !validScanner(row.upstreamScanners.genAgentTrustHub) ||
        !validScanner(row.upstreamScanners.socket) ||
        !validScanner(row.upstreamScanners.snyk) ||
        (row.detail !== undefined &&
          (row.detail.contentBytes > control.maxDetailBytes ||
            new TextEncoder().encode(row.detail.content).byteLength !== row.detail.contentBytes))
      ) {
        await ctx.db.insert("skillsShMirrorConflicts", {
          runId: run._id,
          externalId: row.externalId,
          kind: "identity-mismatch",
          observedFingerprint: fingerprint,
          page: args.page,
          offset: args.offset + index,
          createdAt: now,
        });
        counts.rejected += 1;
        counts.conflicts += 1;
        writes += 1;
        continue;
      }

      const existing = await ctx.db
        .query("skillsShMirrorDigests")
        .withIndex("by_external_id", (q) => q.eq("externalId", row.externalId))
        .unique();
      reads += 1;
      if (existing?.lastObservedRunId === run._id && existing.sourceFreshnessStatus === "stale") {
        counts.quarantinedPreserved = Math.max(0, counts.quarantinedPreserved - 1);
      }
      if (
        existing?.lastObservedRunId === run._id &&
        existing.sourceFreshnessStatus !== "stale" &&
        existing.observationFingerprint !== fingerprint
      ) {
        await ctx.db.insert("skillsShMirrorConflicts", {
          runId: run._id,
          externalId: row.externalId,
          kind: "same-run-drift",
          previousFingerprint: existing.observationFingerprint,
          observedFingerprint: fingerprint,
          page: args.page,
          offset: args.offset + index,
          createdAt: now,
        });
        counts.rejected += 1;
        counts.conflicts += 1;
        writes += 1;
        continue;
      }

      let digestId: Id<"skillsShMirrorDigests">;
      const normalizedSearchFields = searchFields(row);
      if (!existing) {
        digestId = await ctx.db.insert("skillsShMirrorDigests", {
          externalId: row.externalId,
          sourceType: row.sourceType,
          upstreamSourceType: row.upstreamSourceType,
          ...(row.owner ? { owner: row.owner } : {}),
          ...(row.repo ? { repo: row.repo } : {}),
          ...(row.sourceHost ? { sourceHost: row.sourceHost } : {}),
          slug: row.slug,
          ...normalizedSearchFields,
          displayName: row.displayName,
          sourceUrl: row.sourceUrl,
          ...(row.canonicalRepoUrl ? { canonicalRepoUrl: row.canonicalRepoUrl } : {}),
          ...(row.githubPath ? { githubPath: row.githubPath } : {}),
          ...(row.githubCommit ? { githubCommit: row.githubCommit } : {}),
          ...(row.sourceContentHash ? { sourceContentHash: row.sourceContentHash } : {}),
          upstreamInstalls: row.upstreamInstalls,
          upstreamScanners: row.upstreamScanners,
          inferredCategories: row.inferredCategories,
          inferredTopics: row.inferredTopics,
          inferredCategoryConfidence: row.inferredCategoryConfidence,
          inferredTopicConfidence: row.inferredTopicConfidence,
          inferredClassifierVersion: row.inferredClassifierVersion,
          inferredTopicClassifierVersion: row.inferredTopicClassifierVersion,
          inferredInputHash: row.inferredInputHash,
          inferredTopicInputHash: row.inferredTopicInputHash,
          inferredAt: row.inferredAt,
          sourceFreshnessStatus: "observed-only",
          staleQuarantineReason: undefined,
          detailStatus: row.detail ? "available" : "missing",
          observationFingerprint: fingerprint,
          sourceSnapshotId,
          lastObservedRunId: run._id,
          active: true,
          publicVisible: false,
          installable: false,
          firstObservedAt: now,
          lastObservedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        counts.inserted += 1;
        writes += 1;
      } else if (
        existing.observationFingerprint === fingerprint &&
        existing.lastObservedRunId === run._id &&
        existing.sourceFreshnessStatus === "observed-only"
      ) {
        digestId = existing._id;
        counts.unchanged += 1;
      } else {
        digestId = existing._id;
        if (existing.observationFingerprint === fingerprint) counts.unchanged += 1;
        else counts.updated += 1;
        if (!existing.active) counts.reactivated += 1;
        await ctx.db.patch(existing._id, {
          sourceType: row.sourceType,
          upstreamSourceType: row.upstreamSourceType,
          owner: row.owner,
          repo: row.repo,
          sourceHost: row.sourceHost,
          slug: row.slug,
          ...normalizedSearchFields,
          displayName: row.displayName,
          sourceUrl: row.sourceUrl,
          canonicalRepoUrl: row.canonicalRepoUrl,
          githubPath: row.githubPath,
          githubCommit: row.githubCommit,
          sourceContentHash: row.sourceContentHash,
          upstreamInstalls: row.upstreamInstalls,
          upstreamScanners: row.upstreamScanners,
          inferredCategories: row.inferredCategories,
          inferredTopics: row.inferredTopics,
          inferredCategoryConfidence: row.inferredCategoryConfidence,
          inferredTopicConfidence: row.inferredTopicConfidence,
          inferredClassifierVersion: row.inferredClassifierVersion,
          inferredTopicClassifierVersion: row.inferredTopicClassifierVersion,
          inferredInputHash: row.inferredInputHash,
          inferredTopicInputHash: row.inferredTopicInputHash,
          inferredAt: row.inferredAt,
          sourceFreshnessStatus: "observed-only",
          staleQuarantineReason: undefined,
          detailStatus: row.detail ? "available" : "missing",
          observationFingerprint: fingerprint,
          sourceSnapshotId,
          lastObservedRunId: run._id,
          active: true,
          publicVisible: false,
          installable: false,
          tombstonedAt: undefined,
          lastObservedAt: now,
          updatedAt: now,
        });
        writes += 1;
      }

      const facetOperations = await syncFacets(ctx, digestId, row, now);
      reads += facetOperations.reads;
      writes += facetOperations.writes;

      const existingDetail = await ctx.db
        .query("skillsShMirrorDetails")
        .withIndex("by_external_id", (q) => q.eq("externalId", row.externalId))
        .unique();
      reads += 1;
      if (!row.detail) {
        counts.detailsMissing += 1;
        if (existingDetail) {
          await ctx.db.delete(existingDetail._id);
          writes += 1;
        }
      } else if (!existingDetail) {
        await ctx.db.insert("skillsShMirrorDetails", {
          externalId: row.externalId,
          digestId,
          ...row.detail,
          ...(row.sourceContentHash ? { sourceContentHash: row.sourceContentHash } : {}),
          sourceSnapshotId,
          lastObservedRunId: run._id,
          createdAt: now,
          updatedAt: now,
        });
        counts.detailsInserted += 1;
        if (row.detail.truncated) counts.detailsTruncated += 1;
        writes += 1;
      } else if (sameDetail(existingDetail, row)) {
        counts.detailsUnchanged += 1;
        if (row.detail.truncated) counts.detailsTruncated += 1;
        if (existingDetail.lastObservedRunId !== run._id) {
          await ctx.db.patch(existingDetail._id, {
            sourceSnapshotId,
            lastObservedRunId: run._id,
            updatedAt: now,
          });
          writes += 1;
        }
      } else {
        await ctx.db.patch(existingDetail._id, {
          digestId,
          ...row.detail,
          sourceContentHash: row.sourceContentHash,
          sourceSnapshotId,
          lastObservedRunId: run._id,
          updatedAt: now,
        });
        counts.detailsUpdated += 1;
        if (row.detail.truncated) counts.detailsTruncated += 1;
        writes += 1;
      }
    }

    const nextOffset = args.offset + args.rows.length;
    const pageComplete = nextOffset === args.pageLength;
    const sourceComplete = pageComplete && !args.hasMore;
    if (sourceComplete && counts.observed !== run.sourceTotal) {
      throw new ConvexError(
        `skills.sh mirror observed ${counts.observed} rows but source declared ${run.sourceTotal}`,
      );
    }
    const nextPage = pageComplete ? args.page + 1 : args.page;
    const storedOffset = pageComplete ? 0 : nextOffset;
    const patch = {
      status: sourceComplete ? ("reconciling" as const) : ("running" as const),
      page: nextPage,
      offset: storedOffset,
      batchLeaseToken: undefined,
      batchLeaseExpiresAt: undefined,
      counts,
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: reads,
        dbWrites: writes + 1,
        sourceRequests: args.sourceRequests,
        sourceBytes: args.sourceBytes,
      }),
      updatedAt: now,
    };
    await ctx.db.patch(run._id, patch);
    return summarizeRun({ ...run, ...patch });
  },
});

export const reconcileBatchInternal = internalMutation({
  args: {
    runId: v.id("skillsShMirrorRuns"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError("skills.sh mirror run not found");
    if (run.status !== "reconciling") return summarizeRun(run);
    assertIntegerInRange("limit", args.limit, 1, MAX_RECONCILE_ROWS);
    const page = await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_external_id")
      .paginate({ cursor: run.reconcileCursor ?? null, numItems: args.limit });
    const counts = runCounts(run.counts);
    const now = Date.now();
    let reads = page.page.length + 1;
    let writes = 0;
    for (const digest of page.page) {
      if (digest.lastObservedRunId === run._id || !digest.active) continue;
      await ctx.db.patch(digest._id, {
        active: false,
        publicVisible: false,
        installable: false,
        tombstonedAt: now,
        updatedAt: now,
      });
      counts.tombstoned += 1;
      writes += 1;
      const facets = await ctx.db
        .query("skillsShMirrorFacets")
        .withIndex("by_digest_id_and_kind_and_term", (q) => q.eq("digestId", digest._id))
        .collect();
      reads += facets.length + 1;
      for (const facet of facets) {
        if (!facet.active) continue;
        await ctx.db.patch(facet._id, {
          active: false,
          updatedAt: now,
        });
        writes += 1;
      }
    }
    const completed = page.isDone;
    const patch = {
      status: completed ? ("completed" as const) : ("reconciling" as const),
      reconcileCursor: completed ? undefined : page.continueCursor,
      counts,
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: reads,
        dbWrites: writes + 1,
      }),
      ...(completed ? { completedAt: now } : {}),
      updatedAt: now,
    };
    await ctx.db.patch(run._id, patch);
    return summarizeRun({ ...run, ...patch });
  },
});

export const getByExternalIdInternal = internalQuery({
  args: {
    externalId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId.trim().toLowerCase()))
      .unique();
  },
});

export const getDetailByExternalIdInternal = internalQuery({
  args: {
    externalId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("skillsShMirrorDetails")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId.trim().toLowerCase()))
      .unique();
  },
});

export const listActiveByNormalizedSlugInternal = internalQuery({
  args: {
    value: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const value = requiredSearchValue("value", args.value);
    return await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_active_and_normalized_slug", (q) =>
        q.eq("active", true).eq("normalizedSlug", value),
      )
      .take(searchLimit(args.limit));
  },
});

export const listActiveByNormalizedDisplayNameInternal = internalQuery({
  args: {
    value: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const value = requiredSearchValue("value", args.value);
    return await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_active_and_normalized_display_name", (q) =>
        q.eq("active", true).eq("normalizedDisplayName", value),
      )
      .take(searchLimit(args.limit));
  },
});

export const listActiveByNormalizedSlugPrefixInternal = internalQuery({
  args: {
    prefix: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const prefix = requiredSearchValue("prefix", args.prefix);
    return await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_active_and_normalized_slug", (q) =>
        q
          .eq("active", true)
          .gte("normalizedSlug", prefix)
          .lt("normalizedSlug", prefixUpperBound(prefix)),
      )
      .take(searchLimit(args.limit));
  },
});

export const listActiveByNormalizedDisplayNamePrefixInternal = internalQuery({
  args: {
    prefix: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const prefix = requiredSearchValue("prefix", args.prefix);
    return await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_active_and_normalized_display_name", (q) =>
        q
          .eq("active", true)
          .gte("normalizedDisplayName", prefix)
          .lt("normalizedDisplayName", prefixUpperBound(prefix)),
      )
      .take(searchLimit(args.limit));
  },
});

export const listActiveByNormalizedSlugFirstTokenPrefixInternal = internalQuery({
  args: {
    prefix: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const prefix = requiredSearchValue("prefix", args.prefix);
    return await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_active_and_normalized_slug_first_token", (q) =>
        q
          .eq("active", true)
          .gte("normalizedSlugFirstToken", prefix)
          .lt("normalizedSlugFirstToken", prefixUpperBound(prefix)),
      )
      .take(searchLimit(args.limit));
  },
});

export const listActiveByNormalizedDisplayNameFirstTokenPrefixInternal = internalQuery({
  args: {
    prefix: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const prefix = requiredSearchValue("prefix", args.prefix);
    return await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_active_and_normalized_display_name_first_token", (q) =>
        q
          .eq("active", true)
          .gte("normalizedDisplayNameFirstToken", prefix)
          .lt("normalizedDisplayNameFirstToken", prefixUpperBound(prefix)),
      )
      .take(searchLimit(args.limit));
  },
});

export const searchActiveBySearchTextInternal = internalQuery({
  args: {
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const query = requiredSearchValue("query", args.query);
    return await ctx.db
      .query("skillsShMirrorDigests")
      .withSearchIndex("search_by_search_text", (q) =>
        q.search("searchText", query).eq("active", true),
      )
      .take(searchLimit(args.limit));
  },
});

export const listActiveGithubByOwnerInternal = internalQuery({
  args: {
    owner: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const owner = requiredSearchValue("owner", args.owner);
    return await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_active_and_source_type_and_owner_and_repo_and_external_id", (q) =>
        q.eq("active", true).eq("sourceType", "github").eq("owner", owner),
      )
      .paginate(args.paginationOpts);
  },
});

export const listActiveByUpstreamInstallsInternal = internalQuery({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_active_and_upstream_installs", (q) => q.eq("active", true))
      .order("desc")
      .take(searchLimit(args.limit));
  },
});

async function listActiveByFacet(
  ctx: QueryCtx,
  args: {
    kind: "category" | "topic";
    term: string;
    paginationOpts: Infer<typeof paginationOptsValidator>;
  },
) {
  const facets = await ctx.db
    .query("skillsShMirrorFacets")
    .withIndex("by_active_and_kind_and_term_and_installs_and_external_id", (q) =>
      q.eq("active", true).eq("kind", args.kind).eq("term", args.term),
    )
    .order("desc")
    .paginate(args.paginationOpts);
  const page = await Promise.all(facets.page.map((facet) => ctx.db.get(facet.digestId)));
  if (page.some((digest) => !digest?.active)) {
    throw new ConvexError("skills.sh mirror facet references an inactive or missing digest");
  }
  return {
    ...facets,
    page: page as Doc<"skillsShMirrorDigests">[],
  };
}

export const listActiveByCategoryInternal = internalQuery({
  args: {
    categorySlug: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await listActiveByFacet(ctx, {
      kind: "category",
      term: requiredSearchValue("categorySlug", args.categorySlug),
      paginationOpts: args.paginationOpts,
    });
  },
});

export const listActiveByTopicInternal = internalQuery({
  args: {
    topic: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const topic = normalizeCatalogTopic(args.topic);
    if (!topic) throw new ConvexError("topic is required");
    return await listActiveByFacet(ctx, {
      kind: "topic",
      term: topic,
      paginationOpts: args.paginationOpts,
    });
  },
});

export const getClassificationStatesInternal = internalQuery({
  args: {
    externalIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    assertIntegerInRange("externalIds.length", args.externalIds.length, 1, MAX_ROWS_PER_BATCH);
    const externalIds = Array.from(
      new Set(args.externalIds.map((externalId) => externalId.trim().toLowerCase())),
    );
    const digests = await Promise.all(
      externalIds.map((externalId) =>
        ctx.db
          .query("skillsShMirrorDigests")
          .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
          .unique(),
      ),
    );
    return digests.flatMap((digest) => {
      if (
        !digest ||
        !digest.inferredCategories ||
        !digest.inferredTopics ||
        !digest.inferredCategoryConfidence ||
        !digest.inferredTopicConfidence ||
        !digest.inferredClassifierVersion ||
        !digest.inferredTopicClassifierVersion ||
        !digest.inferredInputHash ||
        !digest.inferredTopicInputHash ||
        digest.inferredAt === undefined
      ) {
        return [];
      }
      return [
        {
          externalId: digest.externalId,
          slug: digest.slug,
          displayName: digest.displayName,
          ...(digest.sourceContentHash ? { sourceContentHash: digest.sourceContentHash } : {}),
          inferredCategories: digest.inferredCategories,
          inferredTopics: digest.inferredTopics,
          inferredCategoryConfidence: digest.inferredCategoryConfidence,
          inferredTopicConfidence: digest.inferredTopicConfidence,
          inferredClassifierVersion: digest.inferredClassifierVersion,
          inferredTopicClassifierVersion: digest.inferredTopicClassifierVersion,
          inferredInputHash: digest.inferredInputHash,
          inferredTopicInputHash: digest.inferredTopicInputHash,
          inferredAt: digest.inferredAt,
        },
      ];
    });
  },
});

export const getReplayRowsInternal = internalQuery({
  args: {
    externalIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    assertIntegerInRange("externalIds.length", args.externalIds.length, 1, MAX_ROWS_PER_BATCH);
    const externalIds = Array.from(
      new Set(args.externalIds.map((externalId) => externalId.trim().toLowerCase())),
    );
    return await Promise.all(
      externalIds.map(async (externalId) => {
        const digest = await ctx.db
          .query("skillsShMirrorDigests")
          .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
          .unique();
        if (!digest?.active) {
          throw new ConvexError(
            `skills.sh mirror replay row is missing or inactive: ${externalId}`,
          );
        }
        if (digest.sourceFreshnessStatus === "stale") {
          return {
            quarantined: true as const,
            externalId: digest.externalId,
            upstreamSourceType: digest.upstreamSourceType ?? digest.sourceType,
            reason: digest.staleQuarantineReason ?? "identity-page-fetch-failed",
          };
        }
        const detail = await ctx.db
          .query("skillsShMirrorDetails")
          .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
          .unique();
        const currentDetail =
          digest.detailStatus === "available" &&
          detail?.lastObservedRunId === digest.lastObservedRunId
            ? detail
            : null;
        return { digest, detail: currentDetail };
      }),
    );
  },
});

export const getRunInternal = internalQuery({
  args: {
    runId: v.id("skillsShMirrorRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    return run ? summarizeRun(run) : null;
  },
});

export const listDigestsPageInternal = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    assertIntegerInRange("limit", args.limit, 1, 500);
    return await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_active_and_upstream_installs", (q) => q.eq("active", true))
      .paginate({ cursor: args.cursor, numItems: args.limit });
  },
});

export const listDetailsPageInternal = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    assertIntegerInRange("limit", args.limit, 1, MAX_DETAIL_PAGE_ROWS);
    return await ctx.db
      .query("skillsShMirrorDetails")
      .withIndex("by_external_id")
      .paginate({ cursor: args.cursor, numItems: args.limit });
  },
});

export const listFacetsPageInternal = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    assertIntegerInRange("limit", args.limit, 1, 500);
    return await ctx.db
      .query("skillsShMirrorFacets")
      .withIndex("by_active_and_kind_and_term_and_installs_and_external_id", (q) =>
        q.eq("active", true),
      )
      .paginate({ cursor: args.cursor, numItems: args.limit });
  },
});

export const listConflictsByRunInternal = internalQuery({
  args: {
    runId: v.id("skillsShMirrorRuns"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    assertIntegerInRange("limit", args.limit, 1, 50);
    return await ctx.db
      .query("skillsShMirrorConflicts")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .take(args.limit);
  },
});

export const getStatusInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [control, runs, sampleDigests] = await Promise.all([
      getControl(ctx),
      ctx.db.query("skillsShMirrorRuns").withIndex("by_started_at").order("desc").take(20),
      ctx.db.query("skillsShMirrorDigests").withIndex("by_external_id").take(50),
    ]);
    const latestRunConflicts = runs[0]
      ? await ctx.db
          .query("skillsShMirrorConflicts")
          .withIndex("by_run_id", (q) => q.eq("runId", runs[0]!._id))
          .take(50)
      : [];
    return {
      environment: assertSkillsShFixtureEnvironmentAllowed(),
      control,
      runs: runs.map(summarizeRun),
      sampleDigests,
      sampleConflicts: latestRunConflicts,
      latestRunConflicts,
      invariants: {
        publicVisible: false,
        installable: false,
        scanPlanningEnabled: false,
        scanAdmissionEnabled: false,
        publisherAttachmentEnabled: false,
      },
    };
  },
});

export const getIsolationInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [catalogAttempts, nativeScanJobs] = await Promise.all([
      ctx.db.query("skillsShCatalogScanAttempts").take(1_001),
      ctx.db.query("securityScanJobs").take(1_001),
    ]);
    return {
      catalogScanAttempts: {
        count: catalogAttempts.length,
        isEstimate: catalogAttempts.length > 1_000,
      },
      nativeScanJobs: {
        count: nativeScanJobs.length,
        isEstimate: nativeScanJobs.length > 1_000,
        updatedAtSum: nativeScanJobs.reduce((sum, job) => sum + job.updatedAt, 0),
        statuses: nativeScanJobs.reduce<Record<string, number>>((counts, job) => {
          counts[job.status] = (counts[job.status] ?? 0) + 1;
          return counts;
        }, {}),
      },
    };
  },
});
