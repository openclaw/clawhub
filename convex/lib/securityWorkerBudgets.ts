// Whole-package native MCP gets 30m; judge (20m) and optional overview (5m)
// are sequential native stages. Never reuse the skill subprocess timeout here.
const minute = 60_000;
export const pluginScanBudget = {
  subprocessMs: 60 * minute,
  // Includes TruffleHog, artifact preparation, report/commit and cleanup headroom.
  publicationJobMs: 65 * minute,
  publicationLeaseMs: 70 * minute,
  // Explicit rescans can run optional Endor (20m) before ClawScan.
  manualJobMs: 85 * minute,
  manualLeaseMs: 90 * minute,
  publicationWorkerMs: 75 * minute,
  manualWorkerMs: 100 * minute,
} as const;

export function publicationCheckLeaseMs(kind: string, _family: string | undefined) {
  // Physical `claw` Templates now use the same whole-package native MCP budget.
  // Their former 30m lease must not expire during a valid 65m publication job.
  return kind === "package" ? pluginScanBudget.publicationLeaseMs : 30 * minute;
}

export function securityScanLeaseMs(
  targetKind: string,
  scanMode: string | undefined,
  requested: number,
) {
  const legacyLease = Math.max(minute, Math.min(requested, 60 * minute));
  return targetKind === "packageRelease" && scanMode !== "endor-report-only"
    ? Math.max(legacyLease, pluginScanBudget.manualLeaseMs)
    : legacyLease;
}

// The claim window is not a kill deadline: stop admission early enough for the
// largest admissible job to drain before the separate hosted worker step ends.
export function canAdmitSecurityScan(
  now: number,
  claimDeadline: number,
  workerDeadline: number,
  drainMs: number,
) {
  return now < claimDeadline && now + drainMs <= workerDeadline;
}

// Hosted jobs publish their absolute deadline before setup. Slow installation must
// reduce admission, not let the worker assume it still owns a fresh full window.
export function securityWorkerDeadline(
  startedAt: number,
  workerBudgetMs: number,
  hostDeadline: string | undefined,
) {
  if (!hostDeadline) return startedAt + workerBudgetMs;
  const parsed = Number(hostDeadline);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error("Invalid hosted security worker deadline");
  return Math.min(startedAt + workerBudgetMs, parsed);
}
