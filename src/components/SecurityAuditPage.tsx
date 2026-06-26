import {
  ArrowLeft,
  Check,
  Clock,
  Download,
  ExternalLink,
  Info,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import {
  buildSecurityAuditExportFilename,
  buildSecurityAuditExportZip,
  type StaticScan,
} from "../lib/securityAuditExport";
import {
  aggregateAuditVerdict,
  AUDIT_SCANNER_LABELS,
  SECURITY_AUDIT_SUBTEXT,
  getAuditScannerOrder,
  getLatestAuditCheckedAt,
  getSecurityAuditOverviewCopy,
  type AuditScannerKind,
} from "./securityAuditModel";
import { SidebarMetadata } from "./SidebarMetadata";
import {
  getSkillSpectorOverviewCopy,
  getSkillSpectorIssueCount,
  hasSkillSpectorFindings,
  ScanResultBadge,
  SkillSpectorFindings,
  type LlmAnalysis,
  type SkillSpectorAnalysis,
  type SkillSpectorIssue,
  type VtAnalysis,
} from "./SkillSecurityScanResults";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

type OwnerRef = {
  _id?: string;
  handle?: string | null;
};

type EntityRef = {
  kind: "skill" | "plugin";
  title: string;
  name: string;
  version?: string | null;
  owner?: OwnerRef | null;
  ownerUserId?: Id<"users"> | null;
  ownerPublisherId?: Id<"publishers"> | null;
  detailPath: string;
};

type SecurityAuditPageProps = {
  entity: EntityRef;
  sha256hash?: string | null;
  vtAnalysis?: VtAnalysis | null;
  llmAnalysis?: LlmAnalysis | null;
  skillSpectorAnalysis?: SkillSpectorAnalysis | null;
  skillSpectorApplicable?: boolean;
  staticScan?: StaticScan | null;
  source?: Record<string, unknown> | null;
  canManageArtifact?: boolean;
  onRequestRescan?: (() => Promise<unknown>) | null;
};

const EMPTY_SKILLSPECTOR_ISSUES: SkillSpectorIssue[] = [];
const SKILLSPECTOR_VISIBLE_CHECK_LIMIT = 5;
const SKILLSPECTOR_CLEAN_CHECKS = [
  {
    category: "Prompt Injection",
    ruleIds: ["P1", "P2", "P3", "P4", "P5"],
    patterns: ["Instruction Override", "Hidden Instructions", "Exfiltration Commands"],
  },
  {
    category: "Data Exfiltration",
    ruleIds: ["E1", "E2", "E3", "E4"],
    patterns: ["External Transmission", "Env Variable Harvesting", "File System Enumeration"],
  },
  {
    category: "Privilege Escalation",
    ruleIds: ["PE1", "PE2", "PE3"],
    patterns: ["Excessive Permissions", "Sudo/Root Execution", "Credential Access"],
  },
  {
    category: "Supply Chain",
    ruleIds: ["SC1", "SC2", "SC3", "SC4", "SC5", "SC6"],
    patterns: ["Unpinned Dependencies", "External Script Fetching", "Obfuscated Code"],
  },
  {
    category: "Excessive Agency",
    ruleIds: ["EA1", "EA2", "EA3", "EA4", "SDI2", "SDI3"],
    patterns: ["Unrestricted Tool Access", "Autonomous Decision Making", "Scope Creep"],
  },
  {
    category: "Output Handling",
    ruleIds: ["OH1", "OH2", "OH3"],
    patterns: ["Unvalidated Output Injection", "Cross-Context Output", "Unbounded Output"],
  },
  {
    category: "System Prompt Leakage",
    ruleIds: ["P6", "P7", "P8"],
    patterns: ["Direct Leakage", "Indirect Extraction", "Tool-Based Exfiltration"],
  },
  {
    category: "Memory Poisoning",
    ruleIds: ["MP1", "MP2", "MP3"],
    patterns: ["Persistent Context Injection", "Context Window Stuffing", "Memory Manipulation"],
  },
  {
    category: "Tool Misuse",
    ruleIds: ["TM1", "TM2", "TM3"],
    patterns: ["Tool Parameter Abuse", "Chaining Abuse", "Unsafe Defaults"],
  },
  {
    category: "Rogue Agent",
    ruleIds: ["RA1", "RA2"],
    patterns: ["Self-Modification", "Session Persistence"],
  },
  {
    category: "Trigger Abuse",
    ruleIds: ["TR1", "TR2", "TR3", "SQP1"],
    patterns: ["Overly Broad Trigger", "Shadow Command Trigger", "Keyword Baiting Trigger"],
  },
  {
    category: "Behavioral AST",
    ruleIds: ["AST1", "AST2", "AST3", "AST4", "AST5", "AST6", "AST7", "AST8"],
    patterns: ["exec() Call", "eval() Call", "Dynamic Import"],
  },
  {
    category: "Taint Tracking",
    ruleIds: ["TT1", "TT2", "TT3", "TT4", "TT5"],
    patterns: [
      "Direct Taint Flow",
      "Variable-Mediated Taint Flow",
      "Credential Exfiltration Chain",
    ],
  },
  {
    category: "YARA Signatures",
    ruleIds: ["YR1", "YR2", "YR3", "YR4"],
    patterns: ["Malware Match", "Webshell Match", "Cryptominer Match"],
  },
  {
    category: "MCP Least Privilege",
    ruleIds: ["LP1", "LP2", "LP3", "LP4"],
    patterns: ["Underdeclared Capability", "Wildcard Permission", "Missing Permission Declaration"],
  },
  {
    category: "MCP Tool Poisoning",
    ruleIds: ["TP1", "TP2", "TP3", "TP4", "SDI1", "SDI4"],
    patterns: ["Hidden Instructions", "Unicode Deception", "Parameter Description Injection"],
  },
];

function normalizeSkillSpectorPatternValue(value?: string | null) {
  return value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeSkillSpectorIssueId(value?: string | null) {
  return value
    ?.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function getSkillSpectorIssueSearchText(issue: SkillSpectorIssue) {
  return [
    issue.issueId,
    issue.category,
    issue.pattern,
    issue.finding,
    issue.explanation,
    issue.codeSnippet,
    issue.remediation,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLowerCase();
}

function inferSkillSpectorPatternCategory(issue: SkillSpectorIssue) {
  const issueId = normalizeSkillSpectorIssueId(issue.issueId);
  const category = normalizeSkillSpectorPatternValue(issue.category);
  const pattern = normalizeSkillSpectorPatternValue(issue.pattern);

  for (const check of SKILLSPECTOR_CLEAN_CHECKS) {
    if (check.ruleIds.some((ruleId) => normalizeSkillSpectorIssueId(ruleId) === issueId)) {
      return check.category;
    }
  }
  for (const check of SKILLSPECTOR_CLEAN_CHECKS) {
    if (normalizeSkillSpectorPatternValue(check.category) === category) return check.category;
  }
  for (const check of SKILLSPECTOR_CLEAN_CHECKS) {
    if (check.patterns.some((value) => normalizeSkillSpectorPatternValue(value) === pattern)) {
      return check.category;
    }
  }

  const text = getSkillSpectorIssueSearchText(issue);
  if (
    /\b(exfiltrat\w*|external|transmit\w*|upload\w*|send|sending|post|session|token|secret|credential\w*)\b/.test(
      text,
    )
  ) {
    return "Data Exfiltration";
  }
  if (/\b(sudo|root|ssh key|password|credential access)\b/.test(text)) {
    return "Privilege Escalation";
  }
  if (/\b(unpinned|dependency|curl\s*\|\s*bash|remote script|obfuscat|typosquat)\b/.test(text)) {
    return "Supply Chain";
  }
  if (/\b(scope creep|autonomous|unrestricted|excessive|capability)\b/.test(text)) {
    return "Excessive Agency";
  }
  if (/\b(system prompt|prompt leakage|internal rules)\b/.test(text)) {
    return "System Prompt Leakage";
  }
  if (/\b(trigger|activation|keyword)\b/.test(text)) {
    return "Trigger Abuse";
  }
  if (/\b(exec|eval|subprocess|os\.system|dynamic import)\b/.test(text)) {
    return "Behavioral AST";
  }
  if (
    /\b(description.behavior|description behavior|mismatch|hidden instruction|unicode|parameter)\b/.test(
      text,
    )
  ) {
    return "MCP Tool Poisoning";
  }
  if (/\b(ignore|override|hidden instruction|jailbreak|instruction)\b/.test(text)) {
    return "Prompt Injection";
  }
  return null;
}

function getFlaggedSkillSpectorPatternCategories(issues: SkillSpectorIssue[]) {
  return new Set(
    issues
      .map((issue) => inferSkillSpectorPatternCategory(issue))
      .filter((category): category is string => Boolean(category)),
  );
}

const UTC_MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function formatAuditSidebarTime(value?: number | null) {
  if (!value) return "Not checked yet";
  const date = new Date(value);
  const hour = date.getUTCHours();
  const hour12 = hour % 12 || 12;
  const minute = date.getUTCMinutes().toString().padStart(2, "0");
  const period = hour >= 12 ? "PM" : "AM";
  return `${UTC_MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} · ${hour12}:${minute} ${period} UTC`;
}

function getSecurityAuditBackLabel(entity: EntityRef) {
  return entity.kind === "plugin" ? "Back to plugin" : "Back to skill";
}

function SecurityAuditSidebarActions({ props }: { props: SecurityAuditPageProps }) {
  const [rescanState, setRescanState] = useState<"idle" | "submitting" | "queued" | "error">(
    "idle",
  );
  const showActions = Boolean(props.canManageArtifact && props.onRequestRescan);
  const isRescanBusy = rescanState === "submitting" || rescanState === "queued";

  async function requestRescan() {
    if (!props.onRequestRescan || isRescanBusy) return;
    setRescanState("submitting");
    try {
      await props.onRequestRescan();
      setRescanState("queued");
    } catch {
      setRescanState("error");
    }
  }

  function downloadAuditExport() {
    if (!showActions || typeof document === "undefined" || typeof URL === "undefined") return;
    const zipBytes = buildSecurityAuditExportZip(props);
    const filename = buildSecurityAuditExportFilename(props);
    const url = URL.createObjectURL(new Blob([zipBytes], { type: "application/zip" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!showActions) return null;

  return (
    <div className="skill-sidebar-actions skill-sidebar-actions-secondary security-audit-sidebar-actions">
      <Button
        type="button"
        variant="outline"
        className="skill-sidebar-action-button"
        onClick={() => void requestRescan()}
        disabled={isRescanBusy}
        loading={isRescanBusy}
        aria-label={isRescanBusy ? "Scanning" : "Rescan"}
        title={isRescanBusy ? "Scanning" : "Rescan"}
      >
        {!isRescanBusy ? (
          <RefreshCw className="security-audit-rescan-icon" aria-hidden="true" />
        ) : null}
        {isRescanBusy ? "Scanning" : "Rescan"}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="skill-sidebar-action-button"
        onClick={downloadAuditExport}
        aria-label="Download security audit"
        title="Download"
      >
        <Download className="security-audit-action-icon" aria-hidden="true" />
        Download
      </Button>
      {rescanState === "error" ? (
        <span
          className="security-audit-rescan-error security-audit-sidebar-action-status"
          role="status"
        >
          Rescan could not be queued.
        </span>
      ) : null}
    </div>
  );
}

function SecurityAuditHero({ props }: { props: SecurityAuditPageProps }) {
  return (
    <header className="security-scan-hero">
      <a
        href={props.entity.detailPath}
        className="skill-settings-back-link security-audit-back-link"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {getSecurityAuditBackLabel(props.entity)}
      </a>
      <div className="security-scan-hero-heading">
        <p className="security-audit-eyebrow">Security audit</p>
        <div className="security-scan-hero-title-row">
          <h1 className="skill-page-title">{props.entity.title}</h1>
        </div>
        <p className="security-scan-hero-subtext">{SECURITY_AUDIT_SUBTEXT}</p>
      </div>
    </header>
  );
}

function getVirusTotalEngineStats(analysis?: VtAnalysis | null) {
  return analysis?.engineStats ?? analysis?.metadata?.stats ?? null;
}

function joinReadableClauses(clauses: string[]) {
  if (clauses.length <= 1) return clauses[0] ?? "";
  if (clauses.length === 2) return `${clauses[0]}, and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(", ")}, and ${clauses.at(-1)}`;
}

function hasNonEngineVirusTotalSource(analysis?: VtAnalysis | null) {
  if (!analysis) return false;
  const source = analysis.source?.trim().toLowerCase();
  const scanner = analysis.scanner?.trim().toLowerCase();
  return Boolean(
    (source && !source.startsWith("engines")) || (scanner && !scanner.startsWith("engines")),
  );
}

function getArtifactKindLabel(entity: EntityRef) {
  return entity.kind === "plugin" ? "plugin" : "skill";
}

function getVirusTotalNoFindingsCopy(_entity: EntityRef) {
  return "No VirusTotal findings";
}

function getVirusTotalPendingCopy(entity: EntityRef) {
  return `VirusTotal findings are pending for this ${getArtifactKindLabel(entity)} version.`;
}

function getVirusTotalEngineOverview(analysis: VtAnalysis | null | undefined, entity: EntityRef) {
  const stats = getVirusTotalEngineStats(analysis);
  if (stats) {
    const malicious = stats.malicious ?? 0;
    const suspicious = stats.suspicious ?? 0;
    const clean = (stats.harmless ?? 0) + (stats.undetected ?? 0);
    const total = malicious + suspicious + clean;
    if (total <= 0) return getVirusTotalNoFindingsCopy(entity);

    const artifactKind = getArtifactKindLabel(entity);
    const hasFullEngineStats =
      stats.malicious !== undefined &&
      stats.suspicious !== undefined &&
      stats.harmless !== undefined &&
      stats.undetected !== undefined;
    const firstCountLabel = (count: number) =>
      hasFullEngineStats
        ? `${count}/${total} vendors`
        : `${count} ${count === 1 ? "vendor" : "vendors"}`;
    const followupCountLabel = (count: number) =>
      hasFullEngineStats ? `${count}/${total}` : `${count} ${count === 1 ? "vendor" : "vendors"}`;

    if (malicious === 0 && suspicious === 0) {
      return `${firstCountLabel(clean)} flagged this ${artifactKind} as clean.`;
    }

    const clauses: string[] = [];
    if (malicious > 0) {
      clauses.push(`${firstCountLabel(malicious)} flagged this ${artifactKind} as malicious`);
    }
    if (suspicious > 0) {
      clauses.push(
        clauses.length === 0
          ? `${firstCountLabel(suspicious)} flagged this ${artifactKind} as suspicious`
          : `${followupCountLabel(suspicious)} flagged it as suspicious`,
      );
    }
    if (clean > 0) {
      clauses.push(`${followupCountLabel(clean)} flagged it as clean`);
    }
    return `${joinReadableClauses(clauses)}.`;
  }

  if (hasNonEngineVirusTotalSource(analysis)) {
    return getVirusTotalNoFindingsCopy(entity);
  }

  const status = analysis?.status?.trim().toLowerCase();
  if (
    status === "clean" ||
    status === "benign" ||
    analysis?.verdict === "undetected-only-fallback"
  ) {
    return getVirusTotalNoFindingsCopy(entity);
  }
  if (status && !["loading", "not_found", "pending"].includes(status)) {
    return `VirusTotal engine telemetry is currently ${status} for this artifact.`;
  }

  return null;
}

function getVirusTotalOverviewCopy(analysis: VtAnalysis | null | undefined, entity: EntityRef) {
  return getVirusTotalEngineOverview(analysis, entity) ?? getVirusTotalPendingCopy(entity);
}

function SecurityAuditOverview(props: SecurityAuditPageProps) {
  const overviewCopy = getSecurityAuditOverviewCopy({ llmAnalysis: props.llmAnalysis });
  return (
    <section
      className="security-report-panel security-report-panel-compact"
      aria-labelledby="overview-heading"
    >
      <div className="security-report-panel-header">
        <h2 id="overview-heading" className="skill-install-panel-title">
          Overview
        </h2>
      </div>
      <div className="security-report-overview-body">
        {overviewCopy.map((copy, index) => (
          <p key={`security-audit-overview-${index}`}>{copy}</p>
        ))}
      </div>
    </section>
  );
}

function hasStaticScanDetails(staticScan?: StaticScan | null): staticScan is StaticScan {
  return Boolean(staticScan?.summary?.trim() || staticScan?.findings?.length);
}

function formatStaticScanSeverity(value: string) {
  return value
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function StaticScanDetails({ staticScan }: { staticScan: StaticScan }) {
  const findings = staticScan.findings ?? [];
  return (
    <div className="security-report-panel-body security-report-panel-body-findings">
      {staticScan.summary?.trim() ? (
        <div className="security-report-overview-body">
          <p>{staticScan.summary}</p>
        </div>
      ) : null}
      {findings.length ? (
        <div className="static-analysis-findings">
          {findings.map((finding, index) => (
            <article
              key={`${finding.code}-${finding.file}-${finding.line}-${index}`}
              className="static-analysis-finding"
            >
              <div className="static-analysis-finding-header">
                <h3 className="agentic-risk-finding-title">{finding.message}</h3>
                <div className="agentic-risk-finding-badges">
                  <ScanResultBadge
                    status={finding.severity}
                    label={formatStaticScanSeverity(finding.severity)}
                  />
                </div>
              </div>
              <dl className="static-analysis-finding-details">
                <div>
                  <dt>Code</dt>
                  <dd>{finding.code}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>
                    {finding.file}:{finding.line}
                  </dd>
                </div>
                {finding.evidence?.trim() ? (
                  <div>
                    <dt>Evidence</dt>
                    <dd>
                      <pre className="agentic-risk-evidence-snippet">{finding.evidence}</pre>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StaticScanSection(props: SecurityAuditPageProps) {
  const staticScan = hasStaticScanDetails(props.staticScan) ? props.staticScan : null;
  if (!staticScan) return null;
  return <StaticScanDetails staticScan={staticScan} />;
}

function VirusTotalSection(props: SecurityAuditPageProps) {
  const vtUrl = props.sha256hash ? `https://www.virustotal.com/gui/file/${props.sha256hash}` : null;
  return (
    <div className="security-report-panel-body">
      <div className="security-report-overview-body">
        <p>{getVirusTotalOverviewCopy(props.vtAnalysis, props.entity)}</p>
      </div>
      {vtUrl ? (
        <a
          href={vtUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="security-audit-external-link"
        >
          View on VirusTotal
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

function SkillSpectorSection(props: SecurityAuditPageProps) {
  if (props.skillSpectorApplicable === false) {
    return (
      <div className="security-report-panel-body security-report-panel-body-findings">
        <div className="security-report-overview-body">
          <p>SkillSpector was not run because this plugin release contains no bundled skills.</p>
        </div>
      </div>
    );
  }

  const analysis = props.skillSpectorAnalysis ?? null;
  const overviewCopy = getSkillSpectorOverviewCopy(analysis);
  const contentSnippets = useSkillSpectorContentSnippets(
    props.entity,
    analysis?.issues ?? EMPTY_SKILLSPECTOR_ISSUES,
  );
  const hasFindings = analysis ? hasSkillSpectorFindings(analysis) : false;
  const issueCount = getSkillSpectorIssueCount(analysis);
  const storedIssueCount = analysis?.issues.length ?? 0;
  const hasHiddenFindings = issueCount > storedIssueCount;
  const findingsTitle = issueCount > 0 ? `Findings (${issueCount})` : "Findings";
  const status = analysis?.status?.trim().toLowerCase();
  const showChecks = Boolean(
    analysis && !["error", "failed", "loading", "not_found", "pending"].includes(status ?? ""),
  );
  const showOverview = !hasFindings && !showChecks;

  return (
    <div className="security-report-panel-body security-report-panel-body-findings">
      {showOverview ? (
        <div className="security-report-overview-body">
          <p>{overviewCopy}</p>
        </div>
      ) : null}
      {showChecks ? (
        <SkillSpectorChecks
          hasHiddenFindings={hasHiddenFindings}
          issues={analysis?.issues ?? EMPTY_SKILLSPECTOR_ISSUES}
        />
      ) : null}
      {analysis && hasFindings ? (
        <div className="skillspector-findings-block">
          <div className="skillspector-subsection-title">{findingsTitle}</div>
          <SkillSpectorFindings analysis={analysis} contentSnippets={contentSnippets} />
        </div>
      ) : null}
    </div>
  );
}

function SkillSpectorChecks({
  hasHiddenFindings,
  issues,
}: {
  hasHiddenFindings: boolean;
  issues: SkillSpectorIssue[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const flaggedCategories = getFlaggedSkillSpectorPatternCategories(issues);
  const sortedChecks = [...SKILLSPECTOR_CLEAN_CHECKS].sort((left, right) => {
    const leftFlagged = flaggedCategories.has(left.category);
    const rightFlagged = flaggedCategories.has(right.category);
    if (leftFlagged === rightFlagged) return 0;
    return leftFlagged ? -1 : 1;
  });
  const visibleChecks = isExpanded
    ? sortedChecks
    : sortedChecks.slice(0, SKILLSPECTOR_VISIBLE_CHECK_LIMIT);
  const remainingCount = sortedChecks.length - SKILLSPECTOR_VISIBLE_CHECK_LIMIT;

  return (
    <div className="skillspector-checks" aria-label="SkillSpector checks">
      <div className="skillspector-subsection-title">Vulnerability Patterns</div>
      <ul className="skillspector-checks-list">
        {visibleChecks.map((check) => {
          const isFlagged = flaggedCategories.has(check.category);
          const isUnknown = hasHiddenFindings && !isFlagged;
          const Icon = isFlagged ? TriangleAlert : isUnknown ? Info : Check;
          return (
            <li
              className={`skillspector-check-row${isFlagged ? " skillspector-check-row-flagged" : ""}${isUnknown ? " skillspector-check-row-unknown" : ""}`}
              key={check.category}
            >
              <Icon
                className={`skillspector-check-icon${isFlagged ? " skillspector-check-icon-flagged" : ""}${isUnknown ? " skillspector-check-icon-unknown" : ""}`}
                aria-hidden="true"
              />
              <span className="skillspector-check-category">{check.category}</span>
              <span className="skillspector-check-patterns">{check.patterns.join(", ")}</span>
            </li>
          );
        })}
      </ul>
      {remainingCount > 0 ? (
        <button
          type="button"
          className="skillspector-checks-toggle"
          onClick={() => setIsExpanded((value) => !value)}
        >
          {isExpanded ? "Show less" : `Show ${remainingCount} more`}
        </button>
      ) : null}
    </div>
  );
}

function SkillSpectorAttribution() {
  return (
    <div className="skillspector-attribution" aria-label="By NVIDIA">
      <img
        className="skillspector-nvidia-mark"
        src="https://www.nvidia.com/favicon.ico"
        alt=""
        aria-hidden="true"
      />
      <span>By NVIDIA</span>
    </div>
  );
}

function resolveAbsoluteBaseUrl(...candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    try {
      return new URL(value).toString();
    } catch {
      continue;
    }
  }
  return null;
}

function buildArtifactFileUrl(entity: EntityRef, path: string) {
  const base =
    entity.kind === "skill"
      ? `/api/v1/skills/${encodeURIComponent(entity.name)}/file`
      : `/api/v1/packages/${encodeURIComponent(entity.name)}/file`;
  const params = new URLSearchParams({ path });
  if (entity.version) params.set("version", entity.version);
  const relativePath = `${base}?${params.toString()}`;
  const convexClientBaseUrl = resolveAbsoluteBaseUrl(
    getRuntimeEnv("VITE_CONVEX_SITE_URL"),
    getRuntimeEnv("VITE_CONVEX_URL"),
  );

  if (
    typeof window !== "undefined" &&
    convexClientBaseUrl &&
    ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname)
  ) {
    return new URL(relativePath, convexClientBaseUrl).toString();
  }

  return relativePath;
}

function extractLineRangeFromFile(content: string, startLine: number, endLine?: number) {
  if (!Number.isFinite(startLine) || startLine < 1) return null;
  const lines = content.split(/\r?\n/);
  const start = Math.floor(startLine);
  const end = Math.max(start, Math.min(Math.floor(endLine ?? start), start + 12));
  const value = lines
    .slice(start - 1, end)
    .map((line) => line.trimEnd())
    .join("\n");
  return value.trim() ? value : null;
}

function useSkillSpectorContentSnippets(entity: EntityRef, issues: SkillSpectorIssue[]) {
  const [snippets, setSnippets] = useState<Record<number, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    const issuesWithLocations = issues
      .map((issue, index) => ({ issue, index }))
      .filter(
        ({ issue }) =>
          Boolean(issue.file?.trim()) &&
          typeof issue.startLine === "number" &&
          Number.isFinite(issue.startLine),
      );

    if (!issuesWithLocations.length) {
      setSnippets((current) => (Object.keys(current).length ? {} : current));
      return () => controller.abort();
    }

    const uniqueFiles = Array.from(
      new Set(
        issuesWithLocations
          .map(({ issue }) => issue.file?.trim())
          .filter((file): file is string => Boolean(file)),
      ),
    );

    async function loadSnippets() {
      const fileContents = new Map<string, string>();
      await Promise.all(
        uniqueFiles.map(async (file) => {
          try {
            const response = await fetch(buildArtifactFileUrl(entity, file), {
              signal: controller.signal,
            });
            if (!response.ok) return;
            fileContents.set(file, await response.text());
          } catch {
            return;
          }
        }),
      );

      const entries = issuesWithLocations
        .map(({ issue, index }) => {
          const file = issue.file?.trim();
          const content = file ? fileContents.get(file) : null;
          if (!content || typeof issue.startLine !== "number") return null;
          const snippet = extractLineRangeFromFile(content, issue.startLine, issue.endLine);
          return snippet ? ([index, snippet] as const) : null;
        })
        .filter((entry): entry is readonly [number, string] => entry !== null);

      if (!controller.signal.aborted) setSnippets(Object.fromEntries(entries));
    }

    void loadSnippets();
    return () => controller.abort();
  }, [entity.kind, entity.name, entity.version, issues]);

  return snippets;
}

function SecurityAuditScannerSection({
  kind,
  props,
}: {
  kind: AuditScannerKind;
  props: SecurityAuditPageProps;
}) {
  const label = AUDIT_SCANNER_LABELS[kind];
  return (
    <section
      className="security-report-panel security-report-panel-compact"
      aria-labelledby={`${kind}-heading`}
    >
      <div className="security-report-panel-header">
        <div className="security-report-panel-title-row">
          <h2 id={`${kind}-heading`} className="skill-install-panel-title">
            {label}
          </h2>
          {kind === "skillspector" ? <SkillSpectorAttribution /> : null}
        </div>
      </div>
      {kind === "static" ? <StaticScanSection {...props} /> : null}
      {kind === "virustotal" ? <VirusTotalSection {...props} /> : null}
      {kind === "skillspector" ? <SkillSpectorSection {...props} /> : null}
    </section>
  );
}

function SecurityAuditSidebar(props: SecurityAuditPageProps) {
  const latestCheckedAt = getLatestAuditCheckedAt(props);
  const verdict = aggregateAuditVerdict(props);

  return (
    <SidebarMetadata
      ariaLabel="Security audit metadata"
      density="compact"
      blocks={[
        {
          label: "Outcome",
          value: <ScanResultBadge status={verdict} />,
        },
        {
          label: "Latest audit",
          value: (
            <span className="security-audit-latest-time">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{formatAuditSidebarTime(latestCheckedAt)}</span>
            </span>
          ),
        },
        { label: "Version", value: props.entity.version ?? "Latest" },
      ]}
    />
  );
}

export function SecurityAuditPage(props: SecurityAuditPageProps) {
  const orderedScanners = getAuditScannerOrder(props);

  return (
    <main className="section detail-page-section security-report-section security-audit-page">
      <div className="security-report-shell">
        <SecurityAuditHero props={props} />

        <div className="security-report-layout">
          <div className="security-report-main">
            <SecurityAuditOverview {...props} />
            {orderedScanners.map((kind) => (
              <SecurityAuditScannerSection key={kind} kind={kind} props={props} />
            ))}
          </div>

          <aside className="security-report-sidebar" aria-label="Security audit metadata">
            <h2 className="sr-only">Security Audit Metadata</h2>
            <SecurityAuditSidebar {...props} />
            <SecurityAuditSidebarActions props={props} />
          </aside>
        </div>
      </div>
    </main>
  );
}

export function SecurityAuditPageSkeleton() {
  return (
    <main className="section detail-page-section security-report-section security-audit-page security-audit-page-skeleton">
      <div
        className="security-report-shell security-scanner-skeleton"
        role="status"
        aria-label="Loading security audit"
        aria-busy="true"
      >
        <header className="security-scan-hero">
          <Skeleton className="h-5 w-28" />
          <div className="security-scan-hero-heading">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-12 w-full max-w-[520px]" />
            <Skeleton className="h-5 w-full max-w-[340px]" />
          </div>
        </header>

        <div className="security-report-layout security-report-skeleton-layout">
          <div className="security-report-main">
            {Array.from({ length: 3 }).map((_, index) => (
              <section
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder count
                key={index}
                className="security-report-panel security-report-skeleton-panel"
              >
                <div className="security-report-panel-header">
                  <Skeleton className="h-6 w-32" />
                </div>
                <div className="security-report-overview-body">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-11/12" />
                  <Skeleton className="h-5 w-3/4" />
                </div>
              </section>
            ))}
          </div>

          <aside
            className="security-report-sidebar security-report-skeleton-sidebar"
            aria-label="Security audit metadata"
          >
            <div className="sidebar-metadata sidebar-metadata-compact">
              <div className="sidebar-metadata-row">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-6 w-20 rounded-[var(--r-pill)]" />
              </div>
              <div className="sidebar-metadata-row">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-32" />
              </div>
              <div className="sidebar-metadata-row">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-5 w-16" />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
