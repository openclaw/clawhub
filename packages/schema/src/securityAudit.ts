// The public version endpoint and the discovered Skill page describe the same snapshot.
export type NormalizedSecurityStatus = "clean" | "suspicious" | "malicious" | "pending" | "error";

export function normalizeSecurityStatus(
  value: string | null | undefined,
): NormalizedSecurityStatus {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "benign":
    case "clean":
      return "clean";
    case "suspicious":
      return "suspicious";
    case "malicious":
      return "malicious";
    case "error":
    case "failed":
    case "completed":
      return "error";
    case "pending":
    case "loading":
    case "not_found":
    case "not-found":
    case "stale":
      return "pending";
    default:
      return "pending";
  }
}

export function getSkillReleaseScanStatus(version: {
  sha256hash?: string | null;
  skillSpectorAnalysis?: { status: string } | null;
  llmAnalysis?: { verdict?: string | null; status: string } | null;
}): NormalizedSecurityStatus | null {
  if (!version.sha256hash && !version.skillSpectorAnalysis && !version.llmAnalysis) return null;
  return normalizeSecurityStatus(version.llmAnalysis?.verdict ?? version.llmAnalysis?.status);
}

type SecurityAuditOverviewInput = {
  llmAnalysis?: {
    summary?: string | null;
    guidance?: string | null;
    status?: string | null;
    verdict?: string | null;
  } | null;
};

export function getSecurityAuditOverviewCopy({
  llmAnalysis,
}: SecurityAuditOverviewInput): string[] {
  const status = (llmAnalysis?.verdict ?? llmAnalysis?.status)?.trim().toLowerCase();
  const unavailable = ["benign", "clean", "suspicious", "malicious", "completed"].includes(
    status ?? "",
  )
    ? "No overview is available for this completed security scan."
    : ["failed", "error"].includes(status ?? "")
      ? "The security scan failed. No overview is available."
      : "No security analysis has been recorded yet.";
  return [
    llmAnalysis?.summary?.trim() || unavailable,
    llmAnalysis?.guidance?.trim() || null,
  ].filter((copy): copy is string => Boolean(copy));
}

export function formatSecurityAuditOverview(input: SecurityAuditOverviewInput): string {
  return getSecurityAuditOverviewCopy(input).join("\n\n");
}

type AuditRiskFinding = {
  status?: string;
  severity?: string;
  confidence?: string;
  evidence?: unknown;
};
type AuditLlmAnalysis = {
  status?: string | null;
  verdict?: string | null;
  agenticRiskFindings?: AuditRiskFinding[];
};

export function getSecuritySeverityRank(severity?: string) {
  switch (severity?.trim().toLowerCase()) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}

function isLowConfidence(value: unknown) {
  return typeof value === "string" && value.trim().toLowerCase() === "low";
}

export function isVisibleAgenticRiskFinding(finding: AuditRiskFinding) {
  return (
    (finding.status === "note" || finding.status === "concern") &&
    Boolean(finding.evidence) &&
    !isLowConfidence(finding.confidence)
  );
}

function highestVisibleFindingSeverityRank(analysis?: AuditLlmAnalysis | null) {
  let highest = 0;
  for (const finding of (analysis?.agenticRiskFindings ?? []).filter(isVisibleAgenticRiskFinding)) {
    highest = Math.max(highest, getSecuritySeverityRank(finding.severity));
  }
  return highest;
}

export function getClawScanDisplayStatus(analysis?: AuditLlmAnalysis | null) {
  const status = (analysis?.verdict ?? analysis?.status)?.trim().toLowerCase();
  if (!status) return "pending";
  const highestSeverity = highestVisibleFindingSeverityRank(analysis);
  if (status === "suspicious") {
    return "review";
  }
  if (
    (status === "clean" || status === "benign") &&
    highestSeverity >= getSecuritySeverityRank("medium")
  ) {
    return "review";
  }
  return status;
}

export function aggregateAuditVerdict(signals: { llmAnalysis?: AuditLlmAnalysis | null }) {
  const clawScanStatus = getClawScanDisplayStatus(signals.llmAnalysis);
  if (clawScanStatus === "malicious") return "malicious";
  if (
    clawScanStatus === "review" ||
    clawScanStatus === "suspicious" ||
    clawScanStatus === "warn" ||
    clawScanStatus === "warning"
  ) {
    return "review";
  }
  return clawScanStatus;
}
