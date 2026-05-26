import {
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
  clawScanVerdict?: string | null;
  clawScanState?: string | null;
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

function getClawScanAuditStatus(signals: SecurityAuditSignals) {
  const storedVerdict =
    signals.clawScanVerdict ??
    signals.llmAnalysis?.verdict ??
    (signals.llmAnalysis?.status === "completed" ? null : signals.llmAnalysis?.status);
  const verdict = storedVerdict?.trim().toLowerCase();
  const state =
    signals.clawScanState?.trim().toLowerCase() ??
    (signals.llmAnalysis
      ? signals.llmAnalysis.status === "completed" && signals.llmAnalysis.verdict
        ? "complete"
        : signals.llmAnalysis.status.trim().toLowerCase()
      : undefined);
  if (verdict === "malicious") return "malicious";
  if (state === "pending" || state === "running") return "pending";
  if (state === "error") return "error";
  if (verdict === "benign") return "clean";
  if (verdict === "suspicious") return "review";
  if (verdict === "warning") return "warn";
  if (verdict === "clean" || verdict === "review" || verdict === "warn") return verdict;
  if (state === "complete") return "error";
  return "pending";
}

export function getAuditScannerStatus(kind: AuditScannerKind, signals: SecurityAuditSignals) {
  if (signals.suppressScanResults) return "cleared";
  if (kind === "clawscan") return getClawScanAuditStatus(signals);
  if (kind === "virustotal") return getVirusTotalDisplayStatus(signals.vtAnalysis);
  return getSkillSpectorDisplayStatus(signals.skillSpectorAnalysis);
}

export function aggregateAuditVerdict(signals: SecurityAuditSignals) {
  if (signals.suppressScanResults) return "cleared";
  return getClawScanAuditStatus(signals);
}

export function getSecurityAuditOverviewCopy({
  llmAnalysis,
  clawScanVerdict,
  clawScanState,
  suppressScanResults,
  suppressedMessage,
}: {
  llmAnalysis?: LlmAnalysis | null;
  clawScanVerdict?: string | null;
  clawScanState?: string | null;
  suppressScanResults?: boolean;
  suppressedMessage?: string | null;
}) {
  if (suppressScanResults && suppressedMessage?.trim()) return [suppressedMessage.trim()];
  const storedVerdict =
    clawScanVerdict ??
    llmAnalysis?.verdict ??
    (llmAnalysis?.status === "completed" ? null : llmAnalysis?.status);
  const verdict = storedVerdict?.trim().toLowerCase();
  if (verdict === "malicious") {
    return [
      llmAnalysis?.summary?.trim() || "Risk analysis flagged this release as malicious.",
      llmAnalysis?.guidance?.trim() || null,
    ].filter((copy): copy is string => Boolean(copy));
  }
  const state =
    clawScanState?.trim().toLowerCase() ??
    (llmAnalysis
      ? llmAnalysis.status === "completed" && llmAnalysis.verdict
        ? "complete"
        : llmAnalysis.status.trim().toLowerCase()
      : undefined);
  if (state === "pending" || state === "running") return ["Risk analysis is pending."];
  if (state === "error") return ["Risk analysis could not be completed for this release."];
  if (!llmAnalysis) {
    if (verdict === "clean") return ["Risk analysis completed with no visible findings."];
    if (verdict === "review" || verdict === "warn") {
      return ["Risk analysis completed with non-blocking guidance."];
    }
    return ["Risk analysis is pending."];
  }
  return [
    llmAnalysis.summary?.trim() || "No risk analysis has been recorded yet.",
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
