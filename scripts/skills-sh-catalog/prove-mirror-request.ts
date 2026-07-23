export function buildMirrorProofHeaders(
  operatorAuthorization: string,
  vercelAutomationBypassSecret?: string,
) {
  return {
    Authorization: `Bearer ${operatorAuthorization}`,
    "Content-Type": "application/json",
    ...(vercelAutomationBypassSecret?.trim()
      ? { "x-vercel-protection-bypass": vercelAutomationBypassSecret.trim() }
      : {}),
  };
}

export function mirrorRateLimitRetryDelayMs(
  status: number,
  retryAfterHeader: string | null,
  attempt: number,
) {
  if (status !== 429) return null;
  const retryAfterSeconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
  const requestedMs =
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? retryAfterSeconds * 1_000
      : 1_000 * 2 ** attempt;
  return Math.max(1_000, requestedMs);
}

export function mirrorRunAccounting(total: number, counts: Record<string, number>) {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("mirror source total must be a nonnegative integer");
  }
  const requiredCount = (name: "conflicts" | "rejected" | "quarantined") => {
    const value = counts[name];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`mirror ${name} must be a nonnegative integer`);
    }
    return value;
  };
  const rejected = requiredCount("rejected");
  const quarantined = requiredCount("quarantined");
  const conflicts = requiredCount("conflicts");
  if (conflicts !== rejected) {
    throw new Error("mirror conflict accounting does not equal rejected rows");
  }
  if (quarantined > rejected) {
    throw new Error("mirror quarantine accounting exceeds rejected rows");
  }
  const accepted = total - rejected;
  if (accepted < 0) {
    throw new Error("mirror rejected rows exceed the source total");
  }
  return { accepted, rejected, quarantined };
}

export function mirrorRunFromPayload(
  payload: Record<string, unknown>,
  operation: string,
): Record<string, unknown> {
  const nested = payload.run;
  const candidates = [
    payload,
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : null,
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      ["running", "paused", "reconciling", "completed", "failed"].includes(String(candidate.status))
    ) {
      return candidate;
    }
  }
  const diagnostic = JSON.stringify(payload).slice(0, 1_000);
  throw new Error(`${operation} mirror response lacks run status: ${diagnostic}`);
}

type CapturedMirrorStepSource = {
  externalIds: string[];
  sourcePageSize: number;
};

export function buildMirrorStepRequest(args: {
  runId: string;
  page: number;
  offset: number;
  capturedSource?: CapturedMirrorStepSource | null;
}) {
  if (!args.capturedSource) {
    return {
      operation: "step" as const,
      runId: args.runId,
      page: args.page,
      offset: args.offset,
    };
  }
  const { externalIds, sourcePageSize } = args.capturedSource;
  const pageStart = args.page * sourcePageSize;
  const pageLength = Math.min(sourcePageSize, externalIds.length - pageStart);
  const rowStart = pageStart + args.offset;
  const rows = externalIds.slice(rowStart, rowStart + 50);
  if (pageLength < 1 || rows.length < 1) {
    throw new Error(`captured mirror replay has no rows for cursor ${args.page}:${args.offset}`);
  }
  return {
    operation: "step-replay" as const,
    runId: args.runId,
    page: args.page,
    offset: args.offset,
    pageLength,
    hasMore: pageStart + sourcePageSize < externalIds.length,
    sourceTotal: externalIds.length,
    externalIds: rows,
  };
}

export async function reconcileMirrorRunToCompletion(
  initialRun: Record<string, unknown>,
  reconcile: () => Promise<Record<string, unknown>>,
) {
  let run = initialRun;
  let reconciliationBatches = 0;
  while (run.status === "reconciling") {
    if (reconciliationBatches >= 1_000) {
      throw new Error("mirror reconciliation exceeded 1000 bounded batches");
    }
    run = mirrorRunFromPayload(await reconcile(), "reconcile");
    reconciliationBatches += 1;
  }
  return { run, reconciliationBatches };
}

export type RecoverableMirrorRun = {
  runId: string;
  snapshotId: string;
  status: "running" | "paused" | "reconciling";
  page: number;
  offset: number;
  sourceTotal: number;
  sourcePageSize: number;
  sourceMeasuredAt: string;
  startedAt: number;
};

export function findRecoverableMirrorRun(
  payload: Record<string, unknown>,
): RecoverableMirrorRun | null {
  if (!Array.isArray(payload.runs)) return null;
  for (const value of payload.runs) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const run = value as Record<string, unknown>;
    if (
      !["running", "paused", "reconciling"].includes(String(run.status)) ||
      typeof run.runId !== "string" ||
      typeof run.snapshotId !== "string" ||
      typeof run.page !== "number" ||
      typeof run.offset !== "number" ||
      typeof run.sourceTotal !== "number" ||
      typeof run.sourcePageSize !== "number" ||
      typeof run.sourceMeasuredAt !== "string" ||
      typeof run.startedAt !== "number"
    ) {
      continue;
    }
    return run as RecoverableMirrorRun;
  }
  return null;
}

export type CompletedLiveMirrorRun = {
  runId: string;
  snapshotId: string;
  status: "completed";
  page: number;
  offset: number;
  sourceTotal: number;
  sourcePageSize: number;
  sourceMeasuredAt: string;
  startedAt: number;
  completedAt: number;
  counts: Record<string, number>;
  operations: Record<string, number>;
};

export function capturedMirrorSourceRunId(snapshotId: string) {
  const prefix = "skills-sh-captured:";
  return snapshotId.startsWith(prefix) ? snapshotId.slice(prefix.length) || null : null;
}

export function findCompletedLiveMirrorRun(
  payload: Record<string, unknown>,
  runId?: string | null,
): CompletedLiveMirrorRun | null {
  const candidates = [payload, ...(Array.isArray(payload.runs) ? payload.runs : [])];
  for (const value of candidates) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const run = value as Record<string, unknown>;
    if (
      run.status !== "completed" ||
      typeof run.runId !== "string" ||
      (runId && run.runId !== runId) ||
      typeof run.snapshotId !== "string" ||
      !run.snapshotId.startsWith("skills-sh:") ||
      run.snapshotId.startsWith("skills-sh-captured:") ||
      typeof run.page !== "number" ||
      typeof run.offset !== "number" ||
      typeof run.sourceTotal !== "number" ||
      typeof run.sourcePageSize !== "number" ||
      typeof run.sourceMeasuredAt !== "string" ||
      typeof run.startedAt !== "number" ||
      typeof run.completedAt !== "number" ||
      !run.counts ||
      typeof run.counts !== "object" ||
      Array.isArray(run.counts) ||
      !run.operations ||
      typeof run.operations !== "object" ||
      Array.isArray(run.operations)
    ) {
      continue;
    }
    return run as CompletedLiveMirrorRun;
  }
  return null;
}
