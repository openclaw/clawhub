import {
  getClawScanDisplayStatus,
  getScanStatusInfo,
  getVirusTotalDisplayStatus,
  type LlmAnalysis,
  type StaticFinding,
  type VtAnalysis,
} from "./SkillSecurityScanResults";
import { Badge, type BadgeProps } from "./ui/badge";

type DetailSecuritySummaryProps = {
  scannerBasePath: string;
  sha256hash?: string | null;
  vtAnalysis?: VtAnalysis | null;
  llmAnalysis?: LlmAnalysis | null;
  staticScan?: {
    status: string;
    reasonCodes: string[];
    findings: StaticFinding[];
    summary: string;
    engineVersion: string;
    checkedAt: number;
  } | null;
  suppressScanResults?: boolean;
  suppressedMessage?: string | null;
};

function statusFromStaticScan(staticScan: DetailSecuritySummaryProps["staticScan"]) {
  const status = staticScan?.status?.trim().toLowerCase();
  if (status === "malicious") return "malicious";
  if (status === "clean" || status === "benign") return "benign";
  if (status === "suspicious") return "review";
  if (status) return status;
  return "pending";
}

function severityLevelForStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "malicious") return 4;
  if (normalized === "warn" || normalized === "warning" || normalized === "suspicious") return 3;
  if (normalized === "review") return 2;
  if (normalized === "clean" || normalized === "benign" || normalized === "cleared") return 1;
  return 0;
}

function aggregateAuditVerdict(statuses: string[]) {
  const normalized = statuses.map((status) => status.toLowerCase());
  if (normalized.some((status) => status === "malicious")) {
    return "malicious";
  }
  if (
    normalized.some(
      (status) => status === "warn" || status === "warning" || status === "suspicious",
    )
  ) {
    return "warn";
  }
  if (normalized.some((status) => status === "error" || status === "failed")) return "error";
  if (
    normalized.some(
      (status) => status === "pending" || status === "loading" || status === "not_found",
    )
  ) {
    return "pending";
  }
  return "benign";
}

function auditVerdictBadgeVariant(status: string): BadgeProps["variant"] {
  switch (status.toLowerCase()) {
    case "malicious":
      return "destructive";
    case "warn":
    case "warning":
    case "suspicious":
      return "warning";
    case "pending":
    case "error":
    case "failed":
      return "pending";
    default:
      return "success";
  }
}

function ScannerSignal({
  href,
  label,
  description,
  status,
  tone,
}: {
  href: string;
  label: string;
  description: string;
  status: string;
  tone?: "review";
}) {
  const info = getScanStatusInfo(status);
  const level = severityLevelForStatus(status);
  return (
    <a
      href={href}
      className="security-audit-signal !no-underline hover:!no-underline"
      aria-label={`${label}: ${info.label}`}
    >
      <div className="security-audit-signal-head">
        <span className="security-audit-signal-label">{label}</span>
        <span className="security-audit-signal-status">{info.label}</span>
      </div>
      <div className="security-audit-meter" data-level={level} data-tone={tone} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <p>{description}</p>
    </a>
  );
}

export function DetailSecuritySummary({
  scannerBasePath,
  vtAnalysis,
  llmAnalysis,
  staticScan,
  suppressScanResults = false,
  suppressedMessage,
}: DetailSecuritySummaryProps) {
  const vtStatus = suppressScanResults ? "cleared" : getVirusTotalDisplayStatus(vtAnalysis);
  const llmStatus = suppressScanResults ? "cleared" : getClawScanDisplayStatus(llmAnalysis);
  const staticStatus = suppressScanResults ? "cleared" : statusFromStaticScan(staticScan);
  const auditVerdict = aggregateAuditVerdict([vtStatus, llmStatus, staticStatus]);
  const auditVerdictInfo = getScanStatusInfo(auditVerdict);
  return (
    <section className="security-audit-section" aria-labelledby="security-audit-heading">
      <div className="security-audit-title-row">
        <h3 id="security-audit-heading" className="skill-install-panel-title security-audit-title">
          Audits
        </h3>
        <Badge
          variant={auditVerdictBadgeVariant(auditVerdict)}
          className="security-audit-verdict-badge min-h-0 rounded-[4px] px-2.5 py-0.5 text-[0.78rem] leading-[1.3]"
        >
          {auditVerdictInfo.label}
        </Badge>
      </div>
      <div className="security-audit-row">
        {suppressScanResults && suppressedMessage ? (
          <p className="security-audit-suppressed">{suppressedMessage}</p>
        ) : null}
        <div className="security-audit-signals">
          <ScannerSignal
            href={`${scannerBasePath}/clawscan`}
            label="ClawScan"
            description="Agentic behavior and permission review."
            status={llmStatus}
            tone="review"
          />
          <ScannerSignal
            href={`${scannerBasePath}/static-analysis`}
            label="Static analysis"
            description="Pattern checks against bundled files."
            status={staticStatus}
          />
          <ScannerSignal
            href={`${scannerBasePath}/virustotal`}
            label="VirusTotal"
            description="Multi-engine malware detections and file reputation."
            status={vtStatus}
          />
        </div>
      </div>
    </section>
  );
}
