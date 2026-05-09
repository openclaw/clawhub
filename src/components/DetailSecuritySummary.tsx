import {
  getScanStatusInfo,
  type LlmAnalysis,
  type StaticFinding,
  type VtAnalysis,
} from "./SkillSecurityScanResults";

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

function severityLevelForStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "malicious" || normalized === "error" || normalized === "failed") return 3;
  if (normalized === "suspicious") return 2;
  if (normalized === "clean" || normalized === "benign" || normalized === "cleared") return 1;
  return 0;
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
  return (
    <section className="security-audit-section" aria-labelledby="security-audit-heading">
      <div className="security-audit-title-row">
        <h3 id="security-audit-heading" className="skill-install-panel-title security-audit-title">
          Audits
        </h3>
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
        </div>
      </div>
    </section>
  );
}
