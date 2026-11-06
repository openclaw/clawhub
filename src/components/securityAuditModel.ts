export { aggregateAuditVerdict } from "clawhub-schema/securityAudit";
import type { PackageEndorAnalysis } from "clawhub-schema";
import {
  type AigAnalysis,
  type LlmAnalysis,
  type SkillSpectorAnalysis,
} from "./SkillSecurityScanResults";

export type AuditScannerKind = "aig" | "skillspector";

export const SECURITY_AUDIT_SUBTEXT = "Security checks for vulnerabilities and agentic risk";

type SecurityAuditSignals = {
  aigAnalysis?: AigAnalysis | null;
  llmAnalysis?: LlmAnalysis | null;
  skillSpectorAnalysis?: SkillSpectorAnalysis | null;
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
