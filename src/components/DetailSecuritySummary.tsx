import { Info } from "lucide-react";
import "./detail-security-summary.css";
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
  const label = meterLevel === 3 ? "Clean" : auditVerdictInfo.label;
  return (
    <span className="detail-audit" title={description}>
      <a
        href={auditHref}
        className="detail-audit__link"
        aria-label={`View Security Audit: ${label}`}
        aria-describedby={description ? descriptionId : undefined}
      >
        <span className="security-audit-sidebar-verdict" data-status={auditVerdict}>
          {label}
        </span>
        <span className="security-audit-meter" data-level={meterLevel} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </a>
      {description ? (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      ) : null}
    </span>
  );
}

export function DetailSecuritySummaryLabel({ label = "Security audit" }: { label?: string }) {
  return (
    <span className="security-audit-sidebar-label">
      <span>{label}</span>
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
