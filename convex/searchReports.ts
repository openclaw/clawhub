import { NonRetryableError, Workpool, vOnCompleteArgs, type WorkId } from "@convex-dev/workpool";
import { ConvexError, v } from "convex/values";
import type {
  SearchReportResponse,
  SearchReportStatus,
} from "../packages/clawhub/src/schema/searchReports";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./functions";
import { assertModerator, requireUser, requireUserFromAction } from "./lib/access";
import {
  REPORT_CHUNK_BYTES,
  REPORT_MAX_CHUNKS,
  REPORT_TTL_MS,
  REPORT_VERSION,
  normalizeReportRequest,
  reportRequest,
  type ReportRequest,
} from "./lib/searchReportContract";
import {
  collectReportEvidence,
  renderReportEvidence,
  type ReportEvidence,
} from "./lib/searchReportEvidence";
import { hashToken } from "./lib/tokens";

const pool = new Workpool(components.searchReports, {
  maxParallelism: 1,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 1000, base: 2 },
});
const idArgs = { reportId: v.string() };

async function requireStaff(ctx: QueryCtx | MutationCtx) {
  const { user } = await requireUser(ctx);
  assertModerator(user);
}
async function findRun(ctx: QueryCtx, reportId: string) {
  const id = ctx.db.normalizeId("searchReportRuns", reportId);
  return id ? ctx.db.get(id) : null;
}
async function readRun(ctx: QueryCtx, reportId: string) {
  const row = await findRun(ctx, reportId);
  if (!row) throw new ConvexError("report_not_found");
  return row;
}
async function sourceRevision(ctx: QueryCtx, request: ReportRequest): Promise<string> {
  const state = await ctx.runQuery(internal.searchInsights.getAggregateStateInternal, {});
  const classification = await ctx.runQuery(internal.searchInsights.getClassificationRunInternal, {
    endDay: request.endDay!,
    artifactKind: request.artifactKind,
  });
  return JSON.stringify([
    state?.revision ?? null,
    classification?._id ?? null,
    classification?.processedAt ?? null,
  ]);
}
async function envelope(
  ctx: QueryCtx,
  row: Doc<"searchReportRuns">,
  now: number,
): Promise<SearchReportStatus> {
  const work = row.workId
    ? await pool.status(ctx, row.workId as WorkId)
    : { state: "finished" as const };
  const expired = row.expirationTime <= now;
  return {
    reportId: row._id,
    view: row.request.view,
    status: expired
      ? "expired"
      : row.state !== "pending"
        ? row.state
        : work.state === "finished"
          ? "incomplete"
          : work.state,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt ?? null,
    expirationTime: row.expirationTime,
    previousAttempts:
      work.state === "finished" ? (row.previousAttempts ?? 0) : work.previousAttempts,
    failureCode: expired
      ? "report_expired"
      : (row.failureCode ??
        (row.state === "pending" && work.state === "finished" ? "report_incomplete" : null)),
    reportVersion: row.reportVersion,
  };
}

async function startReport(ctx: MutationCtx, input: ReportRequest): Promise<SearchReportStatus> {
  const original = input.refreshOf ? await readRun(ctx, input.refreshOf) : null;
  if (original && original.request.view !== input.view)
    throw new ConvexError("refresh_request_mismatch");
  const request = normalizeReportRequest(
    original && Object.keys(input).every((key) => key === "view" || key === "refreshOf")
      ? original.request
      : input,
    Date.now(),
  );
  const requestKey = await hashToken(JSON.stringify([REPORT_VERSION, request]));
  const revision = await sourceRevision(ctx, request);
  let previous: Doc<"searchReportRuns"> | null;
  let refreshOf: Id<"searchReportRuns"> | undefined;
  if (input.refreshOf) {
    const parent = await readRun(ctx, input.refreshOf);
    if (parent.requestKey !== requestKey) throw new ConvexError("refresh_request_mismatch");
    refreshOf = parent._id;
    previous = await ctx.db
      .query("searchReportRuns")
      .withIndex("by_refreshOf", (q) => q.eq("refreshOf", parent._id))
      .order("desc")
      .first();
  } else {
    previous = await ctx.db
      .query("searchReportRuns")
      .withIndex("by_requestKey", (q) => q.eq("requestKey", requestKey))
      .order("desc")
      .first();
  }
  if (
    previous &&
    previous.expirationTime > Date.now() &&
    (input.refreshOf || previous.sourceRevision === revision)
  )
    return envelope(ctx, previous, Date.now());
  const requestedAt = Date.now();
  const reportId = await ctx.db.insert("searchReportRuns", {
    request,
    requestKey,
    sourceRevision: revision,
    reportVersion: REPORT_VERSION,
    ...(refreshOf ? { refreshOf } : {}),
    requestedAt,
    expirationTime: requestedAt + REPORT_TTL_MS,
    state: "pending",
  });
  const workId = await pool.enqueueAction(
    ctx,
    internal.searchReports.generateInternal,
    { reportId },
    {
      onComplete: internal.searchReports.completedInternal,
      context: { reportId },
    },
  );
  await ctx.db.patch(reportId, { workId });
  return envelope(ctx, (await ctx.db.get(reportId))!, Date.now());
}

export const start = mutation({
  args: reportRequest,
  handler: async (ctx, input) => {
    await requireStaff(ctx);
    return startReport(ctx, input);
  },
});
export const startInternal = internalMutation({ args: reportRequest, handler: startReport });
export const status = query({
  args: { ...idArgs, now: v.number() },
  handler: async (ctx, { reportId, now }): Promise<SearchReportStatus | null> => {
    await requireStaff(ctx);
    const row = await findRun(ctx, reportId);
    return row ? envelope(ctx, row, now) : null;
  },
});
export const readInternal = internalQuery({
  args: { ...idArgs, now: v.number() },
  handler: async (ctx, { reportId, now }) => {
    const row = await readRun(ctx, reportId);
    return { row, status: await envelope(ctx, row, now) };
  },
});
export const sourceRevisionInternal = internalQuery({
  args: { request: reportRequest },
  handler: (ctx, { request }): Promise<string> => sourceRevision(ctx, request),
});

export const generateInternal = internalAction({
  args: { reportId: v.id("searchReportRuns") },
  handler: async (ctx, { reportId }): Promise<{ reportId: string }> => {
    let phase = "report_read_failed";
    try {
      const { row, status: state } = await ctx.runQuery(internal.searchReports.readInternal, {
        reportId,
        now: Date.now(),
      });
      if (state.status === "ready") return { reportId };
      if (state.status === "expired" || state.status === "failed")
        throw new NonRetryableError("report_expired");
      phase = "report_collection_failed";
      const revision = await ctx.runQuery(internal.searchReports.sourceRevisionInternal, {
        request: row.request,
      });
      const evidence = await collectReportEvidence(ctx, row.request);
      if (
        revision !==
        (await ctx.runQuery(internal.searchReports.sourceRevisionInternal, {
          request: row.request,
        }))
      )
        throw new Error("report_source_changed");
      phase = "report_encoding_failed";
      const serialized = JSON.stringify(evidence);
      const bytes = new TextEncoder().encode(serialized);
      if (bytes.byteLength > REPORT_CHUNK_BYTES * REPORT_MAX_CHUNKS) {
        phase = "report_too_large";
        throw new NonRetryableError(phase);
      }
      const chunks: ArrayBuffer[] = [];
      for (let offset = 0; offset < bytes.length; offset += REPORT_CHUNK_BYTES)
        chunks.push(bytes.slice(offset, offset + REPORT_CHUNK_BYTES).buffer);
      phase = "report_commit_failed";
      await ctx.runMutation(internal.searchReports.commitInternal, {
        reportId,
        chunks,
        resultBytes: bytes.length,
        resultHash: await hashToken(serialized),
        sourceRevision: revision,
      });
      return { reportId };
    } catch (error) {
      if (error instanceof ConvexError && error.data === "report_catalog_unavailable")
        phase = error.data;
      // Workpool records thrown errors. Never forward catalog queries or provider
      // errors into its logs, retry payloads, or completion context.
      await ctx.runMutation(internal.searchReports.failureInternal, { reportId, code: phase });
      if (error instanceof NonRetryableError) throw new NonRetryableError(phase);
      // oxlint-disable-next-line preserve-caught-error -- Workpool must never log a cause containing private search terms.
      throw new Error(phase);
    }
  },
});

export const failureInternal = internalMutation({
  args: { reportId: v.id("searchReportRuns"), code: v.string() },
  handler: async (ctx, { reportId, code }) => {
    const row = await ctx.db.get(reportId);
    if (row?.state === "pending" && row.expirationTime > Date.now()) {
      const work = await pool.status(ctx, row.workId as WorkId);
      await ctx.db.patch(reportId, {
        failureCode: code,
        previousAttempts:
          work.state === "finished" ? (row.previousAttempts ?? 0) : work.previousAttempts + 1,
      });
    }
  },
});
export const commitInternal = internalMutation({
  args: {
    reportId: v.id("searchReportRuns"),
    chunks: v.array(v.bytes()),
    resultBytes: v.number(),
    resultHash: v.string(),
    sourceRevision: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.reportId);
    if (!row || row.expirationTime <= Date.now()) throw new NonRetryableError("report_expired");
    if (row.state === "ready") return;
    if (row.state !== "pending") throw new NonRetryableError("report_terminal");
    if (
      !args.chunks.length ||
      args.chunks.length > REPORT_MAX_CHUNKS ||
      args.chunks.some((chunk) => chunk.byteLength > REPORT_CHUNK_BYTES) ||
      args.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) !== args.resultBytes
    )
      throw new NonRetryableError("report_too_large");
    for (const [index, bytes] of args.chunks.entries())
      await ctx.db.insert("searchReportChunks", {
        reportId: row._id,
        index,
        bytes,
        expirationTime: row.expirationTime,
      });
    const work = await pool.status(ctx, row.workId as WorkId);
    await ctx.db.patch(row._id, {
      state: "ready",
      completedAt: Date.now(),
      failureCode: undefined,
      chunkCount: args.chunks.length,
      resultBytes: args.resultBytes,
      resultHash: args.resultHash,
      sourceRevision: args.sourceRevision,
      previousAttempts:
        work.state === "finished" ? (row.previousAttempts ?? 0) : work.previousAttempts,
    });
  },
});
export const completedInternal = internalMutation({
  args: vOnCompleteArgs(
    v.object({ reportId: v.id("searchReportRuns") }),
    v.object({ reportId: v.string() }),
  ),
  handler: async (ctx, { workId, context, result }) => {
    const row = await ctx.db.get(context.reportId);
    if (
      !row ||
      row.workId !== workId ||
      row.state !== "pending" ||
      row.expirationTime <= Date.now()
    )
      return;
    const work = await pool.status(ctx, workId);
    await ctx.db.patch(row._id, {
      state: "failed",
      completedAt: Date.now(),
      previousAttempts:
        work.state === "finished" ? (row.previousAttempts ?? 0) : work.previousAttempts,
      failureCode:
        result.kind === "success"
          ? "report_incomplete"
          : (row.failureCode ?? "report_generation_failed"),
    });
  },
});

export const chunksInternal = internalQuery({
  args: { ...idArgs, now: v.number() },
  handler: async (ctx, { reportId, now }) => {
    const row = await readRun(ctx, reportId);
    if (row.expirationTime <= now || row.state !== "ready") throw new Error("report_unavailable");
    return ctx.db
      .query("searchReportChunks")
      .withIndex("by_reportId_index", (q) => q.eq("reportId", row._id))
      .take(REPORT_MAX_CHUNKS + 1);
  },
});
async function getReport(ctx: ActionCtx, reportId: string): Promise<SearchReportResponse> {
  const { row, status: state } = await ctx.runQuery(internal.searchReports.readInternal, {
    reportId,
    now: Date.now(),
  });
  if (state.status !== "ready") return state as SearchReportResponse;
  try {
    const chunks = await ctx.runQuery(internal.searchReports.chunksInternal, {
      reportId,
      now: Date.now(),
    });
    if (chunks.length !== row.chunkCount || chunks.some((chunk, index) => chunk.index !== index))
      throw new Error("report_incomplete");
    const bytes = new Uint8Array(row.resultBytes!);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(new Uint8Array(chunk.bytes), offset);
      offset += chunk.bytes.byteLength;
    }
    if (offset !== bytes.length) throw new Error("report_incomplete");
    const serialized = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if ((await hashToken(serialized)) !== row.resultHash) throw new Error("report_incomplete");
    const rendered = await renderReportEvidence(
      ctx,
      JSON.parse(serialized) as ReportEvidence,
      row.request.limit!,
    );
    if (row.expirationTime <= Date.now())
      return { ...state, status: "expired", failureCode: "report_expired" };
    return { ...state, ...rendered, status: "ready" };
  } catch {
    return { ...state, status: "incomplete", failureCode: "report_evidence_unavailable" };
  }
}
export const get = action({
  args: idArgs,
  handler: async (ctx, { reportId }): Promise<SearchReportResponse> => {
    const { user } = await requireUserFromAction(ctx);
    assertModerator(user);
    return getReport(ctx, reportId);
  },
});
export const getInternal = internalAction({
  args: idArgs,
  handler: (ctx, { reportId }): Promise<SearchReportResponse> => getReport(ctx, reportId),
});

export const pruneExpiredInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Eight bounded chunks are removed before each parent; late completions cannot
    // resurrect an expired generation. Workpool owns cancellation and recovery.
    // Reserve half of the 16MiB read budget for component/parent metadata. Three
    // maximum-size reports fit below 8MiB; a row-count-only batch could read100MiB.
    const batchSize = Math.floor(
      (8 * 1024 * 1024) / (REPORT_MAX_CHUNKS * REPORT_CHUNK_BYTES + 1024),
    );
    const rows = await ctx.db
      .query("searchReportRuns")
      .withIndex("by_expirationTime", (q) => q.lte("expirationTime", Date.now()))
      .take(batchSize);
    for (const row of rows) {
      if (row.workId && row.state === "pending") await pool.cancel(ctx, row.workId as WorkId);
      const chunks = await ctx.db
        .query("searchReportChunks")
        .withIndex("by_reportId_index", (q) => q.eq("reportId", row._id))
        .take(REPORT_MAX_CHUNKS + 1);
      for (const chunk of chunks) await ctx.db.delete(chunk._id);
      await ctx.db.delete(row._id);
    }
    if (rows.length === batchSize)
      await ctx.scheduler.runAfter(0, internal.searchReports.pruneExpiredInternal, {});
    return rows.length;
  },
});
