import { Clock, ExternalLink, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { PublisherClawScanNote } from "./PublisherClawScanNote";
import { SidebarMetadata } from "./SidebarMetadata";
import {
  ClawScanRiskReview,
  getClawScanDisplayStatus,
  getClawScanRiskLevel,
  getVisibleClawScanFindingCount,
  getVirusTotalDisplayStatus,
  hasClawScanRiskReview,
  isVirusTotalAiOnlyAnalysis,
  RiskLevelBadge,
  ScanResultBadge,
  type LlmAnalysis,
  type StaticFinding,
  type VtAnalysis,
} from "./SkillSecurityScanResults";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";

export type ScannerSlug = "virustotal" | "clawscan" | "static-analysis";

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

type SecurityScannerPageProps = {
  scanner: ScannerSlug;
  entity: EntityRef;
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
  source?: Record<string, unknown> | null;
  clawScanNote?: string | null;
  canManageArtifact?: boolean;
  settingsHref?: string | null;
};

const SCANNER_LABELS: Record<ScannerSlug, string> = {
  virustotal: "VirusTotal",
  clawscan: "ClawScan",
  "static-analysis": "Static analysis",
};

function formatTime(value?: number | null) {
  if (!value) return "Not checked yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDate(value?: number | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatValue(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value))
    return value.length ? value.map(formatValue).filter(Boolean).join(", ") : null;
  return JSON.stringify(value);
}

function getScannerStatus(props: SecurityScannerPageProps) {
  if (props.scanner === "virustotal") return getVirusTotalDisplayStatus(props.vtAnalysis);
  if (props.scanner === "clawscan") return getClawScanDisplayStatus(props.llmAnalysis);
  if (props.staticScan?.status?.toLowerCase() === "malicious") return "malicious";
  return props.staticScan ? "advisory" : "pending";
}

function getCheckedAt(props: SecurityScannerPageProps) {
  if (props.scanner === "virustotal") return props.vtAnalysis?.checkedAt ?? null;
  if (props.scanner === "clawscan") return props.llmAnalysis?.checkedAt ?? null;
  return props.staticScan?.checkedAt ?? null;
}

function scannerCrumbLabel(label: string) {
  return label.toLowerCase();
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

function getSecurityHeroSubtext(label: string, checkedAt: number | null) {
  const checkedDate = formatDate(checkedAt);
  if (!checkedDate) return `${label} audit pending.`;
  return `Audited by ${label} on ${checkedDate}.`;
}

function SecurityScannerHero({ label, props }: { label: string; props: SecurityScannerPageProps }) {
  const status = getScannerStatus(props);
  const checkedAt = getCheckedAt(props);
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
        <span>{scannerCrumbLabel(label)}</span>
      </nav>
      <div className="security-scan-hero-heading">
        <h1 className="skill-page-title">{props.entity.title}</h1>
        <p className="security-scan-hero-subtext">
          <ScanResultBadge
            status={status}
            tone={props.scanner === "clawscan" ? "review" : undefined}
          />
          <span>{getSecurityHeroSubtext(label, checkedAt)}</span>
        </p>
      </div>
    </header>
  );
}

function getVisibleFindingCount(props: SecurityScannerPageProps) {
  if (props.scanner === "static-analysis") return props.staticScan?.findings?.length ?? 0;
  if (props.scanner === "clawscan") return getVisibleClawScanFindingCount(props.llmAnalysis);
  if (props.scanner === "virustotal" && getVirusTotalAdvisoryText(props.vtAnalysis)) return 1;
  return 0;
}

function getVirusTotalAdvisoryText(analysis?: VtAnalysis | null) {
  if (!isVirusTotalAiOnlyAnalysis(analysis)) return null;
  const text = analysis?.analysis?.trim();
  if (!text) return null;
  return text.replace(/^Type:\s*.+?\s+Name:\s*.+?\s+Version:\s*\S+\s+/i, "").trim();
}

function getOverviewCopy(props: SecurityScannerPageProps) {
  if (props.scanner === "virustotal") {
    if (isVirusTotalAiOnlyAnalysis(props.vtAnalysis)) {
      return [
        "VirusTotal did not report multi-engine malware detections for this artifact. AI-only context from VirusTotal is treated as advisory and does not require user action.",
      ];
    }
    return [
      props.vtAnalysis?.analysis ??
        "No VirusTotal analysis has been recorded yet. File reputation checks will appear here once the artifact hash has been scanned.",
    ];
  }

  if (props.scanner === "static-analysis") {
    return [
      props.staticScan?.summary ??
        "No static analysis result has been recorded yet. Pattern checks will appear here once the artifact has been analyzed.",
    ];
  }

  return [
    props.llmAnalysis?.summary ?? "No ClawScan analysis has been recorded yet.",
    props.llmAnalysis?.guidance ?? null,
  ];
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
        <a href={settingsHref}>Add a publisher note</a> to give ClawScan context on these findings.
      </AlertDescription>
      <button type="button" onClick={dismiss} aria-label="Dismiss publisher note prompt">
        <X size={16} aria-hidden="true" />
      </button>
    </Alert>
  );
}

function SecurityScannerReport(props: SecurityScannerPageProps) {
  const label = SCANNER_LABELS[props.scanner];
  const status = getScannerStatus(props);
  const checkedAt = getCheckedAt(props);
  const vtUrl =
    props.scanner === "virustotal" && props.sha256hash
      ? `https://www.virustotal.com/gui/file/${props.sha256hash}`
      : null;
  const sourceRepo = formatValue(
    props.source?.repository ?? props.source?.repo ?? props.source?.url,
  );
  const sourceCommit = formatValue(props.source?.commit ?? props.source?.sha);
  const riskAnalysis =
    props.scanner === "clawscan" && props.llmAnalysis && hasClawScanRiskReview(props.llmAnalysis)
      ? props.llmAnalysis
      : null;
  const riskLevel = props.scanner === "clawscan" ? getClawScanRiskLevel(props.llmAnalysis) : null;
  const vtAdvisoryText = getVirusTotalAdvisoryText(props.vtAnalysis);
  const visibleFindingCount = getVisibleFindingCount(props);
  const overviewCopy = getOverviewCopy(props).filter(Boolean);
  const showOverview = !(props.scanner === "virustotal" && vtAdvisoryText);
  const showPublisherNotePrompt =
    props.scanner === "clawscan" &&
    props.canManageArtifact &&
    props.settingsHref &&
    !props.clawScanNote?.trim() &&
    isReviewStatus(status) &&
    Boolean(riskAnalysis);
  const publisherNotePromptHref = showPublisherNotePrompt ? props.settingsHref : null;
  const publisherNotePromptStorageKey = `clawhub.publisher-note-prompt.${props.entity.kind}.${props.entity.name}.${props.entity.version ?? "latest"}`;

  return (
    <main className="section detail-page-section security-report-section">
      <div className="security-report-shell">
        <SecurityScannerHero label={label} props={props} />

        <div className="security-report-layout">
          <div className="security-report-main">
            {showOverview ? (
              <section className="security-report-panel" aria-labelledby="overview-heading">
                <div className="security-report-panel-header">
                  <h2 id="overview-heading" className="skill-install-panel-title">
                    Overview
                  </h2>
                </div>
                <div className="security-report-overview-body">
                  {overviewCopy.map((copy, index) => (
                    <p key={`${props.scanner}-overview-${index}`}>{copy}</p>
                  ))}
                </div>
              </section>
            ) : null}

            {props.scanner === "clawscan" ? (
              <PublisherClawScanNote note={props.clawScanNote} />
            ) : null}

            {riskAnalysis ? (
              <section className="security-report-panel" aria-labelledby="agentic-findings-heading">
                <div className="security-report-panel-header">
                  <h2 id="agentic-findings-heading" className="skill-install-panel-title">
                    Findings ({visibleFindingCount})
                  </h2>
                </div>
                <div className="security-report-panel-body">
                  {publisherNotePromptHref ? (
                    <PublisherNotePrompt
                      storageKey={publisherNotePromptStorageKey}
                      settingsHref={publisherNotePromptHref}
                    />
                  ) : null}
                  <ClawScanRiskReview analysis={riskAnalysis} showTitle={false} />
                </div>
              </section>
            ) : null}

            {props.scanner === "virustotal" && vtAdvisoryText ? (
              <section className="security-report-panel" aria-labelledby="vt-advisory-heading">
                <div className="security-report-panel-header">
                  <h2 id="vt-advisory-heading" className="skill-install-panel-title">
                    Findings ({visibleFindingCount})
                  </h2>
                </div>
                <div className="security-report-panel-body">
                  <div className="vt-advisory-finding">
                    <p>{vtAdvisoryText}</p>
                  </div>
                </div>
              </section>
            ) : null}

            {props.scanner === "static-analysis" && props.staticScan?.findings?.length ? (
              <section className="security-report-panel" aria-labelledby="static-findings-heading">
                <div className="security-report-panel-header">
                  <h2 id="static-findings-heading" className="skill-install-panel-title">
                    Findings ({visibleFindingCount})
                  </h2>
                </div>
                <div className="security-report-panel-body">
                  <div className="static-analysis-findings">
                    {props.staticScan.findings.map((finding, index) => (
                      <article
                        key={`${finding.code}-${finding.file}-${finding.line}-${index}`}
                        className="static-analysis-finding"
                      >
                        <div className="static-analysis-finding-header">
                          <Badge variant="compact">{finding.severity}</Badge>
                          <h3>{finding.code}</h3>
                        </div>
                        <dl className="static-analysis-finding-details">
                          <div>
                            <dt>Location</dt>
                            <dd className="font-mono">
                              {finding.file}:{finding.line}
                            </dd>
                          </div>
                          <div>
                            <dt>Finding</dt>
                            <dd>{finding.message}</dd>
                          </div>
                          {finding.evidence ? (
                            <div>
                              <dt>Evidence</dt>
                              <dd>
                                <pre>{finding.evidence}</pre>
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      </article>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}
          </div>

          <aside className="security-report-sidebar" aria-label="Scan metadata">
            <h2 className="sr-only">Scan Metadata</h2>
            <SidebarMetadata
              ariaLabel="Scan metadata"
              density="compact"
              blocks={[
                ...(props.scanner === "clawscan"
                  ? [
                      {
                        label: "Risk level",
                        value: riskLevel ? <RiskLevelBadge level={riskLevel} /> : null,
                      },
                    ]
                  : []),
                {
                  label: "Analyzed",
                  value: (
                    <span className="sidebar-metadata-inline">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatTime(checkedAt)}
                    </span>
                  ),
                },
                {
                  grid: [
                    { label: "Findings", value: visibleFindingCount },
                    { label: "Version", value: props.entity.version ?? "Latest" },
                  ],
                },
                ...(props.scanner === "static-analysis"
                  ? [
                      {
                        label: "Reason codes",
                        value: props.staticScan?.reasonCodes?.length ? (
                          <div className="security-report-badge-list">
                            {props.staticScan.reasonCodes.map((code) => (
                              <Badge key={code} variant="compact">
                                {code}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          "None"
                        ),
                      },
                      {
                        label: "Engine",
                        value: props.staticScan?.engineVersion ?? "Not reported",
                      },
                    ]
                  : []),
                ...(props.scanner === "virustotal"
                  ? [
                      {
                        label: "Hash",
                        value: props.sha256hash ? (
                          <span className="break-all font-mono text-xs">{props.sha256hash}</span>
                        ) : (
                          "Not recorded"
                        ),
                      },
                      {
                        label: "Source",
                        value: props.vtAnalysis?.source ?? "File reputation",
                      },
                      {
                        label: "External report",
                        value: vtUrl ? (
                          <a
                            href={vtUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 break-all text-[color:var(--accent)] hover:underline"
                          >
                            View on VirusTotal
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        ) : (
                          "Unavailable until an artifact hash is recorded."
                        ),
                      },
                    ]
                  : []),
                ...(props.scanner === "clawscan" && props.entity.kind === "plugin"
                  ? [
                      {
                        label: "Hash",
                        value: props.sha256hash ? (
                          <span className="break-all font-mono text-xs">{props.sha256hash}</span>
                        ) : (
                          "Not recorded"
                        ),
                      },
                    ]
                  : []),
                { label: "Source repository", value: sourceRepo },
                {
                  label: "Source commit",
                  value: sourceCommit ? (
                    <span className="font-mono text-xs">{sourceCommit}</span>
                  ) : null,
                },
              ]}
            />
          </aside>
        </div>
      </div>
    </main>
  );
}

export function SecurityScannerPage(props: SecurityScannerPageProps) {
  return <SecurityScannerReport {...props} />;
}

export function SecurityScannerPageSkeleton() {
  return (
    <main className="section detail-page-section security-report-section">
      <div
        className="security-report-shell security-scanner-skeleton"
        role="status"
        aria-label="Loading security details"
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
            <section className="security-report-panel">
              <div className="security-report-panel-header">
                <Skeleton className="h-6 w-28" />
              </div>
              <div className="security-report-overview-body">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-11/12" />
                <Skeleton className="h-5 w-3/4" />
              </div>
            </section>

            <section className="security-report-panel">
              <div className="security-report-panel-header">
                <Skeleton className="h-6 w-32" />
              </div>
              <div className="security-report-panel-body">
                <div className="static-analysis-findings">
                  {Array.from({ length: 2 }).map((_, index) => (
                    <article
                      // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder count
                      key={index}
                      className="static-analysis-finding"
                    >
                      <div className="static-analysis-finding-header">
                        <Skeleton className="h-6 w-16 rounded-[var(--r-pill)]" />
                        <Skeleton className="h-5 w-48 max-w-full" />
                      </div>
                      <div className="space-y-3">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                        <Skeleton className="h-16 w-full rounded-[var(--r-sm)]" />
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <aside className="security-report-sidebar" aria-label="Scan metadata">
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
              <div className="sidebar-metadata-row">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-5 w-28" />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
