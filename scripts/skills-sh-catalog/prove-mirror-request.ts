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

export type RecoverableMirrorRun = {
  runId: string;
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
