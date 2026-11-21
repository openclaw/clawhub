export { aggregateAuditVerdict } from "clawhub-schema/securityAudit";
import type {
  PackageAigAnalysis,
  PackageEndorAnalysis,
  PackageSkillSpectorAnalysis,
} from "clawhub-schema";

export type AuditScannerKind = "aig" | "skillspector";

export const SECURITY_AUDIT_SUBTEXT = "Security checks for vulnerabilities and agentic risk";

type SecurityAuditSignals = {
  aigAnalysis?: PackageAigAnalysis | null;
  llmAnalysis?: LlmAnalysis | null;
  skillSpectorAnalysis?: PackageSkillSpectorAnalysis | null;
  endorAnalysis?: PackageEndorAnalysis | null;
};

export const AUDIT_SCANNER_LABELS: Record<AuditScannerKind, string> = {
  aig: "A.I.G",
  skillspector: "SkillSpector",
};

export function getAuditScannerOrder(signals?: SecurityAuditSignals): AuditScannerKind[] {
  return signals?.aigAnalysis ? ["aig", "skillspector"] : ["skillspector"];
}

export function getLatestAuditCheckedAt(signals: SecurityAuditSignals) {
  const values = [
    signals.aigAnalysis?.checkedAt,
    signals.llmAnalysis?.checkedAt,
    signals.skillSpectorAnalysis?.checkedAt,
    signals.endorAnalysis?.checkedAt,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

type LlmAnalysisDimension = {
  name: string;
  label: string;
  rating: string;
  detail: string;
};

type AgenticRiskStatus = "none" | "note" | "concern";
type ClawScanRiskBucket =
  | "abnormal_behavior_control"
  | "permission_boundary"
  | "sensitive_data_protection";

type LlmAgenticRiskEvidence = {
  path: string;
  snippet: string;
  explanation: string;
};

type LlmAgenticRiskFinding = {
  categoryId: string;
  categoryLabel: string;
  riskBucket: ClawScanRiskBucket;
  status: AgenticRiskStatus;
  severity: string;
  confidence: string;
  evidence?: LlmAgenticRiskEvidence;
  userImpact: string;
  recommendation: string;
};

type LlmRiskSummaryBucket = {
  status: AgenticRiskStatus;
  summary: string;
  highestSeverity?: string;
};

type LlmRiskSummary = Record<ClawScanRiskBucket, LlmRiskSummaryBucket>;

export type LlmAnalysis = {
  status: string;
  verdict?: string;
  confidence?: string;
  summary?: string;
  dimensions?: LlmAnalysisDimension[];
  guidance?: string;
  findings?: string;
  agenticRiskFindings?: LlmAgenticRiskFinding[];
  riskSummary?: LlmRiskSummary;
  model?: string;
  checkedAt: number;
};

export function getScanStatusInfo(status: string) {
  switch (status.toLowerCase()) {
    case "benign":
    case "clean":
    case "undetected-only-fallback":
      return { label: "Pass", className: "scan-status-clean", badgeVariant: "success" };
    case "malicious":
      return {
        label: "Malicious",
        className: "scan-status-malicious",
        badgeVariant: "destructive",
      };
    case "critical":
    case "high":
      return {
        label: status.toLowerCase() === "critical" ? "Critical" : "High",
        className: "scan-status-malicious",
        badgeVariant: "destructive",
      };
    case "review":
    case "suspicious":
      return { label: "Review", className: "scan-status-warn", badgeVariant: "warning" };
    case "medium":
    case "warn":
    case "warning":
      return {
        label: status.toLowerCase() === "medium" ? "Medium" : "Warn",
        className: "scan-status-warn",
        badgeVariant: "warning",
      };
    case "low":
      return { label: "Low", className: "scan-status-unknown", badgeVariant: "review" };
    case "info":
      return { label: "Info", className: "scan-status-unknown", badgeVariant: "compact" };
    case "advisory":
      return { label: "Advisory", className: "scan-status-unknown", badgeVariant: "compact" };
    case "loading":
      return { label: "Loading...", className: "scan-status-pending", badgeVariant: "pending" };
    case "pending":
    case "not_found":
      return { label: "Pending", className: "scan-status-pending", badgeVariant: "pending" };
    case "error":
    case "failed":
      return { label: "Error", className: "scan-status-error", badgeVariant: "destructive" };
    default:
      return { label: status, className: "scan-status-unknown", badgeVariant: "default" };
  }
}

export function auditVerdictMeterLevel(status: string) {
  switch (status.toLowerCase()) {
    case "malicious":
      return 1;
    case "warn":
    case "warning":
    case "suspicious":
    case "review":
      return 2;
    case "benign":
    case "clean":
      return 3;
    default:
      return 0;
  }
}

export function getSkillSpectorIssueCount(analysis?: PackageSkillSpectorAnalysis | null) {
  if (!analysis) return 0;
  const reportedCount = Number.isFinite(analysis.issueCount) ? analysis.issueCount : 0;
  return Math.max(reportedCount, analysis.issues.length);
}

export function getSkillSpectorOverviewCopy(analysis?: PackageSkillSpectorAnalysis | null) {
  const count = getSkillSpectorIssueCount(analysis);
  if (count > 0) return `SkillSpector found ${count} issue${count === 1 ? "" : "s"}.`;
  const status = analysis?.status?.trim().toLowerCase();
  if (status === "clean" || status === "benign") return "No SkillSpector findings.";
  if (status === "error" || status === "failed") return "SkillSpector could not complete.";
  return "SkillSpector findings are pending for this release.";
}
