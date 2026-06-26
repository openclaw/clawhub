import {
  getClawScanDisplayStatus,
  type LlmAnalysis,
  type SkillSpectorAnalysis,
  type VtAnalysis,
} from "./SkillSecurityScanResults";

export type AuditScannerKind = "static" | "virustotal" | "skillspector";

export const SECURITY_AUDIT_SUBTEXT = "Security checks across malware telemetry and agentic risk";

type SecurityAuditSignals = {
  vtAnalysis?: VtAnalysis | null;
  llmAnalysis?: LlmAnalysis | null;
  skillSpectorAnalysis?: SkillSpectorAnalysis | null;
  staticScan?: {
    status?: string | null;
    summary?: string | null;
    findings?: unknown[] | null;
    checkedAt?: number | null;
  } | null;
  suppressScanResults?: boolean;
};

export const AUDIT_SCANNER_LABELS: Record<AuditScannerKind, string> = {
  skillspector: "SkillSpector",
  static: "Static analysis",
  virustotal: "VirusTotal",
};

const DEFAULT_AUDIT_SCANNER_ORDER: AuditScannerKind[] = ["skillspector", "virustotal", "static"];

const SUPPORTING_AUDIT_SCANNER_ORDER: AuditScannerKind[] = DEFAULT_AUDIT_SCANNER_ORDER.filter(
  (kind) => kind !== "skillspector",
);

export function aggregateAuditVerdict(signals: SecurityAuditSignals) {
  if (signals.suppressScanResults) return "cleared";
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
    llmAnalysis?.summary?.trim() || "No security analysis has been recorded yet.",
    llmAnalysis?.guidance?.trim() || null,
  ].filter((copy): copy is string => Boolean(copy));
}

export function getAuditScannerOrder(signals?: SecurityAuditSignals): AuditScannerKind[] {
  const hasStaticScanReview = Boolean(
    signals?.staticScan?.summary?.trim() || signals?.staticScan?.findings?.length,
  );
  if (signals?.skillSpectorAnalysis) {
    return hasStaticScanReview
      ? ["skillspector", ...SUPPORTING_AUDIT_SCANNER_ORDER]
      : ["skillspector", "virustotal"];
  }
  if (hasStaticScanReview) return ["virustotal", "static"];
  return ["skillspector", "virustotal"];
}

export function getLatestAuditCheckedAt(signals: SecurityAuditSignals) {
  const values = [
    signals.llmAnalysis?.checkedAt,
    signals.skillSpectorAnalysis?.checkedAt,
    signals.vtAnalysis?.checkedAt,
    signals.staticScan?.checkedAt,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}
