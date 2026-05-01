import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge } from "./ui/badge";

type LlmAnalysisDimension = {
  name: string;
  label: string;
  rating: string;
  detail: string;
};

type AgenticRiskStatus = "none" | "note" | "concern";
type ClawScanRiskBucket =
  | "abnormal_behavior_control"
  | "permission_boundary"
  | "sensitive_data_protection";

type LlmAgenticRiskEvidence = {
  path: string;
  snippet: string;
  explanation: string;
};

type LlmAgenticRiskFinding = {
  categoryId: string;
  categoryLabel: string;
  riskBucket: ClawScanRiskBucket;
  status: AgenticRiskStatus;
  severity: string;
  confidence: string;
  evidence?: LlmAgenticRiskEvidence;
  userImpact: string;
  recommendation: string;
};

type LlmRiskSummaryBucket = {
  status: AgenticRiskStatus;
  summary: string;
  highestSeverity?: string;
};

type LlmRiskSummary = Record<ClawScanRiskBucket, LlmRiskSummaryBucket>;

const SKILL_CAPABILITY_LABELS: Record<string, string> = {
  crypto: "Crypto",
  "requires-wallet": "Requires wallet",
  "can-make-purchases": "Can make purchases",
  "can-sign-transactions": "Can sign transactions",
  "requires-oauth-token": "Requires OAuth token",
  "requires-sensitive-credentials": "Requires sensitive credentials",
  "posts-externally": "Posts externally",
};

export type VtAnalysis = {
  status: string;
  verdict?: string;
  analysis?: string;
  source?: string;
  checkedAt: number;
};

export type LlmAnalysis = {
  status: string;
  verdict?: string;
  confidence?: string;
  summary?: string;
  dimensions?: LlmAnalysisDimension[];
  guidance?: string;
  findings?: string;
  agenticRiskFindings?: LlmAgenticRiskFinding[];
  riskSummary?: LlmRiskSummary;
  model?: string;
  checkedAt: number;
};

export type StaticFinding = {
  code: string;
  severity: string;
  file: string;
  line: number;
  message: string;
  evidence: string;
};

type SecurityScanResultsProps = {
  sha256hash?: string;
  vtAnalysis?: VtAnalysis | null;
  llmAnalysis?: LlmAnalysis | null;
  staticFindings?: StaticFinding[];
  capabilityTags?: string[] | null;
  scannerBasePath?: string | null;
  variant?: "panel" | "badge";
};

function VirusTotalIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="1em"
      height="1em"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 89"
      aria-label="VirusTotal"
    >
      <title>VirusTotal</title>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M45.292 44.5 0 89h100V0H0l45.292 44.5zM90 80H22l35.987-35.2L22 9h68v71z"
      />
    </svg>
  );
}

function ClawScanIcon({ className }: { className?: string }) {
  return <ShieldCheck className={className} aria-label="ClawScan" />;
}

export function getScanStatusInfo(status: string) {
  switch (status.toLowerCase()) {
    case "benign":
    case "clean":
      return { label: "Benign", className: "scan-status-clean" };
    case "cleared":
      return { label: "Cleared", className: "scan-status-clean" };
    case "malicious":
      return { label: "Malicious", className: "scan-status-malicious" };
    case "suspicious":
      return { label: "Review", className: "scan-status-suspicious" };
    case "loading":
      return { label: "Loading...", className: "scan-status-pending" };
    case "pending":
    case "not_found":
      return { label: "Pending", className: "scan-status-pending" };
    case "error":
    case "failed":
      return { label: "Error", className: "scan-status-error" };
    default:
      return { label: status, className: "scan-status-unknown" };
  }
}

function getDimensionIcon(rating: string) {
  switch (rating) {
    case "ok":
      return { className: "dimension-icon-ok", symbol: "\u2713" };
    case "note":
      return { className: "dimension-icon-note", symbol: "\u2139" };
    case "concern":
      return { className: "dimension-icon-concern", symbol: "!" };
    default:
      return { className: "dimension-icon-danger", symbol: "\u2717" };
  }
}

const CLAWSCAN_RISK_BUCKET_ORDER: ClawScanRiskBucket[] = [
  "abnormal_behavior_control",
  "permission_boundary",
  "sensitive_data_protection",
];

const CLAWSCAN_RISK_BUCKET_LABELS: Record<ClawScanRiskBucket, string> = {
  abnormal_behavior_control: "Abnormal behavior control",
  permission_boundary: "Permission boundary",
  sensitive_data_protection: "Sensitive data protection",
};

const CLAWSCAN_RISK_BUCKET_SUBTITLES: Record<ClawScanRiskBucket, string> = {
  abnormal_behavior_control:
    "Checks for instructions or behavior that redirect the agent, misuse tools, execute unexpected code, cascade across systems, exploit user trust, or continue outside the intended task.",
  permission_boundary:
    "Checks whether tool use, credentials, dependencies, identity, account access, or inter-agent boundaries are broader than the stated purpose.",
  sensitive_data_protection:
    "Checks for exposed credentials, poisoned memory or context, unclear communication boundaries, or sensitive data that could leave the user's control.",
};

const AGENTIC_RISK_STATUS_LABELS: Record<AgenticRiskStatus, string> = {
  none: "No evidence",
  note: "Note",
  concern: "Concern",
};

function formatSecurityLabel(value?: string | null) {
  if (!value) return null;
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getRiskStatusClass(status: AgenticRiskStatus, severity?: string) {
  if (status === "none") return "scan-status-clean";
  if (status === "note") return "";
  const normalizedSeverity = severity?.toLowerCase();
  if (normalizedSeverity === "critical" || normalizedSeverity === "high") {
    return "scan-status-malicious";
  }
  return "scan-status-suspicious";
}

function getVisibleAgenticRiskFindings(analysis: LlmAnalysis) {
  return (analysis.agenticRiskFindings ?? []).filter(
    (finding) => (finding.status === "note" || finding.status === "concern") && finding.evidence,
  );
}

export function hasClawScanRiskReview(analysis?: LlmAnalysis | null) {
  if (!analysis) return false;
  return getVisibleAgenticRiskFindings(analysis).length > 0;
}

function RiskStatusBadge({ status, severity }: { status: AgenticRiskStatus; severity?: string }) {
  return (
    <Badge
      variant="compact"
      className={`agentic-risk-chip ${getRiskStatusClass(status, severity)}`}
    >
      <span className="agentic-risk-chip-key">Status</span>
      {AGENTIC_RISK_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

function RiskInfoBadge({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <Badge variant="compact" className="agentic-risk-chip">
      <span className="agentic-risk-chip-key">{label}</span>
      {value}
    </Badge>
  );
}

function RiskBucketLabel({ bucket }: { bucket: ClawScanRiskBucket }) {
  return <div className="clawscan-risk-bucket-label">{CLAWSCAN_RISK_BUCKET_LABELS[bucket]}</div>;
}

function AgenticRiskFindingCard({
  finding,
  index,
}: {
  finding: LlmAgenticRiskFinding;
  index: number;
}) {
  const evidence = finding.evidence;
  if (!evidence) return null;
  const severity = formatSecurityLabel(finding.severity);
  const confidence = formatSecurityLabel(finding.confidence);

  return (
    <div
      key={`${finding.categoryId}-${finding.riskBucket}-${index}`}
      className="agentic-risk-finding"
    >
      <div className="agentic-risk-finding-header">
        <div className="agentic-risk-finding-title">{finding.categoryLabel}</div>
        <div className="agentic-risk-finding-chips">
          <RiskInfoBadge label="Severity" value={severity} />
          <RiskInfoBadge label="Confidence" value={confidence} />
          <RiskStatusBadge status={finding.status} severity={finding.severity} />
        </div>
      </div>
      <div className="agentic-risk-evidence">
        <div className="agentic-risk-evidence-path">{evidence.path}</div>
        <pre className="agentic-risk-evidence-snippet">{evidence.snippet}</pre>
        <p className="agentic-risk-evidence-explanation">{evidence.explanation}</p>
      </div>
      {finding.userImpact ? (
        <div className="agentic-risk-impact">
          <span>User impact</span>
          {finding.userImpact}
        </div>
      ) : null}
      {finding.recommendation ? (
        <div className="agentic-risk-recommendation">
          <span>Recommendation</span>
          {finding.recommendation}
        </div>
      ) : null}
    </div>
  );
}

export function ClawScanRiskReview({
  analysis,
  showTitle = true,
  findingsTitle = "Findings",
}: {
  analysis: LlmAnalysis;
  showTitle?: boolean;
  findingsTitle?: string;
}) {
  const visibleFindings = getVisibleAgenticRiskFindings(analysis);
  if (visibleFindings.length === 0) return null;

  return (
    <div className="clawscan-risk-review">
      {showTitle ? <div className="scan-findings-title">{findingsTitle}</div> : null}
      <p className="clawscan-scope-note">
        Artifact-based informational review of SKILL.md, metadata, install specs, static scan
        signals, and capability signals. ClawScan does not execute the skill or run runtime probes.
      </p>
      <div className="agentic-risk-finding-groups">
        {CLAWSCAN_RISK_BUCKET_ORDER.map((bucket) => {
          const bucketFindings = visibleFindings.filter((finding) => finding.riskBucket === bucket);
          if (bucketFindings.length === 0) return null;

          return (
            <section key={bucket} className="agentic-risk-finding-group">
              <div className="agentic-risk-finding-group-header">
                <RiskBucketLabel bucket={bucket} />
                <p>{CLAWSCAN_RISK_BUCKET_SUBTITLES[bucket]}</p>
              </div>
              <div className="agentic-risk-findings">
                {bucketFindings.map((finding, index) => (
                  <AgenticRiskFindingCard
                    key={`${finding.categoryId}-${finding.riskBucket}-${index}`}
                    finding={finding}
                    index={index}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function LlmAnalysisDetail({ analysis }: { analysis: LlmAnalysis }) {
  const verdict = analysis.verdict ?? analysis.status;
  const [isOpen, setIsOpen] = useState(false);

  const guidanceClass =
    verdict === "malicious" ? "malicious" : verdict === "suspicious" ? "suspicious" : "benign";

  return (
    <div className={`analysis-detail${isOpen ? " is-open" : ""}`}>
      <button
        type="button"
        className="analysis-detail-header"
        onClick={() => {
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) return;
          setIsOpen((prev) => !prev);
        }}
        aria-expanded={isOpen}
      >
        <span className="analysis-summary-text">{analysis.summary}</span>
        <span className="analysis-detail-toggle">
          Details <span className="chevron">{"\u25BE"}</span>
        </span>
      </button>
      <div className="analysis-body">
        <ClawScanRiskReview analysis={analysis} />
        {analysis.dimensions && analysis.dimensions.length > 0 ? (
          <div className="analysis-dimensions">
            {analysis.dimensions.map((dim) => {
              const icon = getDimensionIcon(dim.rating);
              return (
                <div key={dim.name} className="dimension-row">
                  <div className={`dimension-icon ${icon.className}`}>{icon.symbol}</div>
                  <div className="dimension-content">
                    <div className="dimension-label">{dim.label}</div>
                    <div className="dimension-detail">{dim.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {analysis.findings ? (
          <div className="scan-findings-section">
            <div className="scan-findings-title">Scan Findings in Context</div>
            {(() => {
              const counts = new Map<string, number>();
              return analysis.findings.split("\n").map((line) => {
                const count = (counts.get(line) ?? 0) + 1;
                counts.set(line, count);
                return (
                  <div key={`${line}-${count}`} className="scan-finding-row">
                    {line}
                  </div>
                );
              });
            })()}
          </div>
        ) : null}
        {analysis.guidance ? (
          <div className={`analysis-guidance ${guidanceClass}`}>
            <div className="analysis-guidance-label">
              {verdict === "malicious"
                ? "Do not install this skill"
                : verdict === "suspicious"
                  ? "Review before installing"
                  : "Assessment"}
            </div>
            {analysis.guidance}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function isCleanStatus(status?: string) {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === "clean" || s === "benign";
}

const EXTERNALLY_CLEARED_STATIC_CODES = new Set(["suspicious.env_credential_access"]);

function areStaticFindingsExternallyCleared(
  findings: StaticFinding[],
  vtStatus?: string,
  llmStatus?: string,
) {
  return (
    findings.length > 0 &&
    isCleanStatus(vtStatus) &&
    isCleanStatus(llmStatus) &&
    findings.every((finding) => EXTERNALLY_CLEARED_STATIC_CODES.has(finding.code))
  );
}

function getStaticGuidance(findings: StaticFinding[], vtStatus?: string, llmStatus?: string) {
  const hasMaliciousCode = findings.some((f) => f.code.startsWith("malicious."));
  if (hasMaliciousCode) {
    return {
      className: "malicious",
      label: "Critical security concern",
      text: "These patterns indicate potentially dangerous behavior. Exercise extreme caution and review the code thoroughly before installing.",
    };
  }
  const externallyCleared = areStaticFindingsExternallyCleared(findings, vtStatus, llmStatus);
  if (externallyCleared) {
    return {
      className: "benign",
      label: "Confirmed safe by external scanners",
      text: "Static analysis detected API credential-access patterns, but both VirusTotal and ClawScan confirmed this skill is safe. These patterns are common in legitimate API integration skills.",
    };
  }
  const hasCritical = findings.some((f) => f.severity === "critical");
  if (hasCritical) {
    return {
      className: "suspicious",
      label: "Patterns worth reviewing",
      text: "These patterns may indicate risky behavior. Check the VirusTotal and ClawScan results above for context-aware analysis before installing.",
    };
  }
  return {
    className: "benign",
    label: "About static analysis",
    text: "These patterns were detected by automated regex scanning. They may be normal for skills that integrate with external APIs. Check the VirusTotal and ClawScan results above for context-aware analysis.",
  };
}

function StaticAnalysisDetail({
  findings,
  vtStatus,
  llmStatus,
}: {
  findings: StaticFinding[];
  vtStatus?: string;
  llmStatus?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const guidance = getStaticGuidance(findings, vtStatus, llmStatus);

  return (
    <div className={`analysis-detail${isOpen ? " is-open" : ""}`}>
      <button
        type="button"
        className="analysis-detail-header"
        onClick={() => {
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) return;
          setIsOpen((prev) => !prev);
        }}
        aria-expanded={isOpen}
      >
        <span className="analysis-summary-text">
          Static analysis: {findings.length} pattern{findings.length !== 1 ? "s" : ""} detected
        </span>
        <span className="analysis-detail-toggle">
          Details <span className="chevron">{"\u25BE"}</span>
        </span>
      </button>
      <div className="analysis-body">
        <div className="analysis-dimensions">
          {findings.map((finding, i) => {
            const icon =
              finding.severity === "critical"
                ? { className: "dimension-icon-danger", symbol: "\u2717" }
                : { className: "dimension-icon-concern", symbol: "!" };
            return (
              <div key={`${finding.code}-${finding.file}-${i}`} className="dimension-row">
                <div className={`dimension-icon ${icon.className}`}>{icon.symbol}</div>
                <div className="dimension-content">
                  <div className="dimension-label">
                    {finding.file}:{finding.line}
                  </div>
                  <div className="dimension-detail">{finding.message}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className={`analysis-guidance ${guidance.className}`}>
          <div className="analysis-guidance-label">{guidance.label}</div>
          {guidance.text}
        </div>
      </div>
    </div>
  );
}

export function SecurityScanResults({
  sha256hash,
  vtAnalysis,
  llmAnalysis,
  staticFindings,
  capabilityTags,
  scannerBasePath,
  variant = "panel",
}: SecurityScanResultsProps) {
  const visibleCapabilityTags = (capabilityTags ?? []).filter(Boolean);
  const hasStaticFindings = staticFindings && staticFindings.length > 0;
  if (!sha256hash && !llmAnalysis && !hasStaticFindings && visibleCapabilityTags.length === 0) {
    return null;
  }

  const vtStatus = vtAnalysis?.status ?? "pending";
  const vtUrl = sha256hash ? `https://www.virustotal.com/gui/file/${sha256hash}` : null;
  const vtStatusInfo = getScanStatusInfo(vtStatus);
  const isCodeInsight = vtAnalysis?.source === "code_insight";
  const aiAnalysis = vtAnalysis?.analysis;

  const llmVerdict = llmAnalysis?.verdict ?? llmAnalysis?.status;
  const llmStatusInfo = llmVerdict ? getScanStatusInfo(llmVerdict) : null;

  if (variant === "badge") {
    return (
      <>
        {sha256hash ? (
          <div className="version-scan-badge">
            <VirusTotalIcon className="version-scan-icon version-scan-icon-vt" />
            <span className={vtStatusInfo.className}>{vtStatusInfo.label}</span>
            {vtUrl ? (
              <a
                href={vtUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="version-scan-link"
                onClick={(event) => event.stopPropagation()}
              >
                ↗
              </a>
            ) : null}
            {scannerBasePath ? (
              <a
                href={`${scannerBasePath}/virustotal`}
                className="version-scan-link"
                onClick={(event) => event.stopPropagation()}
              >
                Details
              </a>
            ) : null}
          </div>
        ) : null}
        {llmStatusInfo ? (
          <div className="version-scan-badge">
            <ClawScanIcon className="version-scan-icon version-scan-icon-oc" />
            <span className={llmStatusInfo.className}>{llmStatusInfo.label}</span>
            {scannerBasePath ? (
              <a
                href={`${scannerBasePath}/openclaw`}
                className="version-scan-link"
                onClick={(event) => event.stopPropagation()}
              >
                Details
              </a>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="scan-results-panel">
      <div className="scan-results-title">Security Scan</div>
      <div className="scan-results-list">
        {visibleCapabilityTags.length > 0 ? (
          <div className="scan-capabilities-section">
            <div className="scan-findings-title">Capability signals</div>
            <div className="scan-capability-tags">
              {visibleCapabilityTags.map((tag) => (
                <Badge key={tag} className="scan-capability-tag">
                  {SKILL_CAPABILITY_LABELS[tag] ?? tag}
                </Badge>
              ))}
            </div>
            <div className="scan-capability-note">
              These labels describe what authority the skill may exercise. They are separate from
              suspicious or malicious moderation verdicts.
            </div>
          </div>
        ) : null}
        {sha256hash ? (
          <div className="scan-result-row">
            <div className="scan-result-scanner">
              <VirusTotalIcon className="scan-result-icon scan-result-icon-vt" />
              <span className="scan-result-scanner-name">VirusTotal</span>
            </div>
            <div className={`scan-result-status ${vtStatusInfo.className}`}>
              {vtStatusInfo.label}
            </div>
            {vtUrl ? (
              <a
                href={vtUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="scan-result-link"
              >
                View report →
              </a>
            ) : null}
            {scannerBasePath ? (
              <a href={`${scannerBasePath}/virustotal`} className="scan-result-link">
                Details →
              </a>
            ) : null}
          </div>
        ) : null}
        {isCodeInsight && aiAnalysis && (vtStatus === "malicious" || vtStatus === "suspicious") ? (
          <div className={`code-insight-analysis ${vtStatus}`}>
            <div className="code-insight-label">Code Insight</div>
            <p className="code-insight-text">{aiAnalysis}</p>
          </div>
        ) : null}
        {llmStatusInfo && llmAnalysis ? (
          <div className="scan-result-row">
            <div className="scan-result-scanner">
              <ClawScanIcon className="scan-result-icon scan-result-icon-oc" />
              <span className="scan-result-scanner-name">ClawScan</span>
            </div>
            <div className={`scan-result-status ${llmStatusInfo.className}`}>
              {llmStatusInfo.label}
            </div>
            {llmAnalysis.confidence ? (
              <span className="scan-result-confidence">{llmAnalysis.confidence} confidence</span>
            ) : null}
            {scannerBasePath ? (
              <a href={`${scannerBasePath}/openclaw`} className="scan-result-link">
                Details →
              </a>
            ) : null}
          </div>
        ) : null}
        {llmAnalysis &&
        llmAnalysis.status !== "error" &&
        llmAnalysis.status !== "pending" &&
        llmAnalysis.summary ? (
          <LlmAnalysisDetail analysis={llmAnalysis} />
        ) : null}
        {staticFindings && staticFindings.length > 0 ? (
          <>
            {scannerBasePath ? (
              <div className="scan-result-row">
                <div className="scan-result-scanner">
                  <span className="scan-result-scanner-name">Static analysis</span>
                </div>
                <div className="scan-result-status scan-status-suspicious">
                  {staticFindings.length} finding{staticFindings.length === 1 ? "" : "s"}
                </div>
                <a href={`${scannerBasePath}/static-analysis`} className="scan-result-link">
                  Details →
                </a>
              </div>
            ) : null}
            <StaticAnalysisDetail
              findings={staticFindings}
              vtStatus={vtStatus}
              llmStatus={llmVerdict}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
