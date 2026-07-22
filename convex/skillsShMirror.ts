import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./functions";
import { tokenize } from "./lib/searchText";
import { assertSkillsShFixtureEnvironmentAllowed } from "./lib/skillsShCatalogEnvironment";

const CONTROL_KEY = "global";
const ENABLE_CONFIRM = "enable-skills-sh-mirror-test";
const PAUSE_CONFIRM = "set-skills-sh-mirror-pause";
const MAX_ROWS_PER_RUN = 10_000;
const MAX_ROWS_PER_BATCH = 50;
const MAX_DETAIL_BYTES = 64 * 1024;
const MAX_RECONCILE_ROWS = 250;
const MAX_SOURCE_ATTEMPTS = 4;
const MAX_SEARCH_ROWS = 50;
const MAX_SCANNER_STATUS_LENGTH = 32;
const MAX_SCANNER_URL_LENGTH = 2_048;

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

const rowValidator = v.object({
  externalId: v.string(),
  sourceType: v.union(v.literal("github"), v.literal("well-known")),
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
  detail: v.optional(detailValidator),
});

type MirrorRow = Infer<typeof rowValidator>;

function assertIntegerInRange(name: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConvexError(`${name} must be an integer between ${min} and ${max}`);
  }
}

function emptyCounts(): Doc<"skillsShMirrorRuns">["counts"] {
  return {
    observed: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
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
    upstreamScanners: {
      genAgentTrustHub: normalizeScanner(row.upstreamScanners.genAgentTrustHub),
      socket: normalizeScanner(row.upstreamScanners.socket),
      snyk: normalizeScanner(row.upstreamScanners.snyk),
    },
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
    searchText: [row.displayName, row.slug, row.owner, row.repo, row.sourceHost]
      .filter((value): value is string => Boolean(value))
      .join(" "),
  };
}

function validIdentity(row: MirrorRow) {
  if (!row.externalId || !row.slug || !row.sourceUrl) return false;
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

function summarizeRun(run: Doc<"skillsShMirrorRuns">) {
  return {
    runId: run._id,
    snapshotId: run.snapshotId,
    status: run.status,
    sourceTotal: run.sourceTotal,
    sourcePageSize: run.sourcePageSize,
    sourceMeasuredAt: run.sourceMeasuredAt,
    page: run.page,
    offset: run.offset,
    counts: run.counts,
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
    const runId = await ctx.db.insert("skillsShMirrorRuns", {
      snapshotId: args.snapshotId.trim(),
      status: "running",
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
    });
    return { runId };
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

export const processBatchInternal = internalMutation({
  args: {
    runId: v.id("skillsShMirrorRuns"),
    page: v.number(),
    offset: v.number(),
    pageLength: v.number(),
    hasMore: v.boolean(),
    sourceTotal: v.number(),
    sourceRequests: v.number(),
    sourceBytes: v.number(),
    rows: v.array(rowValidator),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const [controlDoc, run] = await Promise.all([getControl(ctx), ctx.db.get(args.runId)]);
    const control = requireActiveControl(controlDoc);
    if (!run) throw new ConvexError("skills.sh mirror run not found");
    if (run.status === "paused") throw new ConvexError("skills.sh mirror run is paused");
    if (run.status !== "running") return summarizeRun(run);
    if (args.page !== run.page || args.offset !== run.offset) {
      throw new ConvexError(`skills.sh mirror cursor mismatch: expected ${run.page}:${run.offset}`);
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
      1,
      MAX_SOURCE_ATTEMPTS * (1 + 2 * args.rows.length),
    );
    assertIntegerInRange("sourceBytes", args.sourceBytes, 0, 100 * 1024 * 1024);
    if (args.offset + args.rows.length > args.pageLength) {
      throw new ConvexError("skills.sh mirror batch exceeds the source page");
    }

    const counts = { ...run.counts };
    let reads = 2;
    let writes = 0;
    const now = Date.now();
    for (let index = 0; index < args.rows.length; index += 1) {
      const row = normalizeRow(args.rows[index]!);
      const fingerprint = observationFingerprint(row);
      counts.observed += 1;
      if (
        !validIdentity(row) ||
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
      if (
        existing?.lastObservedRunId === run._id &&
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
          sourceFreshnessStatus: "observed-only",
          detailStatus: row.detail ? "available" : "missing",
          observationFingerprint: fingerprint,
          sourceSnapshotId: run.snapshotId,
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
        existing.lastObservedRunId === run._id
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
          detailStatus: row.detail ? "available" : "missing",
          observationFingerprint: fingerprint,
          sourceSnapshotId: run.snapshotId,
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

      const existingDetail = await ctx.db
        .query("skillsShMirrorDetails")
        .withIndex("by_external_id", (q) => q.eq("externalId", row.externalId))
        .unique();
      reads += 1;
      if (!row.detail) {
        counts.detailsMissing += 1;
      } else if (!existingDetail) {
        await ctx.db.insert("skillsShMirrorDetails", {
          externalId: row.externalId,
          digestId,
          ...row.detail,
          ...(row.sourceContentHash ? { sourceContentHash: row.sourceContentHash } : {}),
          sourceSnapshotId: run.snapshotId,
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
            sourceSnapshotId: run.snapshotId,
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
          sourceSnapshotId: run.snapshotId,
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
    const counts = { ...run.counts };
    const now = Date.now();
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
    }
    const completed = page.isDone;
    const patch = {
      status: completed ? ("completed" as const) : ("reconciling" as const),
      reconcileCursor: completed ? undefined : page.continueCursor,
      counts,
      operations: addOperations(run.operations, {
        functionCalls: 1,
        dbReads: page.page.length + 1,
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
      .withIndex("by_external_id")
      .paginate({ cursor: args.cursor, numItems: args.limit });
  },
});

export const listDetailsPageInternal = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    assertIntegerInRange("limit", args.limit, 1, 500);
    return await ctx.db
      .query("skillsShMirrorDetails")
      .withIndex("by_external_id")
      .paginate({ cursor: args.cursor, numItems: args.limit });
  },
});

export const getStatusInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [control, runs, sampleDigests, sampleConflicts] = await Promise.all([
      getControl(ctx),
      ctx.db.query("skillsShMirrorRuns").withIndex("by_started_at").order("desc").take(20),
      ctx.db.query("skillsShMirrorDigests").withIndex("by_external_id").take(50),
      ctx.db.query("skillsShMirrorConflicts").withIndex("by_run_id").take(50),
    ]);
    return {
      environment: assertSkillsShFixtureEnvironmentAllowed(),
      control,
      runs: runs.map(summarizeRun),
      sampleDigests,
      sampleConflicts,
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
