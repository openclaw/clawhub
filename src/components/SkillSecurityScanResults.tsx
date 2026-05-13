import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge, type BadgeProps } from "./ui/badge";

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
  scanner?: string;
  engineStats?: {
    malicious?: number;
    suspicious?: number;
    harmless?: number;
    undetected?: number;
  };
  metadata?: {
    stats?: {
      malicious?: number;
      suspicious?: number;
      harmless?: number;
      undetected?: number;
    };
  };
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

type ClawScanRiskLevel = "low" | "medium" | "high";

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
      return { label: "Pass", className: "scan-status-clean", badgeVariant: "success" };
    case "cleared":
      return { label: "Cleared", className: "scan-status-clean", badgeVariant: "success" };
    case "malicious":
      return {
        label: "Malicious",
        className: "scan-status-malicious",
        badgeVariant: "destructive",
      };
    case "review":
      return { label: "Review", className: "scan-status-review", badgeVariant: "review" };
    case "warn":
    case "warning":
    case "suspicious":
      return { label: "Warn", className: "scan-status-warn", badgeVariant: "warning" };
    case "advisory":
      return { label: "Advisory", className: "scan-status-unknown", badgeVariant: "compact" };
    case "loading":
      return { label: "Loading...", className: "scan-status-pending", badgeVariant: "pending" };
    case "pending":
    case "not_found":
      return { label: "Pending", className: "scan-status-pending", badgeVariant: "pending" };
    case "error":
    case "failed":
      return { label: "Error", className: "scan-status-error", badgeVariant: "destructive" };
    default:
      return { label: status, className: "scan-status-unknown", badgeVariant: "default" };
  }
}

function severityRank(severity?: string) {
  switch (severity?.trim().toLowerCase()) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}

function isLowConfidence(value: unknown) {
  return typeof value === "string" && value.trim().toLowerCase() === "low";
}

function isVisibleAgenticRiskFinding(finding: LlmAgenticRiskFinding) {
  return (
    (finding.status === "note" || finding.status === "concern") &&
    Boolean(finding.evidence) &&
    !isLowConfidence(finding.confidence)
  );
}

function highestVisibleFindingSeverityRank(analysis?: LlmAnalysis | null) {
  let highest = 0;
  for (const finding of getVisibleAgenticRiskFindings(analysis)) {
    highest = Math.max(highest, severityRank(finding.severity));
  }
  return highest;
}

export function getClawScanDisplayStatus(analysis?: LlmAnalysis | null) {
  const status = (analysis?.verdict ?? analysis?.status)?.trim().toLowerCase();
  if (!status) return "pending";
  const highestSeverity = highestVisibleFindingSeverityRank(analysis);
  if (status === "suspicious") {
    return highestSeverity >= severityRank("high") ? "warn" : "review";
  }
  if ((status === "clean" || status === "benign") && highestSeverity >= severityRank("medium")) {
    return "review";
  }
  return status;
}

export function getClawScanRiskLevel(analysis?: LlmAnalysis | null): ClawScanRiskLevel | null {
  const status = (analysis?.verdict ?? analysis?.status)?.trim().toLowerCase();
  if (!status || status === "pending" || status === "loading" || status === "not_found") {
    return null;
  }
  if (status === "error" || status === "failed") return null;
  if (status === "malicious") return "high";

  const highestSeverity = highestVisibleFindingSeverityRank(analysis);
  if (highestSeverity >= severityRank("high")) return "high";
  if (highestSeverity >= severityRank("medium")) return "medium";
  return "low";
}

function getVtEngineStats(analysis?: VtAnalysis | null) {
  return analysis?.engineStats ?? analysis?.metadata?.stats;
}

export function isVirusTotalAiOnlyAnalysis(analysis?: VtAnalysis | null) {
  const scanner = analysis?.scanner?.trim().toLowerCase();
  const source = analysis?.source?.trim().toLowerCase();
  return scanner === "code_insight" || source === "palm" || source?.includes("code insight");
}

export function getVirusTotalDisplayStatus(analysis?: VtAnalysis | null) {
  const stats = getVtEngineStats(analysis);
  if (stats) {
    if ((stats.malicious ?? 0) > 0) return "malicious";
    if ((stats.suspicious ?? 0) > 0) return "suspicious";
    return "benign";
  }

  if (isVirusTotalAiOnlyAnalysis(analysis)) return "benign";
  return analysis?.verdict ?? analysis?.status ?? "pending";
}

export function ScanResultBadge({
  status,
  label,
  className,
  tone,
}: {
  status: string;
  label?: string;
  className?: string;
  tone?: "review";
}) {
  const statusInfo = getScanStatusInfo(status);
  const variant =
    tone === "review" && statusInfo.label === "Review" ? "review" : statusInfo.badgeVariant;
  return (
    <Badge
      variant={variant as BadgeProps["variant"]}
      className={`min-h-0 rounded-[4px] px-2.5 py-0.5 text-[0.78rem] leading-[1.3]${className ? ` ${className}` : ""}`}
    >
      {label ?? statusInfo.label}
    </Badge>
  );
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

const RISK_LEVEL_BADGE_META: Record<
  ClawScanRiskLevel,
  { label: string; level: number; variant: BadgeProps["variant"] }
> = {
  low: { label: "Low", level: 1, variant: "success" },
  medium: { label: "Medium", level: 2, variant: "warning" },
  high: { label: "High", level: 3, variant: "destructive" },
};

export function RiskLevelBadge({ level }: { level: ClawScanRiskLevel }) {
  const risk = RISK_LEVEL_BADGE_META[level];
  return (
    <Badge variant={risk.variant} className="scan-risk-level-badge" data-level={risk.level}>
      <span className="scan-risk-level-bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>{risk.label}</span>
    </Badge>
  );
}

function getVisibleAgenticRiskFindings(analysis?: LlmAnalysis | null) {
  return (analysis?.agenticRiskFindings ?? []).filter(isVisibleAgenticRiskFinding);
}

export function getVisibleClawScanFindingCount(analysis?: LlmAnalysis | null) {
  return getVisibleAgenticRiskFindings(analysis).length;
}

export function hasClawScanRiskReview(analysis?: LlmAnalysis | null) {
  if (!analysis) return false;
  return getVisibleClawScanFindingCount(analysis) > 0;
}

function getFindingSeverityBadgeMeta(severity: string): {
  label: string;
  variant: BadgeProps["variant"];
} {
  switch (severity.trim().toLowerCase()) {
    case "critical":
      return { label: "Critical", variant: "destructive" };
    case "high":
      return { label: "High", variant: "destructive" };
    case "medium":
      return { label: "Medium", variant: "warning" };
    case "low":
      return { label: "Low", variant: "review" };
    case "info":
      return { label: "Info", variant: "compact" };
    default:
      return { label: severity || "Finding", variant: "compact" };
  }
}

function getOwaspAgenticSkillsHref(categoryId: string) {
  const match = categoryId.match(/^(?:ASI|AST)(\d{2})$/i);
  if (!match) return null;
  return `https://owasp.org/www-project-agentic-skills-top-10/ast${match[1]}`;
}

function slugifyFindingAnchorPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getClawScanFindingAnchorId(finding: LlmAgenticRiskFinding, index: number) {
  const slug = slugifyFindingAnchorPart(`${finding.categoryId}-${finding.categoryLabel}`);
  return `clawscan-finding-${slug || "finding"}-${index + 1}`;
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
  const categoryHref = getOwaspAgenticSkillsHref(finding.categoryId);
  const severityBadge = getFindingSeverityBadgeMeta(finding.severity);
  const title = `${finding.categoryId}: ${finding.categoryLabel}`;
  const anchorId = getClawScanFindingAnchorId(finding, index);

  return (
    <div
      key={`${finding.categoryId}-${finding.riskBucket}-${index}`}
      className="agentic-risk-finding"
      id={anchorId}
    >
      <div className="agentic-risk-finding-header">
        <div className="agentic-risk-finding-badges">
          <Badge variant={severityBadge.variant}>{severityBadge.label}</Badge>
        </div>
        <div className="agentic-risk-finding-title-row">
          <a
            className="agentic-risk-finding-anchor"
            href={`#${anchorId}`}
            aria-label={`Link to ${title}`}
          >
            #
          </a>
          {categoryHref ? (
            <a
              className="agentic-risk-finding-title"
              href={categoryHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              {title}
            </a>
          ) : (
            <div className="agentic-risk-finding-title">{title}</div>
          )}
        </div>
      </div>
      <div className="agentic-risk-report-rows">
        <div className="agentic-risk-report-row">
          <div className="agentic-risk-report-label">What this means</div>
          <p>{finding.userImpact ?? finding.recommendation ?? evidence.explanation}</p>
        </div>
        <div className="agentic-risk-report-row">
          <div className="agentic-risk-report-label">Why it was flagged</div>
          <p>{evidence.explanation}</p>
        </div>
        <div className="agentic-risk-report-row">
          <div className="agentic-risk-report-label">Skill content</div>
          <div className="agentic-risk-report-content">
            <pre className="agentic-risk-evidence-snippet">{evidence.snippet}</pre>
          </div>
        </div>
      </div>
      {finding.recommendation ? (
        <div className="agentic-risk-report-row agentic-risk-report-row-secondary">
          <div className="agentic-risk-report-label">Recommendation</div>
          <p>{finding.recommendation}</p>
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
      <div className="agentic-risk-findings">
        {visibleFindings.map((finding, index) => (
          <AgenticRiskFindingCard
            key={`${finding.categoryId}-${finding.riskBucket}-${index}`}
            finding={finding}
            index={index}
          />
        ))}
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
  const blockingStaticFindings =
    staticFindings?.filter((finding) => finding.code.startsWith("malicious.")) ?? [];
  const hasBlockingStaticFindings = blockingStaticFindings.length > 0;
  if (
    !sha256hash &&
    !llmAnalysis &&
    !hasBlockingStaticFindings &&
    visibleCapabilityTags.length === 0
  ) {
    return null;
  }

  const vtStatus = getVirusTotalDisplayStatus(vtAnalysis);
  const vtUrl = sha256hash ? `https://www.virustotal.com/gui/file/${sha256hash}` : null;
  const isCodeInsight = vtAnalysis?.source === "code_insight";
  const aiAnalysis = vtAnalysis?.analysis;

  const llmVerdict = llmAnalysis?.verdict ?? llmAnalysis?.status;
  const llmDisplayStatus = getClawScanDisplayStatus(llmAnalysis);
  const llmStatusInfo = llmVerdict ? getScanStatusInfo(llmDisplayStatus) : null;
  const llmRiskLevel = getClawScanRiskLevel(llmAnalysis);

  if (variant === "badge") {
    return (
      <>
        {sha256hash ? (
          <div className="version-scan-badge">
            <VirusTotalIcon className="version-scan-icon version-scan-icon-vt" />
            <ScanResultBadge status={vtStatus} />
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
            <ScanResultBadge status={llmDisplayStatus} tone="review" />
            {scannerBasePath ? (
              <a
                href={`${scannerBasePath}/clawscan`}
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
              warning or malicious moderation verdicts.
            </div>
          </div>
        ) : null}
        {sha256hash ? (
          <div className="scan-result-row">
            <div className="scan-result-scanner">
              <VirusTotalIcon className="scan-result-icon scan-result-icon-vt" />
              <span className="scan-result-scanner-name">VirusTotal</span>
            </div>
            <ScanResultBadge status={vtStatus} />
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
            <ScanResultBadge status={llmDisplayStatus} tone="review" />
            {llmRiskLevel ? (
              <span className="scan-result-risk">
                <RiskLevelBadge level={llmRiskLevel} />
              </span>
            ) : null}
            {scannerBasePath ? (
              <a href={`${scannerBasePath}/clawscan`} className="scan-result-link">
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
        {hasBlockingStaticFindings ? (
          <>
            {scannerBasePath ? (
              <div className="scan-result-row">
                <div className="scan-result-scanner">
                  <span className="scan-result-scanner-name">Static analysis</span>
                </div>
                <ScanResultBadge
                  status="malicious"
                  label={`${blockingStaticFindings.length} blocking finding${
                    blockingStaticFindings.length === 1 ? "" : "s"
                  }`}
                />
                <a href={`${scannerBasePath}/static-analysis`} className="scan-result-link">
                  Details →
                </a>
              </div>
            ) : null}
            <StaticAnalysisDetail
              findings={blockingStaticFindings}
              vtStatus={vtStatus}
              llmStatus={llmVerdict}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
