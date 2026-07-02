import { Info } from "lucide-react";
import { aggregateAuditVerdict, SECURITY_AUDIT_SUBTEXT } from "./securityAuditModel";
import { getScanStatusInfo, type LlmAnalysis, type VtAnalysis } from "./SkillSecurityScanResults";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

type DetailSecuritySummaryProps = {
  auditHref: string;
  vtAnalysis?: VtAnalysis | null;
  llmAnalysis?: LlmAnalysis | null;
  githubScanStatus?: string | null;
  suppressScanResults?: boolean;
};

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
    case "cleared":
      return 3;
    default:
      return 0;
  }
}

export function DetailSecuritySummary({
  auditHref,
  vtAnalysis,
  llmAnalysis,
  githubScanStatus,
  suppressScanResults = false,
}: DetailSecuritySummaryProps) {
  const hasVersionScanResult = Boolean(vtAnalysis || llmAnalysis);
  const auditVerdict = hasVersionScanResult
    ? aggregateAuditVerdict({
        vtAnalysis,
        llmAnalysis,
        suppressScanResults,
      })
    : (githubScanStatus ?? "pending");
  const auditVerdictInfo = getScanStatusInfo(auditVerdict);
  const meterLevel = auditVerdictMeterLevel(auditVerdict);
  return (
    <a href={auditHref} className="security-audit-sidebar-value" aria-label="View Security Audit">
      <div className="security-audit-sidebar-value-row">
        <span className="security-audit-sidebar-verdict" data-status={auditVerdict}>
          {auditVerdictInfo.label}
        </span>
        <div className="security-audit-meter" data-level={meterLevel} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </a>
  );
}

export function DetailSecuritySummaryLabel() {
  return (
    <span className="security-audit-sidebar-label">
      <span>Security audit</span>
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="security-audit-sidebar-info"
              aria-label={SECURITY_AUDIT_SUBTEXT}
            >
              <Info size={13} aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="security-report-title-tooltip">
            {SECURITY_AUDIT_SUBTEXT}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}
