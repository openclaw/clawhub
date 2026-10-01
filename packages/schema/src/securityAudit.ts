type SecurityAuditOverviewInput = {
  llmAnalysis?: {
    summary?: string | null;
    guidance?: string | null;
  } | null;
};

export function getSecurityAuditOverviewCopy({
  llmAnalysis,
}: SecurityAuditOverviewInput): string[] {
  return [
    llmAnalysis?.summary?.trim() || "No security analysis has been recorded yet.",
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

function severityRank(severity?: string) {
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
    highest = Math.max(highest, severityRank(finding.severity));
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
  if ((status === "clean" || status === "benign") && highestSeverity >= severityRank("medium")) {
    return "review";
  }
  return status;
}

export function aggregateAuditVerdict(signals: {
  llmAnalysis?: AuditLlmAnalysis | null;
  staticScan?: { status?: string | null } | null;
}) {
  const clawScanStatus = getClawScanDisplayStatus(signals.llmAnalysis);
  const staticStatus = signals.staticScan?.status?.trim().toLowerCase();
  if (clawScanStatus === "malicious" || staticStatus === "malicious") return "malicious";
  if (
    clawScanStatus === "review" ||
    clawScanStatus === "suspicious" ||
    clawScanStatus === "warn" ||
    clawScanStatus === "warning" ||
    staticStatus === "suspicious" ||
    staticStatus === "review" ||
    staticStatus === "warn" ||
    staticStatus === "warning"
  ) {
    return "review";
  }
  if (clawScanStatus !== "pending") return clawScanStatus;
  return staticStatus || clawScanStatus;
}
