import { Info } from "lucide-react";
import { useId } from "react";
import { aggregateAuditVerdict, SECURITY_AUDIT_SUBTEXT } from "./securityAuditModel";
import { getScanStatusInfo, type LlmAnalysis } from "./SkillSecurityScanResults";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

type DetailSecuritySummaryProps = {
  auditHref: string;
  llmAnalysis?: LlmAnalysis | null;
  githubScanStatus?: string | null;
  description?: string;
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
      return 3;
    default:
      return 0;
  }
}

export function DetailSecuritySummary({
  auditHref,
  llmAnalysis,
  githubScanStatus,
  description,
}: DetailSecuritySummaryProps) {
  const descriptionId = useId();
  const auditVerdict = llmAnalysis
    ? aggregateAuditVerdict({ llmAnalysis })
    : (githubScanStatus ?? "pending");
  const auditVerdictInfo = getScanStatusInfo(auditVerdict);
  const meterLevel = auditVerdictMeterLevel(auditVerdict);
  return (
    <a
      href={auditHref}
      className="security-audit-sidebar-value"
      aria-label="View Security Audit"
      aria-describedby={description ? descriptionId : undefined}
      title={description}
    >
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
      {description ? (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      ) : null}
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
