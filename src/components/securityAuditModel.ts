import {
  getClawScanDisplayStatus,
  getSkillSpectorDisplayStatus,
  getVirusTotalDisplayStatus,
  hasClawScanRiskReview,
  type LlmAnalysis,
  type SkillSpectorAnalysis,
  type StaticFinding,
  type VtAnalysis,
} from "./SkillSecurityScanResults";

export type AuditScannerKind = "clawscan" | "virustotal" | "skillspector" | "static-analysis";

export const SECURITY_AUDIT_SUBTEXT =
  "Security checks across static analysis, malware telemetry, and agentic risk";

export type StaticScanAnalysis = {
  status: string;
  reasonCodes: string[];
  findings: StaticFinding[];
  summary: string;
  engineVersion: string;
  checkedAt: number;
};

type SecurityAuditSignals = {
  vtAnalysis?: VtAnalysis | null;
  llmAnalysis?: LlmAnalysis | null;
  skillSpectorAnalysis?: SkillSpectorAnalysis | null;
  staticScan?: StaticScanAnalysis | null;
  suppressScanResults?: boolean;
};

export const AUDIT_SCANNER_LABELS: Record<AuditScannerKind, string> = {
  clawscan: "Risk analysis",
  skillspector: "SkillSpector",
  virustotal: "VirusTotal",
  "static-analysis": "Static analysis",
};

const DEFAULT_AUDIT_SCANNER_ORDER: AuditScannerKind[] = [
  "skillspector",
  "static-analysis",
  "virustotal",
  "clawscan",
];

const SUPPORTING_AUDIT_SCANNER_ORDER: AuditScannerKind[] = DEFAULT_AUDIT_SCANNER_ORDER.filter(
  (kind) => kind !== "skillspector" && kind !== "clawscan",
);

const POLICY_VERDICT_SCANNER_ORDER: AuditScannerKind[] = [
  "static-analysis",
  "virustotal",
  "clawscan",
];

function getStaticScanDisplayStatus(staticScan?: StaticScanAnalysis | null) {
  const status = staticScan?.status?.trim().toLowerCase();
  if (status === "malicious") return "malicious";
  if (status === "suspicious") return "review";
  if (status === "clean" || status === "benign") return "benign";
  if (status) return status;
  return "pending";
}

export function getAuditScannerStatus(kind: AuditScannerKind, signals: SecurityAuditSignals) {
  if (signals.suppressScanResults) return "cleared";
  if (kind === "clawscan") return getClawScanDisplayStatus(signals.llmAnalysis);
  if (kind === "virustotal") return getVirusTotalDisplayStatus(signals.vtAnalysis);
  if (kind === "skillspector") return getSkillSpectorDisplayStatus(signals.skillSpectorAnalysis);
  return getStaticScanDisplayStatus(signals.staticScan);
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
    signals.staticScan?.checkedAt,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}
