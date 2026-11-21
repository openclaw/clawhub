import { Info } from "lucide-react";
import { useId } from "react";
import {
  aggregateAuditVerdict,
  SECURITY_AUDIT_SUBTEXT,
  getScanStatusInfo,
  auditVerdictMeterLevel,
  type LlmAnalysis,
} from "./securityAuditModel";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

type DetailSecuritySummaryProps = {
  auditHref: string;
  llmAnalysis?: LlmAnalysis | null;
  githubScanStatus?: string | null;
  description?: string;
};

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
