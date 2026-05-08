import {
  getScanStatusInfo,
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
  if (staticScan?.status) return staticScan.status;
  return "pending";
}

function badgeVariantForScanStatus(status: string): BadgeProps["variant"] {
  const normalized = status.toLowerCase();
  if (normalized === "clean" || normalized === "benign") return "success";
  if (normalized === "cleared") return "success";
  if (normalized === "suspicious") return "warning";
  if (normalized === "malicious" || normalized === "error") return "destructive";
  if (normalized === "pending" || normalized === "queued" || normalized === "loading") {
    return "pending";
  }
  return "compact";
}

function severityLevelForStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "malicious" || normalized === "error" || normalized === "failed") return 3;
  if (normalized === "suspicious") return 2;
  if (normalized === "clean" || normalized === "benign" || normalized === "cleared") return 1;
  return 0;
}

function overallStatus(statuses: string[]) {
  if (statuses.some((status) => severityLevelForStatus(status) === 3)) return "malicious";
  if (statuses.some((status) => severityLevelForStatus(status) === 2)) return "suspicious";
  if (statuses.every((status) => status.toLowerCase() === "cleared")) return "cleared";
  if (statuses.some((status) => severityLevelForStatus(status) === 0)) return "pending";
  return "clean";
}

function ScannerSignal({
  href,
  label,
  description,
  status,
}: {
  href: string;
  label: string;
  description: string;
  status: string;
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
      <div className="security-audit-meter" data-level={level} aria-hidden="true">
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
  const vtStatus = suppressScanResults
    ? "cleared"
    : (vtAnalysis?.verdict ?? vtAnalysis?.status ?? "pending");
  const llmStatus = suppressScanResults
    ? "cleared"
    : (llmAnalysis?.verdict ?? llmAnalysis?.status ?? "pending");
  const staticStatus = suppressScanResults ? "cleared" : statusFromStaticScan(staticScan);
  const verdictStatus = overallStatus([vtStatus, llmStatus, staticStatus]);
  const verdictInfo = getScanStatusInfo(verdictStatus);

  return (
    <section className="security-audit-section" aria-labelledby="security-audit-heading">
      <div className="security-audit-title-row">
        <h3 id="security-audit-heading" className="skill-install-panel-title security-audit-title">
          Security Audits
        </h3>
        <Badge
          className="security-audit-title-badge"
          variant={badgeVariantForScanStatus(verdictStatus)}
        >
          {verdictInfo.label}
        </Badge>
      </div>
      <div className="security-audit-row">
        {suppressScanResults && suppressedMessage ? (
          <p className="security-audit-suppressed">{suppressedMessage}</p>
        ) : null}
        <div className="security-audit-signals">
          <ScannerSignal
            href={`${scannerBasePath}/virustotal`}
            label="VirusTotal"
            description="Reputation and file hash checks."
            status={vtStatus}
          />
          <ScannerSignal
            href={`${scannerBasePath}/openclaw`}
            label="ClawScan"
            description="Agentic behavior and permission review."
            status={llmStatus}
          />
          <ScannerSignal
            href={`${scannerBasePath}/static-analysis`}
            label="Static analysis"
            description="Pattern checks against bundled files."
            status={staticStatus}
          />
        </div>
      </div>
    </section>
  );
}
