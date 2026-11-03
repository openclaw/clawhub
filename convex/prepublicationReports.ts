import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { httpAction, internalMutation, internalQuery, query } from "./functions";
import { assertModerator, requireUser } from "./lib/access";
import { parseBearerToken } from "./lib/apiTokenAuth";
import {
  MAX_PREPUBLICATION_REPORT_BYTES,
  PREPUBLICATION_REPORT_ACTION,
  PREPUBLICATION_REPORT_TARGET,
  prepublicationReportSchema,
  reportContentHash,
} from "./lib/prepublicationReports";
import { matchesStorageSha256 } from "./lib/storageDigests";

const binding = {
  attemptId: v.id("publishAttempts"),
  claimId: v.string(),
  artifactFingerprint: v.string(),
  reportSHA256: v.string(),
};
type Binding = {
  attemptId: Id<"publishAttempts">;
  claimId: string;
  artifactFingerprint: string;
  reportSHA256: string;
};
const receiptTarget = (args: Pick<Binding, "attemptId" | "claimId">) =>
  `${args.attemptId}:${args.claimId}`;
async function lookupReceipt(ctx: QueryCtx | MutationCtx, args: Binding) {
  const rows = await ctx.db
    .query("auditLogs")
    .withIndex("by_target_action", (q) =>
      q
        .eq("targetType", PREPUBLICATION_REPORT_TARGET)
        .eq("targetId", receiptTarget(args))
        .eq("action", PREPUBLICATION_REPORT_ACTION),
    )
    .take(2);
  if (rows.length > 1) throw new ConvexError("Scanner report receipt is ambiguous.");
  return rows[0] ?? null;
}
function sameReceipt(previous: Doc<"auditLogs">, args: Binding) {
  if (
    previous.metadata?.reportSHA256 !== args.reportSHA256 ||
    previous.metadata?.artifactFingerprint !== args.artifactFingerprint
  )
    throw new ConvexError("Scanner report receipt is immutable.");
}
async function activeAttempt(ctx: QueryCtx | MutationCtx, args: Binding) {
  const attempt = await ctx.db.get(args.attemptId);
  if (!attempt || attempt.artifactFingerprint !== args.artifactFingerprint)
    throw new ConvexError("Scanner report artifact mismatch.");
  if (
    attempt.status !== "pending_checks" ||
    attempt.checkClaimId !== args.claimId ||
    (attempt.checkClaimExpiresAt ?? 0) <= Date.now()
  )
    throw new ConvexError("Scanner report claim is not active.");
  return attempt;
}
export const lookupReceiptInternal = internalQuery({ args: binding, handler: lookupReceipt });
export const getUploadContextInternal = internalQuery({
  args: binding,
  handler: async (ctx, args) => {
    const previous = await lookupReceipt(ctx, args);
    if (previous) {
      sameReceipt(previous, args);
      return { receiptId: previous._id, attempt: null };
    }
    return { receiptId: null, attempt: await activeAttempt(ctx, args) };
  },
});
export const recordInternal = internalMutation({
  args: { ...binding, storageId: v.id("_storage"), metadata: v.any() },
  handler: async (ctx, args) => {
    const previous = await lookupReceipt(ctx, args);
    if (previous) {
      sameReceipt(previous, args);
      return { receiptId: previous._id, storageId: previous.metadata.storageId as Id<"_storage"> };
    }
    const attempt = await activeAttempt(ctx, args);
    const storage = await ctx.db.system.get("_storage", args.storageId);
    if (
      !storage ||
      !matchesStorageSha256(storage.sha256, args.reportSHA256) ||
      storage.size !== args.metadata.reportBytes
    )
      throw new ConvexError("Scanner report storage changed.");
    const receiptId = await ctx.db.insert("auditLogs", {
      action: PREPUBLICATION_REPORT_ACTION,
      targetType: PREPUBLICATION_REPORT_TARGET,
      targetId: receiptTarget(args),
      createdAt: Date.now(),
      metadata: {
        ...args.metadata,
        reportSHA256: args.reportSHA256,
        attemptId: attempt._id,
        claimId: args.claimId,
        artifactFingerprint: attempt.artifactFingerprint,
        storageId: args.storageId,
        kind: attempt.kind,
        slug: attempt.slug,
        version: attempt.version,
        publishActorUserId: attempt.userId,
        ownerPublisherId: attempt.ownerPublisherId ?? null,
        skillVersionId: attempt.skillVersionId ?? null,
        packageReleaseId: attempt.packageReleaseId ?? null,
      },
    });
    return { receiptId, storageId: args.storageId };
  },
});

class ReportRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function readReportBody(request: Request) {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_PREPUBLICATION_REPORT_BYTES)
    throw new ReportRequestError(413, "Scanner report is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new ReportRequestError(400, "Scanner report body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PREPUBLICATION_REPORT_BYTES) {
        await reader.cancel();
        throw new ReportRequestError(413, "Scanner report is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// This authenticated HTTP action is the storage ingress itself. No client can
// supply a storage ID; cleanup may touch only a blob created by this invocation.
export const retainHttp = httpAction(async (ctx, request) => {
  const expected = process.env.SECURITY_SCAN_WORKER_TOKEN;
  if (!expected) return new Response("Worker unavailable", { status: 503 });
  if (parseBearerToken(request.headers.get("authorization")) !== expected)
    return new Response("Unauthorized", { status: 401 });
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json" ||
    (request.headers.get("content-encoding") ?? "identity") !== "identity"
  )
    return new Response("JSON content is required.", { status: 400 });
  const args: Binding = {
    attemptId: request.headers.get("x-clawhub-attempt-id") as Id<"publishAttempts">,
    claimId: request.headers.get("x-clawhub-claim-id") ?? "",
    artifactFingerprint: request.headers.get("x-clawhub-artifact-fingerprint") ?? "",
    reportSHA256: request.headers.get("x-clawhub-report-sha256") ?? "",
  };
  if (
    !args.attemptId ||
    !args.claimId ||
    args.claimId.length > 128 ||
    !/^[a-f0-9]{64}$/.test(args.artifactFingerprint) ||
    !/^[a-f0-9]{64}$/.test(args.reportSHA256)
  )
    return new Response("Invalid scanner report binding.", { status: 400 });
  let context;
  try {
    context = await ctx.runQuery(internal.prepublicationReports.getUploadContextInternal, args);
  } catch {
    return new Response("Scanner report claim or receipt does not match.", { status: 409 });
  }
  let bytes;
  let report;
  try {
    bytes = await readReportBody(request);
    if ((await reportContentHash(bytes.buffer)) !== args.reportSHA256)
      throw new ReportRequestError(400, "Scanner report hash mismatch.");
    if (context.receiptId) return Response.json({ receiptId: context.receiptId });
    try {
      report = prepublicationReportSchema.parse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
    } catch {
      throw new ReportRequestError(400, "Invalid scanner report JSON.");
    }
    const expectedAttempt = context.attempt!;
    const actual = report.attempt;
    const files = (rows: Array<{ path: string; size: number; sha256: string }>) =>
      JSON.stringify(
        rows
          .map(({ path, size, sha256 }) => ({ path, size, sha256 }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      );
    if (
      actual.id !== expectedAttempt._id ||
      actual.claimId !== args.claimId ||
      actual.artifactFingerprint !== expectedAttempt.artifactFingerprint ||
      actual.kind !== expectedAttempt.kind ||
      actual.slug !== expectedAttempt.slug ||
      actual.version !== expectedAttempt.version ||
      files(actual.files) !== files(expectedAttempt.files)
    )
      throw new ReportRequestError(400, "Scanner report input binding mismatch.");
    if (report.execution.completedAt < report.execution.startedAt)
      throw new ReportRequestError(400, "Invalid scanner report timing.");
    const native = report.execution.artifact;
    if ((native.content === null) !== ["missing", "unreadable"].includes(native.presence))
      throw new ReportRequestError(400, "Native report presence does not match its bytes.");
    if (native.content !== null) {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(native.content))
        throw new ReportRequestError(400, "Invalid native report encoding.");
      const decoded = Uint8Array.from(atob(native.content), (character) => character.charCodeAt(0));
      if (
        decoded.byteLength !== native.bytes ||
        (await reportContentHash(decoded.buffer)) !== native.sha256
      )
        throw new ReportRequestError(400, "Native report hash mismatch.");
    } else if (native.bytes !== null || native.sha256 !== null)
      throw new ReportRequestError(400, "Invalid missing native report.");
  } catch (error) {
    return new Response(
      error instanceof ReportRequestError ? error.message : "Scanner report could not be read.",
      { status: error instanceof ReportRequestError ? error.status : 400 },
    );
  }
  let storageId: Id<"_storage">;
  try {
    storageId = await ctx.storage.store(new Blob([bytes], { type: "application/json" }));
  } catch {
    return new Response("Scanner report storage is unavailable.", { status: 503 });
  }
  try {
    const result = await ctx.runMutation(internal.prepublicationReports.recordInternal, {
      ...args,
      storageId,
      metadata: {
        reportBytes: bytes.byteLength,
        source: report!.source,
        startedAt: report!.execution.startedAt,
        completedAt: report!.execution.completedAt,
        exitCode: report!.execution.exitCode,
        nativeArtifactSHA256: report!.execution.artifact.sha256,
        checkStatus: report!.projections.check.status,
        projectionsSHA256: await reportContentHash(
          new TextEncoder().encode(JSON.stringify(report!.projections)).buffer,
        ),
      },
    });
    if (result.storageId !== storageId) await ctx.storage.delete(storageId);
    return Response.json({ receiptId: result.receiptId });
  } catch {
    // Resolve an ambiguous mutation outcome before cleaning up. If readback is
    // unavailable, keep our blob rather than delete potentially committed proof.
    try {
      const recorded = await ctx.runQuery(
        internal.prepublicationReports.lookupReceiptInternal,
        args,
      );
      if (recorded?.metadata?.storageId === storageId)
        return Response.json({ receiptId: recorded._id });
      await ctx.storage.delete(storageId);
    } catch {
      /* A private orphan is safer than deleting accepted evidence. */
    }
    return new Response("Scanner report retention was not confirmed.", { status: 503 });
  }
});

function privateReceipt(row: Doc<"auditLogs"> | null) {
  if (
    !row ||
    row.action !== PREPUBLICATION_REPORT_ACTION ||
    row.targetType !== PREPUBLICATION_REPORT_TARGET ||
    row.targetId !== `${row.metadata?.attemptId}:${row.metadata?.claimId}`
  )
    return null;
  return row;
}
export const getForStaff = query({
  args: { receiptId: v.id("auditLogs") },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    const receipt = privateReceipt(await ctx.db.get(args.receiptId));
    if (!receipt) return null;
    const storageId = ctx.db.system.normalizeId("_storage", receipt.metadata.storageId);
    if (!storageId) return null;
    return {
      receiptId: receipt._id,
      ...receipt.metadata,
      reportUrl: await ctx.storage.getUrl(storageId),
    };
  },
});
