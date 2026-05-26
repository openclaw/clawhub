import {
  getClawScanDisplayStatus,
  getSkillSpectorDisplayStatus,
  getVirusTotalDisplayStatus,
  hasClawScanRiskReview,
  type LlmAnalysis,
  type SkillSpectorAnalysis,
  type VtAnalysis,
} from "./SkillSecurityScanResults";

export type AuditScannerKind = "clawscan" | "virustotal" | "skillspector";

export const SECURITY_AUDIT_SUBTEXT = "Security checks across malware telemetry and agentic risk";

type SecurityAuditSignals = {
  vtAnalysis?: VtAnalysis | null;
  llmAnalysis?: LlmAnalysis | null;
  skillSpectorAnalysis?: SkillSpectorAnalysis | null;
  suppressScanResults?: boolean;
};

export const AUDIT_SCANNER_LABELS: Record<AuditScannerKind, string> = {
  clawscan: "Risk analysis",
  skillspector: "SkillSpector",
  virustotal: "VirusTotal",
};

const DEFAULT_AUDIT_SCANNER_ORDER: AuditScannerKind[] = ["skillspector", "virustotal", "clawscan"];

const SUPPORTING_AUDIT_SCANNER_ORDER: AuditScannerKind[] = DEFAULT_AUDIT_SCANNER_ORDER.filter(
  (kind) => kind !== "skillspector" && kind !== "clawscan",
);

const POLICY_VERDICT_SCANNER_ORDER: AuditScannerKind[] = ["clawscan"];

export function getAuditScannerStatus(kind: AuditScannerKind, signals: SecurityAuditSignals) {
  if (signals.suppressScanResults) return "cleared";
  if (kind === "clawscan") return getClawScanDisplayStatus(signals.llmAnalysis);
  if (kind === "virustotal") return getVirusTotalDisplayStatus(signals.vtAnalysis);
  return getSkillSpectorDisplayStatus(signals.skillSpectorAnalysis);
}

export function aggregateAuditVerdict(signals: SecurityAuditSignals) {
  const statuses = POLICY_VERDICT_SCANNER_ORDER.map((kind) => getAuditScannerStatus(kind, signals));
  const normalized = statuses.map((status) => status.toLowerCase());
  if (normalized.some((status) => status === "malicious")) return "malicious";
  if (normalized.some((status) => status === "warn" || status === "warning")) return "warn";
  if (normalized.some((status) => status === "suspicious")) return "warn";
  if (normalized.some((status) => status === "review")) return "review";
  if (normalized.some((status) => status === "error" || status === "failed")) return "error";
  if (
    normalized.some(
      (status) => status === "pending" || status === "loading" || status === "not_found",
    )
  ) {
    return "pending";
  }
  return signals.suppressScanResults ? "cleared" : "benign";
}

export function getSecurityAuditOverviewCopy({
  llmAnalysis,
  suppressScanResults,
  suppressedMessage,
}: {
  llmAnalysis?: LlmAnalysis | null;
  suppressScanResults?: boolean;
  suppressedMessage?: string | null;
}) {
  if (suppressScanResults && suppressedMessage?.trim()) return [suppressedMessage.trim()];
  return [
    llmAnalysis?.summary?.trim() || "No risk analysis has been recorded yet.",
    llmAnalysis?.guidance?.trim() || null,
  ].filter((copy): copy is string => Boolean(copy));
}

export function getAuditScannerOrder(signals?: SecurityAuditSignals): AuditScannerKind[] {
  if (signals?.skillSpectorAnalysis) {
    return ["skillspector", ...SUPPORTING_AUDIT_SCANNER_ORDER];
  }
  if (hasClawScanRiskReview(signals?.llmAnalysis)) {
    return [...SUPPORTING_AUDIT_SCANNER_ORDER, "clawscan"];
  }
  return ["skillspector", ...SUPPORTING_AUDIT_SCANNER_ORDER];
}

export function getLatestAuditCheckedAt(signals: SecurityAuditSignals) {
  const values = [
    signals.llmAnalysis?.checkedAt,
    signals.skillSpectorAnalysis?.checkedAt,
    signals.vtAnalysis?.checkedAt,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}
