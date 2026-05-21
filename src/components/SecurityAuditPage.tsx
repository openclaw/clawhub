import { Clock, ExternalLink, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { PublisherClawScanNote } from "./PublisherClawScanNote";
import {
  aggregateAuditVerdict,
  AUDIT_SCANNER_LABELS,
  SECURITY_AUDIT_SUBTEXT,
  getAuditScannerOrder,
  getAuditScannerStatus,
  getLatestAuditCheckedAt,
  getSecurityAuditOverviewCopy,
  type AuditScannerKind,
  type StaticScanAnalysis,
} from "./securityAuditModel";
import { SidebarMetadata } from "./SidebarMetadata";
import {
  ClawScanRiskReview,
  FindingSeverityBadge,
  getClawScanRiskLevel,
  hasClawScanRiskReview,
  RiskLevelBadge,
  ScanResultBadge,
  type LlmAnalysis,
  type VtAnalysis,
} from "./SkillSecurityScanResults";
import { Alert, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

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
  staticScan?: StaticScanAnalysis | null;
  source?: Record<string, unknown> | null;
  clawScanNote?: string | null;
  canManageArtifact?: boolean;
  settingsHref?: string | null;
};

const EMPTY_STATIC_FINDINGS: StaticScanAnalysis["findings"] = [];
const RISK_ANALYSIS_SCOPE_COPY =
  "Risk analysis is mapped to the OWASP Agentic Skills Top 10 using artifact evidence from this release.";

function formatTime(value?: number | null) {
  if (!value) return "Not checked yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function extractDetailPathParts(detailPath: string) {
  return detailPath.split("/").filter(Boolean).map(decodeURIComponent);
}

function getOwnerLabel(entity: EntityRef) {
  if (entity.owner?.handle) return entity.owner.handle;
  const parts = extractDetailPathParts(entity.detailPath);
  if (entity.kind === "skill") return parts[0] ?? "unknown";
  return entity.owner?._id ?? "plugins";
}

function SecurityAuditHero({ props }: { props: SecurityAuditPageProps }) {
  const ownerLabel = getOwnerLabel(props.entity);
  const listingLabel = props.entity.kind === "skill" ? "skills" : "plugins";
  const ownerHref =
    props.entity.kind === "skill" ? `/user/${encodeURIComponent(ownerLabel)}` : "/plugins";

  return (
    <header className="security-scan-hero">
      <nav className="skill-hero-breadcrumbs" aria-label="Breadcrumb">
        <a href={`/${listingLabel}`}>{listingLabel}</a>
        <span aria-hidden="true">/</span>
        <a href={ownerHref}>{ownerLabel}</a>
        <span aria-hidden="true">/</span>
        <a href={props.entity.detailPath}>{props.entity.name}</a>
        <span aria-hidden="true">/</span>
        <span>Security Audit</span>
      </nav>
      <div className="security-scan-hero-heading">
        <h1 className="skill-page-title">{props.entity.title}</h1>
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

function isReviewStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  return normalized === "review" || normalized === "warn" || normalized === "suspicious";
}

function PublisherNotePrompt({
  storageKey,
  settingsHref,
}: {
  storageKey: string;
  settingsHref: string;
}) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey, "1");
  }

  return (
    <Alert variant="info" className="publisher-note-prompt" role="status">
      <Info size={18} aria-hidden="true" />
      <AlertDescription>
        <a href={settingsHref}>Add a publisher note</a> to give this audit context on these
        findings.
      </AlertDescription>
      <button type="button" onClick={dismiss} aria-label="Dismiss publisher note prompt">
        <X size={16} aria-hidden="true" />
      </button>
    </Alert>
  );
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

function ClawScanSection(props: SecurityAuditPageProps) {
  const riskAnalysis =
    props.llmAnalysis && hasClawScanRiskReview(props.llmAnalysis) ? props.llmAnalysis : null;

  return (
    <div className="security-report-panel-body security-report-panel-body-findings">
      {riskAnalysis ? (
        <ClawScanRiskReview analysis={riskAnalysis} showTitle={false} />
      ) : (
        <p className="security-audit-empty-detail">
          No visible risk-analysis findings were reported for this release.
        </p>
      )}
    </div>
  );
}

function PublisherNoteSection(props: SecurityAuditPageProps) {
  const status = getAuditScannerStatus("clawscan", props);
  const riskAnalysis =
    props.llmAnalysis && hasClawScanRiskReview(props.llmAnalysis) ? props.llmAnalysis : null;
  const showPublisherNotePrompt =
    props.canManageArtifact &&
    props.settingsHref &&
    !props.clawScanNote?.trim() &&
    isReviewStatus(status) &&
    Boolean(riskAnalysis);
  const publisherNotePromptHref = showPublisherNotePrompt ? props.settingsHref : null;
  const publisherNotePromptStorageKey = `clawhub.publisher-note-prompt.${props.entity.kind}.${props.entity.name}.${props.entity.version ?? "latest"}`;

  return (
    <>
      <PublisherClawScanNote note={props.clawScanNote} compact />
      {publisherNotePromptHref ? (
        <PublisherNotePrompt
          storageKey={publisherNotePromptStorageKey}
          settingsHref={publisherNotePromptHref}
        />
      ) : null}
    </>
  );
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

function formatStaticFindingTitle(code: string) {
  const withoutPrefix = code.replace(/^(?:suspicious|malicious|review)\./, "");
  const words = withoutPrefix
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  if (!words.length) return code;
  return [words[0].charAt(0).toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ");
}

function getStaticFindingKey(finding: StaticScanAnalysis["findings"][number]) {
  return `${finding.file}:${finding.line}`;
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

function extractLineFromFile(content: string, line: number) {
  if (!Number.isFinite(line) || line < 1) return null;
  const value = content.split(/\r?\n/)[line - 1]?.trimEnd();
  return value?.trim() ? value : null;
}

function useStaticFindingSnippets(entity: EntityRef, findings: StaticScanAnalysis["findings"]) {
  const [snippets, setSnippets] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();

    if (!findings.length) {
      setSnippets({});
      return () => controller.abort();
    }

    const uniqueFindings = Array.from(
      new Map(findings.map((finding) => [getStaticFindingKey(finding), finding])).values(),
    );

    async function loadSnippets() {
      const entries = await Promise.all(
        uniqueFindings.map(async (finding) => {
          try {
            const response = await fetch(buildArtifactFileUrl(entity, finding.file), {
              signal: controller.signal,
            });
            if (!response.ok) return null;
            const content = await response.text();
            const snippet = extractLineFromFile(content, finding.line);
            return snippet ? ([getStaticFindingKey(finding), snippet] as const) : null;
          } catch {
            return null;
          }
        }),
      );

      if (!controller.signal.aborted) {
        setSnippets(Object.fromEntries(entries.filter((entry) => entry !== null)));
      }
    }

    void loadSnippets();
    return () => controller.abort();
  }, [entity.kind, entity.name, entity.version, findings]);

  return snippets;
}

function StaticAnalysisSection(props: SecurityAuditPageProps) {
  const status = props.staticScan?.status?.trim().toLowerCase() ?? null;
  const findings = props.staticScan?.findings ?? EMPTY_STATIC_FINDINGS;
  const fetchedSnippets = useStaticFindingSnippets(props.entity, findings);
  const emptyCopy =
    status === "clean" || status === "benign"
      ? "No static analysis findings were reported for this release."
      : status && !["loading", "not_found", "pending"].includes(status)
        ? `Static analysis reported ${status} with no visible findings.`
        : "Static analysis findings are pending for this release.";
  return (
    <div className="security-report-panel-body security-report-panel-body-findings">
      {findings.length ? (
        <div className="static-analysis-findings">
          {findings.map((finding, index) => (
            <StaticAnalysisFinding
              key={`${finding.code}-${finding.file}-${finding.line}-${index}`}
              finding={finding}
              snippet={fetchedSnippets[getStaticFindingKey(finding)] ?? finding.evidence}
            />
          ))}
        </div>
      ) : (
        <p className="security-audit-empty-detail">{emptyCopy}</p>
      )}
    </div>
  );
}

function StaticAnalysisFinding({
  finding,
  snippet,
}: {
  finding: StaticScanAnalysis["findings"][number];
  snippet?: string | null;
}) {
  const trimmedSnippet = snippet?.trim();
  return (
    <article className="static-analysis-finding">
      <div className="static-analysis-finding-header">
        <h3 className="agentic-risk-finding-title">{formatStaticFindingTitle(finding.code)}</h3>
        <div className="agentic-risk-finding-badges">
          <FindingSeverityBadge severity={finding.severity} />
        </div>
      </div>
      <dl className="static-analysis-finding-details">
        <div>
          <dt>Finding</dt>
          <dd>{finding.message}</dd>
        </div>
        {trimmedSnippet ? (
          <div>
            <dt>Skill content</dt>
            <dd>
              <pre className="agentic-risk-evidence-snippet">{trimmedSnippet}</pre>
            </dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function RiskAnalysisInfoLink() {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="security-report-title-info-link"
            aria-label={RISK_ANALYSIS_SCOPE_COPY}
          >
            <Info size={15} aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="security-report-title-tooltip">
          {RISK_ANALYSIS_SCOPE_COPY}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
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
          {kind === "clawscan" ? <RiskAnalysisInfoLink /> : null}
        </div>
      </div>
      {kind === "clawscan" ? <ClawScanSection {...props} /> : null}
      {kind === "virustotal" ? <VirusTotalSection {...props} /> : null}
      {kind === "static-analysis" ? <StaticAnalysisSection {...props} /> : null}
    </section>
  );
}

function SecurityAuditSidebar(props: SecurityAuditPageProps) {
  const latestCheckedAt = getLatestAuditCheckedAt(props);
  const clawScanRiskLevel = getClawScanRiskLevel(props.llmAnalysis);
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
          label: "Risk",
          value: clawScanRiskLevel ? <RiskLevelBadge level={clawScanRiskLevel} /> : "Not reported",
        },
        {
          label: "Latest audit",
          value: (
            <span className="sidebar-metadata-inline">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {formatTime(latestCheckedAt)}
            </span>
          ),
        },
        { label: "Version", value: props.entity.version ?? "Latest" },
      ]}
    />
  );
}

export function SecurityAuditPage(props: SecurityAuditPageProps) {
  const orderedScanners = getAuditScannerOrder();

  return (
    <main className="section detail-page-section security-report-section">
      <div className="security-report-shell">
        <SecurityAuditHero props={props} />

        <div className="security-report-layout">
          <div className="security-report-main">
            <SecurityAuditOverview {...props} />
            <PublisherNoteSection {...props} />
            {orderedScanners.map((kind) => (
              <SecurityAuditScannerSection key={kind} kind={kind} props={props} />
            ))}
          </div>

          <aside className="security-report-sidebar" aria-label="Security audit metadata">
            <h2 className="sr-only">Security Audit Metadata</h2>
            <SecurityAuditSidebar {...props} />
          </aside>
        </div>
      </div>
    </main>
  );
}

export function SecurityAuditPageSkeleton() {
  return (
    <main className="section detail-page-section security-report-section">
      <div
        className="security-report-shell security-scanner-skeleton"
        role="status"
        aria-label="Loading security audit"
        aria-busy="true"
      >
        <header className="security-scan-hero">
          <div className="skill-hero-breadcrumbs">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-3" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-3" />
            <Skeleton className="h-4 w-40 max-w-[42vw]" />
            <Skeleton className="h-4 w-3" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="security-scan-hero-heading">
            <Skeleton className="h-12 w-full max-w-[520px]" />
            <div className="security-scan-hero-subtext">
              <Skeleton className="h-8 w-24 rounded-[var(--r-pill)]" />
              <Skeleton className="h-5 w-full max-w-[340px]" />
            </div>
          </div>
        </header>

        <div className="security-report-layout">
          <div className="security-report-main">
            {Array.from({ length: 3 }).map((_, index) => (
              <section
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder count
                key={index}
                className="security-report-panel"
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

          <aside className="security-report-sidebar" aria-label="Security audit metadata">
            <div className="sidebar-metadata sidebar-metadata-compact">
              <div className="sidebar-metadata-row">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-40" />
              </div>
              <div className="sidebar-metadata-grid">
                <div className="sidebar-metadata-row">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-5 w-10" />
                </div>
                <div className="sidebar-metadata-row">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </div>
              <div className="sidebar-metadata-row">
                <Skeleton className="h-3 w-24" />
                <div className="security-report-badge-list">
                  <Skeleton className="h-6 w-16 rounded-[var(--r-pill)]" />
                  <Skeleton className="h-6 w-20 rounded-[var(--r-pill)]" />
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
