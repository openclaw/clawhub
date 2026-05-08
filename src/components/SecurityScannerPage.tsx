import { Clock, ExternalLink, Fingerprint } from "lucide-react";
import type { ReactNode } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { SidebarMetadata } from "./SidebarMetadata";
import {
  ClawScanRiskReview,
  getScanStatusInfo,
  hasClawScanRiskReview,
  ScanResultBadge,
  type LlmAnalysis,
  type StaticFinding,
  type VtAnalysis,
} from "./SkillSecurityScanResults";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export type ScannerSlug = "virustotal" | "openclaw" | "static-analysis";

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
};

const SCANNER_LABELS: Record<ScannerSlug, string> = {
  virustotal: "VirusTotal",
  openclaw: "ClawScan",
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

function formatBadgeValue(value: unknown, fallback: string) {
  const formatted = formatValue(value) ?? fallback;
  return formatted
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="grid gap-1.5 border-b border-[color:var(--line)] pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-sm font-semibold text-[color:var(--ink-soft)]">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-[color:var(--ink)]">{children}</dd>
    </div>
  );
}

function getScannerStatus(props: SecurityScannerPageProps) {
  if (props.scanner === "virustotal")
    return props.vtAnalysis?.verdict ?? props.vtAnalysis?.status ?? "pending";
  if (props.scanner === "openclaw")
    return props.llmAnalysis?.verdict ?? props.llmAnalysis?.status ?? "pending";
  return props.staticScan?.status ?? "pending";
}

function getCheckedAt(props: SecurityScannerPageProps) {
  if (props.scanner === "virustotal") return props.vtAnalysis?.checkedAt ?? null;
  if (props.scanner === "openclaw") return props.llmAnalysis?.checkedAt ?? null;
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

function getSecurityHeroSubtext(label: string, status: string, checkedAt: number | null) {
  const statusInfo = getScanStatusInfo(status);
  const checkedDate = formatDate(checkedAt);
  if (!checkedDate) return `${label} audit pending with a ${statusInfo.label} result.`;
  return `Audited by ${label} with a ${statusInfo.label} result on ${checkedDate}.`;
}

function SecurityScannerHero({ label, props }: { label: string; props: SecurityScannerPageProps }) {
  const status = getScannerStatus(props);
  const checkedAt = getCheckedAt(props);
  const ownerLabel = getOwnerLabel(props.entity);
  const listingLabel = props.entity.kind === "skill" ? "skills" : "plugins";
  const ownerHref =
    props.entity.kind === "skill" ? `/${encodeURIComponent(ownerLabel)}` : "/plugins";

  return (
    <header className="security-scan-hero">
      <nav className="skill-hero-breadcrumbs" aria-label="Breadcrumb">
        <a href={`/${listingLabel}`}>{listingLabel}</a>
        <span aria-hidden="true">/</span>
        <a href={ownerHref}>{ownerLabel}</a>
        <span aria-hidden="true">/</span>
        <a href={`/${listingLabel}`}>{listingLabel}</a>
        <span aria-hidden="true">/</span>
        <a href={props.entity.detailPath}>{props.entity.name}</a>
        <span aria-hidden="true">/</span>
        <span>{scannerCrumbLabel(label)}</span>
      </nav>
      <div className="security-scan-hero-heading">
        <h1 className="skill-page-title">{props.entity.title}</h1>
        <p className="security-scan-hero-subtext">
          <ScanResultBadge status={status} />
          <span>{getSecurityHeroSubtext(label, status, checkedAt)}</span>
        </p>
      </div>
    </header>
  );
}

function OpenClawSecurityReport(props: SecurityScannerPageProps) {
  const label = SCANNER_LABELS[props.scanner];
  const status = getScannerStatus(props);
  const checkedAt = getCheckedAt(props);
  const sourceRepo = formatValue(
    props.source?.repository ?? props.source?.repo ?? props.source?.url,
  );
  const sourceCommit = formatValue(props.source?.commit ?? props.source?.sha);
  const riskAnalysis =
    props.llmAnalysis && hasClawScanRiskReview(props.llmAnalysis) ? props.llmAnalysis : null;
  const visibleFindingCount =
    props.llmAnalysis?.agenticRiskFindings?.filter(
      (finding) => (finding.status === "note" || finding.status === "concern") && finding.evidence,
    ).length ?? 0;

  return (
    <main className="section detail-page-section security-report-section">
      <div className="security-report-shell">
        <SecurityScannerHero label={label} props={props} />

        <div className="security-report-layout">
          <div className="security-report-main">
            <section className="security-report-analysis" aria-labelledby="analysis-heading">
              <h2 id="analysis-heading">Analysis</h2>
              <p>{props.llmAnalysis?.summary ?? "No ClawScan analysis has been recorded yet."}</p>
              {props.llmAnalysis?.guidance ? (
                <div className="security-report-analysis-guidance">
                  <span>Guidance</span>
                  {props.llmAnalysis.guidance}
                </div>
              ) : null}
            </section>

            {riskAnalysis ? (
              <section className="security-report-panel" aria-labelledby="agentic-findings-heading">
                <div className="security-report-panel-header">
                  <h2 id="agentic-findings-heading">Findings ({visibleFindingCount})</h2>
                </div>
                <div className="security-report-panel-body">
                  <ClawScanRiskReview analysis={riskAnalysis} showTitle={false} />
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
                { label: "Verdict", value: <ScanResultBadge status={status} /> },
                {
                  label: "Confidence",
                  value: (
                    <Badge
                      variant="compact"
                      className="min-h-0 rounded-[4px] px-2.5 py-0.5 text-[0.78rem] leading-[1.3]"
                    >
                      {formatBadgeValue(props.llmAnalysis?.confidence, "Not reported")}
                    </Badge>
                  ),
                },
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

function LegacyOpenClawDetails({ analysis }: { analysis?: LlmAnalysis | null }) {
  const verdict = analysis?.verdict ?? analysis?.status ?? "Pending";
  const verdictInfo = getScanStatusInfo(verdict);

  return (
    <>
      <DetailRow label="Verdict">{verdictInfo.label}</DetailRow>
      <DetailRow label="Confidence">{analysis?.confidence ?? "Not reported"}</DetailRow>
      <DetailRow label="Model">{analysis?.model ?? "Not reported"}</DetailRow>
      <DetailRow label="Summary">
        {analysis?.summary ?? "No ClawScan analysis has been recorded yet."}
      </DetailRow>
      <DetailRow label="Guidance">{analysis?.guidance ?? null}</DetailRow>
      <DetailRow label="Findings">
        {analysis?.findings ? (
          <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs">
            {analysis.findings}
          </pre>
        ) : null}
      </DetailRow>
    </>
  );
}

export function SecurityScannerPage(props: SecurityScannerPageProps) {
  const label = SCANNER_LABELS[props.scanner];
  const status = getScannerStatus(props);
  const checkedAt = getCheckedAt(props);
  const vtUrl = props.sha256hash ? `https://www.virustotal.com/gui/file/${props.sha256hash}` : null;
  const sourceRepo = formatValue(
    props.source?.repository ?? props.source?.repo ?? props.source?.url,
  );
  const sourceCommit = formatValue(props.source?.commit ?? props.source?.sha);

  if (
    props.scanner === "openclaw" &&
    props.entity.kind === "skill" &&
    hasClawScanRiskReview(props.llmAnalysis)
  ) {
    return <OpenClawSecurityReport {...props} />;
  }

  return (
    <main className="section detail-page-section">
      <div className="flex min-w-0 flex-col gap-5">
        <SecurityScannerHero label={label} props={props} />

        <div className="security-scanner-layout">
          <div className="flex min-w-0 flex-col gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Scanner verdict</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-2">
                  <ScanResultBadge status={status} />
                  <span className="inline-flex items-center gap-1 text-xs text-[color:var(--ink-soft)]">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatTime(checkedAt)}
                  </span>
                </div>
                <dl className="mt-2 flex flex-col gap-3">
                  {props.scanner === "virustotal" ? (
                    <>
                      <DetailRow label="Hash">
                        {props.sha256hash ? (
                          <span className="inline-flex max-w-full items-center gap-2 break-all font-mono text-xs">
                            <Fingerprint className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            {props.sha256hash}
                          </span>
                        ) : (
                          "No artifact hash recorded."
                        )}
                      </DetailRow>
                      <DetailRow label="Source">
                        {props.vtAnalysis?.source ?? "File reputation"}
                      </DetailRow>
                      <DetailRow label="Verdict">
                        {props.vtAnalysis?.verdict ?? props.vtAnalysis?.status ?? "Pending"}
                      </DetailRow>
                      <DetailRow label="Code Insight">
                        {props.vtAnalysis?.analysis ?? null}
                      </DetailRow>
                      <DetailRow label="External report">
                        {vtUrl ? (
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
                        )}
                      </DetailRow>
                    </>
                  ) : null}

                  {props.scanner === "openclaw" ? (
                    <LegacyOpenClawDetails analysis={props.llmAnalysis} />
                  ) : null}

                  {props.scanner === "static-analysis" ? (
                    <>
                      <DetailRow label="Summary">
                        {props.staticScan?.summary ??
                          "No static analysis result has been recorded yet."}
                      </DetailRow>
                      <DetailRow label="Reason codes">
                        {props.staticScan?.reasonCodes?.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {props.staticScan.reasonCodes.map((code) => (
                              <Badge key={code} variant="compact">
                                {code}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          "None"
                        )}
                      </DetailRow>
                      <DetailRow label="Engine">
                        {props.staticScan?.engineVersion ?? "Not reported"}
                      </DetailRow>
                    </>
                  ) : null}

                  <DetailRow label="Source repository">{sourceRepo}</DetailRow>
                  <DetailRow label="Source commit">
                    {sourceCommit ? (
                      <span className="font-mono text-xs">{sourceCommit}</span>
                    ) : null}
                  </DetailRow>
                </dl>
              </CardContent>
            </Card>

            {props.scanner === "openclaw" && props.llmAnalysis?.dimensions?.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Review Dimensions</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="flex flex-col gap-3">
                    {props.llmAnalysis.dimensions.map((dimension) => (
                      <DetailRow key={dimension.name} label={dimension.label}>
                        <div className="flex flex-col gap-1">
                          <Badge variant="compact" className="w-fit">
                            {dimension.rating}
                          </Badge>
                          <span>{dimension.detail}</span>
                        </div>
                      </DetailRow>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            ) : null}

            {props.scanner === "static-analysis" && props.staticScan?.findings?.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Evidence</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-3">
                    {props.staticScan.findings.map((finding, index) => (
                      <div
                        key={`${finding.code}-${finding.file}-${finding.line}-${index}`}
                        className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-3"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge variant="compact">{finding.severity}</Badge>
                          <span className="break-all font-mono text-xs text-[color:var(--ink-soft)]">
                            {finding.file}:{finding.line}
                          </span>
                        </div>
                        <div className="text-sm font-semibold text-[color:var(--ink)]">
                          {finding.message}
                        </div>
                        <pre className="mt-2 whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[color:var(--surface)] p-2 font-mono text-xs text-[color:var(--ink-soft)]">
                          {finding.evidence || finding.code}
                        </pre>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <aside className="flex min-w-0 flex-col gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Artifact</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-3">
                  <DetailRow label="Package">{props.entity.name}</DetailRow>
                  <DetailRow label="Version">{props.entity.version ?? "Latest"}</DetailRow>
                  <DetailRow label="Hash">
                    {props.sha256hash ? (
                      <span className="break-all font-mono text-xs">{props.sha256hash}</span>
                    ) : (
                      "Not recorded"
                    )}
                  </DetailRow>
                </dl>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </main>
  );
}
