export const CLAW_SCAN_VERDICTS = ["clean", "review", "warn", "malicious"] as const;
export type ClawScanVerdict = (typeof CLAW_SCAN_VERDICTS)[number];

export const CLAW_SCAN_STATES = ["pending", "running", "complete", "error"] as const;
export type ClawScanState = (typeof CLAW_SCAN_STATES)[number];

export function normalizeClawScanVerdict(value: string | null | undefined): ClawScanVerdict | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "benign") return "clean";
  if (normalized === "suspicious") return "review";
  if (normalized === "warning") return "warn";
  if (
    normalized === "clean" ||
    normalized === "review" ||
    normalized === "warn" ||
    normalized === "malicious"
  ) {
    return normalized;
  }
  return null;
}

export function clawScanStateFromAnalysisStatus(status: string | null | undefined): ClawScanState {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "error" || normalized === "failed") return "error";
  if (normalized === "pending" || normalized === "not_found") return "pending";
  if (normalized === "running" || normalized === "loading") return "running";
  return "complete";
}

export function isBlockingClawScanVerdict(verdict: ClawScanVerdict | null | undefined) {
  return verdict === "malicious";
}
