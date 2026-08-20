import {
  type AigAnalysis,
  getClawScanDisplayStatus,
  type LlmAnalysis,
  type SkillSpectorAnalysis,
  type VtAnalysis,
} from "./SkillSecurityScanResults";

export type AuditScannerKind = "aig" | "static" | "virustotal" | "skillspector";

export const SECURITY_AUDIT_SUBTEXT = "Security checks across malware telemetry and agentic risk";

type SecurityAuditSignals = {
  vtAnalysis?: VtAnalysis | null;
  aigAnalysis?: AigAnalysis | null;
  llmAnalysis?: LlmAnalysis | null;
  skillSpectorAnalysis?: SkillSpectorAnalysis | null;
  staticScan?: {
    status?: string | null;
    summary?: string | null;
    findings?: unknown[] | null;
    checkedAt?: number | null;
  } | null;
};

export const AUDIT_SCANNER_LABELS: Record<AuditScannerKind, string> = {
  aig: "A.I.G",
  skillspector: "SkillSpector",
  static: "Static analysis",
  virustotal: "VirusTotal",
};

const DEFAULT_AUDIT_SCANNER_ORDER: AuditScannerKind[] = ["skillspector", "virustotal", "static"];

const SUPPORTING_AUDIT_SCANNER_ORDER: AuditScannerKind[] = DEFAULT_AUDIT_SCANNER_ORDER.filter(
  (kind) => kind !== "skillspector",
);

export function aggregateAuditVerdict(signals: SecurityAuditSignals) {
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

export function getAuditScannerOrder(signals?: SecurityAuditSignals): AuditScannerKind[] {
  const hasStaticScanReview = Boolean(
    signals?.staticScan?.summary?.trim() || signals?.staticScan?.findings?.length,
  );
  let order: AuditScannerKind[];
  if (signals?.skillSpectorAnalysis) {
    order = hasStaticScanReview
      ? ["skillspector", ...SUPPORTING_AUDIT_SCANNER_ORDER]
      : ["skillspector", "virustotal"];
  } else if (hasStaticScanReview) {
    order = ["virustotal", "static"];
  } else {
    order = ["skillspector", "virustotal"];
  }
  return signals?.aigAnalysis ? ["aig", ...order] : order;
}

export function getLatestAuditCheckedAt(signals: SecurityAuditSignals) {
  const values = [
    signals.aigAnalysis?.checkedAt,
    signals.llmAnalysis?.checkedAt,
    signals.skillSpectorAnalysis?.checkedAt,
    signals.vtAnalysis?.checkedAt,
    signals.staticScan?.checkedAt,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}
