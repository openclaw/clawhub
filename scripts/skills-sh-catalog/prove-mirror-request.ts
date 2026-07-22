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
