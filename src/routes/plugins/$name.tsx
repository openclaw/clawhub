import {
  createFileRoute,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, type RequestForQueries } from "convex/react";
import {
  AlertTriangle,
  Braces,
  ChevronRight,
  FileArchive,
  Files,
  Fingerprint,
  Hammer,
  HardDrive,
  Info,
  Package,
  Server,
  Tag,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
  pluginApiRetirement,
  type PluginApiRetirement,
} from "../../../convex/lib/pluginApiRetirements";
import { CatalogDetailBreadcrumb, CatalogDetailLayout } from "../../components/CatalogDetailLayout";
import { CatalogMetadataEditor } from "../../components/CatalogMetadataEditor";
import { useDownloadsSidebarMetricBlock } from "../../components/DownloadsMetricCard";
import { EmptyState } from "../../components/EmptyState";
import { InlineMarkdownSummary } from "../../components/InlineMarkdownSummary";
import { InstallCopyButton } from "../../components/InstallCopyButton";
import { Container } from "../../components/layout/Container";
import "./-plugin-catalog-detail.css";
import { MarketplaceIcon } from "../../components/MarketplaceIcon";
import { OfficialBadge } from "../../components/OfficialBadge";
import { PluginCatalogOverview } from "../../components/PluginCatalogOverview";
import { PluginCatalogRail } from "../../components/PluginCatalogRail";
import {
  PluginPackageDetails,
  pluginDetailTabFromHash,
  type PluginDetailTab,
} from "../../components/PluginPackageDetails";
import {
  PLUGIN_VERSIONS_PAGE_SIZE,
  PluginVersionsPanel,
} from "../../components/PluginVersionsPanel";
import { SidebarMetadata } from "../../components/SidebarMetadata";
import { formatOpenClawPrompt } from "../../components/skillDetailUtils";
import { InstallCommandCard } from "../../components/SkillInstallSurface";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { getActivityTrendEndDay } from "../../lib/activityTrend";
import { formatRetryDelay } from "../../lib/formatRetryDelay";
import { buildPluginMeta, buildSocialMetaHead } from "../../lib/og";
import { getOpenClawPackageCandidateNames } from "../../lib/openClawExtensionSlugs";
import { buildPublisherProfileHref } from "../../lib/ownerRoute";
import {
  fetchPackageDetail,
  fetchPackageReadme,
  fetchPackageVersion,
  fetchPackageVersions,
  getPackageArtifactDownloadPath,
  getPackageDownloadPath,
  isRateLimitedPackageApiError,
  type PackageDetailResponse,
  type PackageVersionDetail,
} from "../../lib/packageApi";
import { familyLabel } from "../../lib/packageLabels";
import {
  buildPluginCanonicalHrefForRequestedPath,
  buildPluginDetailHref,
  buildPluginSecurityAuditHref,
  parseScopedPackageName,
} from "../../lib/pluginRoutes";
import { formatValidationFindingMessage } from "../../lib/pluginValidationFormat";
import { presentationTitle } from "../../lib/presentationTitle";
import { buildReadmeAssetBaseUrl } from "../../lib/readmeAssetBaseUrl";
import { useAuthStatus } from "../../lib/useAuthStatus";
import { useDeferredPackageActivityTrend } from "../../lib/useDeferredActivityTrend";
import { useHeroCreatorPublisher } from "../../lib/useHeroCreatorPublisher";

type PluginDetailRateLimitState = {
  scope: "detail" | "metadata";
  retryAfterSeconds: number | null;
} | null;

type PluginInspectorFinding = Partial<PluginApiRetirement> & {
  packageName: string;
  version: string;
  findingKind?: "warning" | "error";
  code: string;
  severity?: string;
  level?: string;
  issueClass?: string;
  deprecated?: boolean;
  message: string;
  evidence?: string[];
  authorRemediation?: {
    summary: string;
    docsUrl?: string;
  };
  inspectorVersion?: string;
  targetOpenClawVersion?: string;
  scanSource?: "publish" | "nightly";
  createdAt: number;
};

type PluginInspectorValidationSummary = {
  apiRetirements?: PluginApiRetirement[];
  findingCount: number;
  errorCount: number;
  warningCount: number;
  incompatibleAfterOpenClawVersion: string | null;
};

export type PluginDetailLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
  versions: Awaited<ReturnType<typeof fetchPackageVersions>> | null | undefined;
  readme: string | null;
  rateLimited: PluginDetailRateLimitState;
};

export async function loadPluginDetail(
  requestedName: string,
  candidateNames = getOpenClawPackageCandidateNames(requestedName),
): Promise<PluginDetailLoaderData> {
  let resolvedName = requestedName;
  let detail: PackageDetailResponse = { package: null, owner: null };

  for (const candidateName of candidateNames) {
    let candidateDetail: PackageDetailResponse;
    try {
      candidateDetail = await fetchPackageDetail(candidateName);
    } catch (error) {
      if (isRateLimitedPackageApiError(error)) {
        return {
          detail: { package: null, owner: null },
          version: null,
          versions: undefined,
          readme: null,
          rateLimited: {
            scope: "detail",
            retryAfterSeconds: error.retryAfterSeconds,
          },
        };
      }
      throw error;
    }
    if (candidateDetail.package) {
      detail = candidateDetail;
      resolvedName = candidateName;
      break;
    }
    detail = candidateDetail;
  }

  if (!detail.package) {
    return { detail, version: null, versions: undefined, readme: null, rateLimited: null };
  }

  try {
    let releaseVersion = detail.package.latestVersion;
    let cursor: string | undefined;
    // Beta-only packages have published releases but no stable/latest pointer.
    while (!releaseVersion) {
      const releases = await fetchPackageVersions(resolvedName, { limit: 1, cursor });
      releaseVersion = releases.items[0]?.version;
      if (releaseVersion || !releases.nextCursor) break;
      cursor = releases.nextCursor;
    }
    const [version, readme] = await Promise.all([
      releaseVersion ? fetchPackageVersion(resolvedName, releaseVersion) : Promise.resolve(null),
      releaseVersion ? fetchPackageReadme(resolvedName, releaseVersion) : Promise.resolve(null),
    ]);

    return { detail, version, versions: undefined, readme, rateLimited: null };
  } catch (error) {
    if (isRateLimitedPackageApiError(error)) {
      return {
        detail,
        version: null,
        versions: undefined,
        readme: null,
        rateLimited: {
          scope: "metadata",
          retryAfterSeconds: error.retryAfterSeconds,
        },
      };
    }
    throw error;
  }
}

export function pluginDetailHead(name: string, loaderData?: PluginDetailLoaderData) {
  const meta = buildPluginMeta({
    name: loaderData?.detail.package?.name ?? name,
    displayName: loaderData?.detail.package?.displayName,
    summary: loaderData?.detail.package?.summary,
    owner: loaderData?.detail.owner?.handle,
    latestVersion: loaderData?.detail.package?.latestVersion,
  });
  return buildSocialMetaHead(meta);
}

export const Route = createFileRoute("/plugins/$name")({
  beforeLoad: ({ location, params }) => {
    if (parseScopedPackageName(params.name)) {
      const encodedSecurityPrefix = `/plugins/${encodeURIComponent(params.name)}/security/`;
      const encodedSecurityAuditPath = `/plugins/${encodeURIComponent(params.name)}/security-audit`;
      if (location.pathname.startsWith(encodedSecurityPrefix)) {
        throw redirect({
          href: buildPluginSecurityAuditHref(params.name),
          statusCode: 308,
        });
      }
      if (location.pathname === encodedSecurityAuditPath) {
        throw redirect({
          href: buildPluginSecurityAuditHref(params.name),
          statusCode: 308,
        });
      }

      throw redirect({
        href: buildPluginDetailHref(params.name),
        statusCode: 308,
      });
    }
  },
  loader: async ({ location, params }) => {
    const data = await loadPluginDetail(params.name);
    const ownerHandle = data.detail.owner?.handle ?? null;
    const packageName = data.detail.package?.name ?? null;

    if (packageName && ownerHandle) {
      throw redirect({
        href: buildPluginCanonicalHrefForRequestedPath(
          location?.pathname ?? buildPluginDetailHref(params.name),
          params.name,
          packageName,
          {
            ownerHandle,
          },
        ),
        replace: true,
      });
    }

    return data;
  },
  head: ({ params, loaderData }) => pluginDetailHead(params.name, loaderData),
  pendingComponent: PluginDetailPending,
  component: PluginDetailRoute,
});

function formatArtifactSize(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"] as const;
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

type PluginManifestSummary = NonNullable<
  NonNullable<PackageVersionDetail["version"]>["pluginManifestSummary"]
>;
type PluginConfigField = PluginManifestSummary["configFields"][number];

type PluginKvRowProps = {
  label: string;
  icon?: LucideIcon;
  mono?: boolean;
  hash?: boolean;
  children: ReactNode;
};

function PluginKvRow({ label, icon: Icon, mono, hash, children }: PluginKvRowProps) {
  const valueClassName = [
    "plugin-kv-value",
    mono ? "plugin-kv-value--mono" : null,
    hash ? "plugin-kv-value--hash" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="plugin-kv-row">
      <dt className="plugin-kv-label">
        <span className="plugin-kv-label-inner">
          {Icon ? <Icon size={14} className="plugin-kv-icon" aria-hidden="true" /> : null}
          <span>{label}</span>
        </span>
      </dt>
      <dd className={valueClassName}>{children}</dd>
    </div>
  );
}

function compatibilityFieldIcon(key: string): LucideIcon | undefined {
  switch (key) {
    case "pluginApiRange":
      return Braces;
    case "builtWithOpenClawVersion":
      return Tag;
    case "minGatewayVersion":
      return Server;
    default:
      return undefined;
  }
}

function formatCompatibilityLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}

function PluginManifestConfigurationPanel({ fields }: { fields: PluginConfigField[] }) {
  return (
    <div className="plugin-manifest-capabilities">
      <section className="plugin-manifest-section">
        <div className="plugin-manifest-list">
          {fields.map((field) => (
            <article key={field.name} className="plugin-manifest-row">
              <div className="plugin-manifest-row-main">
                <code>{field.name}</code>
                {field.description ? <p>{field.description}</p> : null}
              </div>
              <div className="plugin-manifest-badges">
                {field.required ? <Badge variant="warning">Required</Badge> : null}
                {field.sensitive ? <Badge variant="review">Sensitive</Badge> : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

const PLUGIN_VALIDATE_CLI = "clawhub package validate <path-to-plugin>";

function pluginValidateCommand(openClawVersion?: string) {
  return openClawVersion
    ? `${PLUGIN_VALIDATE_CLI} --openclaw-version ${openClawVersion}`
    : PLUGIN_VALIDATE_CLI;
}

function buildPluginValidateCommand(findings: PluginInspectorFinding[]) {
  const exactTarget =
    findings.find((finding) => finding.scanSource === "nightly" && finding.targetOpenClawVersion)
      ?.targetOpenClawVersion ??
    findings.find((finding) => finding.targetOpenClawVersion)?.targetOpenClawVersion;
  return pluginValidateCommand(exactTarget);
}
const PLUGIN_VALIDATE_TOOLBAR_LABEL = "Validate locally before publishing";

const INSPECTOR_ISSUE_CLASS_LABELS: Record<string, string> = {
  "upstream-metadata": "Metadata",
  "deprecation-warning": "Deprecated API",
  "compatibility-error": "Compatibility",
  "compatibility-warning": "Compatibility",
};

function formatInspectorIssueClassLabel(issueClass?: string) {
  if (!issueClass || issueClass === "inspector-gap") return null;
  if (INSPECTOR_ISSUE_CLASS_LABELS[issueClass]) {
    return INSPECTOR_ISSUE_CLASS_LABELS[issueClass];
  }
  return issueClass
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseInspectorPriority(severity?: string) {
  const match = severity?.match(/^P(\d+)$/i);
  return match ? Number.parseInt(match[1] ?? "99", 10) : 99;
}

function compareInspectorFindings(a: PluginInspectorFinding, b: PluginInspectorFinding) {
  const priorityDiff = parseInspectorPriority(a.severity) - parseInspectorPriority(b.severity);
  if (priorityDiff !== 0) return priorityDiff;
  const categoryA = formatInspectorIssueClassLabel(a.issueClass) ?? "";
  const categoryB = formatInspectorIssueClassLabel(b.issueClass) ?? "";
  return categoryA.localeCompare(categoryB);
}

function ValidationSummaryHint({
  issueCount,
  packageName,
  version,
}: {
  issueCount: number;
  packageName: string;
  version: string | null;
}) {
  const issueLabel = issueCount === 1 ? "1 issue" : `${issueCount} issues`;
  const versionLabel = version ? `version ${version}` : "this release";

  return (
    <>
      We found <strong>{issueLabel}</strong> with {versionLabel} of <strong>{packageName}</strong>.
      Review the findings below, apply the fix, and upload a new version.
    </>
  );
}

function buildValidationAgentFixPrompt(args: {
  packageName: string;
  releaseVersion?: string | null;
  findings: PluginInspectorFinding[];
}) {
  const sortedFindings = [...args.findings].sort(compareInspectorFindings);
  const errors = sortedFindings.filter((finding) => finding.findingKind === "error");
  const warnings = sortedFindings.filter((finding) => finding.findingKind !== "error");

  const lines = [
    `Fix the following OpenClaw plugin validation findings for package "${args.packageName}".`,
  ];
  if (args.releaseVersion) {
    lines.push(`Validated release: v${args.releaseVersion}.`);
  }
  lines.push(
    "",
    "Make the minimum code and manifest changes needed to resolve every issue below.",
    "After editing, run locally:",
    buildPluginValidateCommand(args.findings),
    "",
  );

  const appendFindings = (title: string, findings: PluginInspectorFinding[]) => {
    if (findings.length === 0) return;
    lines.push(`## ${title}`, "");
    for (const finding of findings) {
      const kind = finding.findingKind === "error" ? "Error" : "Warning";
      const categoryLabel = formatInspectorIssueClassLabel(finding.issueClass);
      const heading = [finding.code, categoryLabel, finding.severity].filter(Boolean).join(" · ");
      lines.push(`### ${heading}`);
      lines.push(`**${kind}:** ${formatValidationFindingMessage(finding.message)}`);
      if (finding.authorRemediation?.summary) {
        lines.push(`**How to fix:** ${finding.authorRemediation.summary}`);
      }
      if (finding.authorRemediation?.docsUrl) {
        lines.push(`**Docs:** ${finding.authorRemediation.docsUrl}`);
      }
      const metadataLine = [
        finding.version ? `Release v${finding.version}` : null,
        finding.targetOpenClawVersion ? `Target OpenClaw ${finding.targetOpenClawVersion}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (metadataLine) {
        lines.push(`**Context:** ${metadataLine}`);
      }
      if (finding.evidence && finding.evidence.length > 0) {
        lines.push("**Evidence:**");
        for (const entry of finding.evidence) {
          lines.push(`- ${entry}`);
        }
      }
      lines.push("");
    }
  };

  if (errors.length > 0) {
    appendFindings(`Errors (${errors.length}) — fix first`, errors);
  }
  if (warnings.length > 0) {
    appendFindings(`Warnings (${warnings.length})`, warnings);
  }

  lines.push("Confirm all findings are resolved before publishing a new release.");
  return lines.join("\n").trim();
}

function buildDevValidationFindingMocks(
  template: PluginInspectorFinding,
): PluginInspectorFinding[] {
  return [
    {
      ...template,
      code: "package-min-host-version-drift",
      findingKind: "warning",
      issueClass: "upstream-metadata",
      severity: "P2",
      message: "OpenClaw package minimum host version drifts from build target.",
      authorRemediation: {
        summary:
          "Set the package minimum host version to the OpenClaw version range the plugin was built and tested against.",
        docsUrl:
          "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#package-min-host-version-drift",
      },
      evidence: ["minHostVersion: >=2026.4.25", "buildOpenClawVersion: 2026.6.9"],
    },
    {
      ...template,
      code: "missing-expected-seam",
      findingKind: "warning",
      issueClass: "compatibility-warning",
      severity: "P3",
      message: "Plugin manifest does not declare the expected registration seam.",
      authorRemediation: {
        summary: "Export activate() and register capabilities through the current plugin API.",
        docsUrl: "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#missing-expected-seam",
      },
      evidence: ["manifest.extensions missing ./dist/index.js reference"],
    },
    {
      ...template,
      code: "package-plugin-api-compat-missing",
      findingKind: "error",
      issueClass: "compatibility-error",
      severity: "P0",
      message: "openclaw.compat.pluginApi is missing from package.json.",
      authorRemediation: {
        summary: "Add openclaw.compat.pluginApi with the minimum API version your plugin supports.",
        docsUrl:
          "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#package-plugin-api-compat-missing",
      },
      evidence: ['package.json has no "openclaw.compat.pluginApi" field'],
    },
  ];
}

function shouldShowDevValidationFindingMocks() {
  // Visual iteration only — remove before PR. Skips Vitest (`MODE === "test"`).
  return import.meta.env.DEV && import.meta.env.MODE === "development";
}

function shouldShowValidationPriorityBadge(severity?: string) {
  const priority = parseInspectorPriority(severity);
  return Boolean(severity) && priority <= 1;
}

function PluginValidationFindingCard({
  finding,
  compact = false,
}: {
  finding: PluginInspectorFinding;
  compact?: boolean;
}) {
  const kind = finding.findingKind ?? "warning";
  const categoryLabel = formatInspectorIssueClassLabel(finding.issueClass);
  const evidence = finding.evidence ?? [];
  const visibleEvidence = evidence.slice(0, 4);
  const hiddenEvidenceCount = Math.max(evidence.length - visibleEvidence.length, 0);
  const showPriorityBadge = shouldShowValidationPriorityBadge(finding.severity);
  const hasMetadata = Boolean(finding.version || finding.targetOpenClawVersion);

  const summaryCopy = (
    <div className="plugin-warning-item-lead">
      <span className={`plugin-warning-severity-dot is-${kind}`} aria-hidden="true" />
      <div className="plugin-warning-item-copy">
        <div className="plugin-warning-item-title-row">
          <p className="plugin-warning-item-message">
            {formatValidationFindingMessage(finding.message)}
          </p>
          {showPriorityBadge ? (
            <span className={`plugin-warning-priority-badge is-${kind}`}>{finding.severity}</span>
          ) : null}
          {compact ? (
            <ChevronRight
              className="plugin-warning-item-expand-chevron"
              size={14}
              aria-hidden="true"
            />
          ) : null}
        </div>
        <p className="plugin-warning-item-meta">
          <span className="plugin-warning-item-meta-text">
            {categoryLabel ? <span>{categoryLabel}</span> : null}
            {categoryLabel && finding.code ? (
              <span className="plugin-warning-item-meta-sep" aria-hidden="true">
                {" · "}
              </span>
            ) : null}
            {finding.code ? (
              <code className="plugin-warning-item-code" title={finding.code}>
                {finding.code}
              </code>
            ) : null}
          </span>
        </p>
      </div>
    </div>
  );

  const fixGuide = finding.authorRemediation?.summary ? (
    <div className="plugin-warning-fix-guide">
      <div className="plugin-warning-fix-guide-copy">
        <p className="plugin-warning-fix-guide-label">
          <Hammer size={14} aria-hidden="true" />
          How to fix
        </p>
        <p className="plugin-warning-fix-copy">{finding.authorRemediation.summary}</p>
      </div>
      {finding.authorRemediation.docsUrl ? (
        <a
          className="plugin-warning-fix-link"
          href={finding.authorRemediation.docsUrl}
          target="_blank"
          rel="noreferrer"
        >
          View fix guide ↗
        </a>
      ) : null}
    </div>
  ) : null;

  const metadata = hasMetadata ? (
    <dl className="plugin-warning-meta-group">
      {finding.version ? (
        <div className="plugin-warning-meta-field">
          <dt className="plugin-warning-meta-key">Release</dt>
          <dd className="plugin-warning-meta-value">v{finding.version}</dd>
        </div>
      ) : null}
      {finding.targetOpenClawVersion ? (
        <>
          <div className="plugin-warning-meta-field">
            <dt className="plugin-warning-meta-key">Target</dt>
            <dd className="plugin-warning-meta-value">OpenClaw {finding.targetOpenClawVersion}</dd>
          </div>
          <div className="plugin-warning-meta-field">
            <dt className="plugin-warning-meta-key">Reproduce</dt>
            <dd className="plugin-warning-meta-value">
              <code>{pluginValidateCommand(finding.targetOpenClawVersion)}</code>
            </dd>
          </div>
        </>
      ) : null}
    </dl>
  ) : null;

  const evidenceBlock =
    visibleEvidence.length > 0 ? (
      <div className="plugin-warning-evidence-block">
        <p className="plugin-warning-evidence-label">Technical evidence</p>
        {visibleEvidence.map((entry) => (
          <div className="plugin-warning-evidence-line" key={entry}>
            {entry}
          </div>
        ))}
        {hiddenEvidenceCount > 0 ? (
          <p className="plugin-warning-evidence-more">+{hiddenEvidenceCount} more</p>
        ) : null}
      </div>
    ) : null;

  const body = (
    <div className="plugin-warning-item-body">
      {fixGuide}
      {evidenceBlock}
      {metadata}
    </div>
  );

  const findingLabel = `${kind === "error" ? "Error" : "Warning"}: ${formatValidationFindingMessage(finding.message)}`;

  if (compact) {
    return (
      <details
        className={`plugin-warning-item plugin-warning-item-details is-${kind}`}
        aria-label={findingLabel}
      >
        <summary className="plugin-warning-item-summary">{summaryCopy}</summary>
        {body}
      </details>
    );
  }

  return (
    <article className={`plugin-warning-item is-${kind}`} aria-label={findingLabel}>
      <div className="plugin-warning-item-main">{summaryCopy}</div>
      {body}
    </article>
  );
}

function PluginDetailRoute() {
  const { name } = Route.useParams();
  const loaderData = Route.useLoaderData() as PluginDetailLoaderData;
  return <PluginDetailPage name={name} loaderData={loaderData} />;
}

export function PluginDetailPending() {
  return (
    <main className="catalog-detail-page plugin-detail-page" aria-busy="true">
      <div
        className="catalog-detail plugin-catalog-loading"
        role="status"
        aria-label="Loading plugin details"
      >
        <div aria-hidden="true" className="catalog-detail__breadcrumb">
          <span className="plugin-catalog-loading__crumb" />
        </div>
        <div aria-hidden="true" className="catalog-detail__hero">
          <span className="catalog-detail__icon" />
          <div className="catalog-detail__heading">
            <span className="plugin-catalog-loading__title" />
            <span className="plugin-catalog-loading__publisher" />
          </div>
        </div>
        <div className="catalog-detail__content" aria-hidden="true">
          <div className="catalog-detail__main">
            <span className="plugin-catalog-loading__card" />
            <span className="plugin-catalog-loading__card" />
          </div>
          <div className="catalog-detail__sidebar">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="plugin-catalog-loading__fact" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

export function PluginNotFound() {
  return (
    <main className="py-10">
      <Container size="narrow">
        <EmptyState
          title="Plugin not found"
          description="This plugin does not exist or has been removed."
        />
      </Container>
    </main>
  );
}

type PluginDetailPageProps = {
  name: string;
  loaderData: PluginDetailLoaderData;
  pendingNotice?: ReactNode;
};

export function PluginDetailPage(props: PluginDetailPageProps) {
  return (
    <PluginDetailPageContent key={props.loaderData.detail.package?.name ?? props.name} {...props} />
  );
}

function PluginDetailPageContent({ name, loaderData, pendingNotice }: PluginDetailPageProps) {
  const { detail, version, versions, readme, rateLimited } = loaderData;
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { me } = useAuthStatus();
  const [activeTab, setActiveTab] = useState<PluginDetailTab | null>(null);
  const [loadedVersions, setLoadedVersions] = useState(versions);
  const isNestedPluginRoute =
    pathname.includes("/security/") || pathname.endsWith("/security-audit");
  const manageCandidateNames = getOpenClawPackageCandidateNames(name);
  const manageLookupName = detail.package?.name ?? manageCandidateNames[0] ?? name;
  const manageContext = useQuery(
    api.packages.getManageContext,
    me && !isNestedPluginRoute && detail.package
      ? { name: manageLookupName, candidateNames: manageCandidateNames }
      : "skip",
  );
  const canDeleteVersions = useQuery(
    api.packages.canDeleteVersions,
    me && !isNestedPluginRoute && detail.package && activeTab === "versions"
      ? { name: manageLookupName, candidateNames: manageCandidateNames }
      : "skip",
  );
  // A peripheral inspection subscription must not erase the detail page or its
  // independently authorized owner controls when that query times out.
  const validationSummaryName = detail.package?.name;
  const validationSummaryQueries = useMemo<RequestForQueries>(() => {
    const queries: RequestForQueries = {};
    if (validationSummaryName) {
      queries.validationSummary = {
        query: api.packages.getPackageInspectorValidationSummaryPublic,
        args: { name: validationSummaryName },
      };
    }
    return queries;
  }, [validationSummaryName]);
  const validationSummaryResult = useQueries(validationSummaryQueries).validationSummary as
    | PluginInspectorValidationSummary
    | Error
    | undefined;
  const validationSummaryUnavailable = validationSummaryResult instanceof Error;
  const activityTrendEndDay = getActivityTrendEndDay();
  const { trend: activityTrend, loading: activityTrendLoading } = useDeferredPackageActivityTrend(
    activeTab === "activity" && detail.package
      ? { name: detail.package.name, endDay: activityTrendEndDay }
      : null,
  );
  const downloadsMetricBlock = useDownloadsSidebarMetricBlock({
    allTimeDownloads: detail.package?.stats?.downloads ?? 0,
    activityTrend: activityTrend?.downloads,
    loading: activityTrendLoading,
  });
  const inspectorFindings = useQuery(
    api.packages.listPackageInspectorWarningsForManager,
    manageContext ? { name: manageContext.package.name, limit: 100 } : "skip",
  ) as PluginInspectorFinding[] | undefined;
  const authorInspectorFindings = Array.isArray(inspectorFindings)
    ? inspectorFindings.filter(
        (finding) => finding.authorRemediation?.summary && !pluginApiRetirement(finding),
      )
    : undefined;
  const displayInspectorFindings =
    authorInspectorFindings && shouldShowDevValidationFindingMocks()
      ? [...authorInspectorFindings, ...buildDevValidationFindingMocks(authorInspectorFindings[0])]
      : authorInspectorFindings;
  const owner = detail.owner;
  const heroCreatorPublisher = useHeroCreatorPublisher({
    owner,
    packageOfficial: detail.package?.isOfficial === true,
  });
  const [isCatalogMetadataDialogOpen, setIsCatalogMetadataDialogOpen] = useState(false);
  const setCatalogMetadata = useMutation(api.packages.setPackageCatalogMetadata);
  useEffect(() => {
    const syncTabFromHash = () => {
      const hash = window.location.hash;
      setActiveTab(pluginDetailTabFromHash(hash));
      // Previous listings accepted both spellings before MCP servers became an inline section.
      if (hash === "#mcpServers") document.getElementById("mcp-servers")?.scrollIntoView();
    };
    window.addEventListener("hashchange", syncTabFromHash);
    syncTabFromHash();
    return () => window.removeEventListener("hashchange", syncTabFromHash);
  }, []);
  useEffect(() => {
    const packageName = detail.package?.name;
    if (activeTab !== "versions" || loadedVersions !== undefined || !packageName) return undefined;

    const controller = new AbortController();
    let stale = false;
    void fetchPackageVersions(packageName, {
      limit: PLUGIN_VERSIONS_PAGE_SIZE,
      signal: controller.signal,
    })
      .then((result) => {
        if (!stale) setLoadedVersions(result);
      })
      .catch(() => {
        if (!stale && !controller.signal.aborted) setLoadedVersions(null);
      });

    return () => {
      stale = true;
      controller.abort();
    };
  }, [activeTab, detail.package?.name, loadedVersions]);
  if (isNestedPluginRoute) {
    return <Outlet />;
  }

  if (rateLimited?.scope === "detail") {
    return (
      <main className="py-10">
        <Container size="narrow">
          <EmptyState
            icon={AlertTriangle}
            title="Plugin details are temporarily unavailable"
            description={`The public plugin API is rate-limited right now. Try again ${formatRetryDelay(
              rateLimited.retryAfterSeconds,
            )}.`}
            action={{
              label: "Try again",
              onClick: () => window.location.reload(),
            }}
          />
        </Container>
      </main>
    );
  }

  if (!detail.package) {
    return <PluginNotFound />;
  }

  const pkg = detail.package;
  const title = presentationTitle(pkg.displayName, pkg.name);
  const publisherHandle = (heroCreatorPublisher?.handle ?? pkg.ownerHandle)?.replace(/^@+/, "");
  const latestRelease = version?.version ?? null;
  const isDownloadBlocked =
    pkg.scanStatus === "malicious" || latestRelease?.verification?.scanStatus === "malicious";
  const skillInstallOwner = owner?.handle ?? pkg.ownerHandle ?? "owner";
  const isPlugin = pkg.family === "code-plugin" || pkg.family === "bundle-plugin";
  const installTarget = isPlugin
    ? pkg.name
    : `@${skillInstallOwner.replace(/^@+/, "")}/${pkg.name}`;
  // Keep unscoped targets distinct from bundled plugin IDs such as `discord`.
  // The explicit source below also supports released clients that default to npm.
  const cliInstallTarget =
    isPlugin && !installTarget.includes("/") ? `${installTarget}@latest` : installTarget;
  const installCommand = `openclaw ${isPlugin ? "plugins" : "skills"} install ${isPlugin ? "clawhub:" : ""}${cliInstallTarget}`;
  const installCommandCard = (
    <InstallCommandCard
      cliCommand={installCommand}
      prompt={formatOpenClawPrompt(installTarget, isPlugin ? "package" : "skill")}
      cliCopyAriaLabel={isPlugin ? "Copy plugin install command" : "Copy skill install command"}
      desktopInstall={
        isPlugin && pkg.latestVersion && !isDownloadBlocked
          ? { family: "plugins", name: pkg.name }
          : undefined
      }
    />
  );

  const compatibility = latestRelease?.compatibility ?? pkg.compatibility;
  const pluginManifestSummary = latestRelease?.pluginManifestSummary ?? null;
  const verification = latestRelease?.verification ?? pkg.verification;
  const readmeAssetBaseUrl = buildReadmeAssetBaseUrl(
    verification?.sourceRepo,
    verification?.sourceCommit,
    verification?.sourcePath,
  );
  const artifact = latestRelease?.artifact ?? pkg.artifact ?? null;
  const downloadPath =
    pkg.latestVersion && latestRelease?.version && artifact?.kind === "npm-pack"
      ? getPackageArtifactDownloadPath(pkg.name, latestRelease.version)
      : getPackageDownloadPath(pkg.name, pkg.latestVersion);
  const newVersionHref = manageContext
    ? `/plugins/publish?${new URLSearchParams({
        ...(owner?.handle ? { ownerHandle: owner.handle } : {}),
        name: pkg.name,
        displayName: pkg.displayName,
      }).toString()}`
    : null;
  const compatEntries = compatibility
    ? Object.entries(compatibility).filter(([, v]) => v !== undefined && v !== null)
    : [];
  const manifestPluginApiRange = pluginManifestSummary?.compatibility?.pluginApiRange;
  const versionsPanel = (hidden: boolean) => (
    <PluginVersionsPanel
      packageName={pkg.name}
      versions={loadedVersions}
      latestVersion={pkg.latestVersion ?? null}
      canDeleteVersions={canDeleteVersions === true}
      onVersionDeleted={() => router.invalidate()}
      onRetry={() => setLoadedVersions(undefined)}
      panelId="plugin-tabpanel-versions"
      labelledBy="plugin-tab-versions"
      hidden={hidden}
    />
  );
  const compatibilityPanel =
    compatEntries.length > 0 || artifact || manifestPluginApiRange ? (
      <div className="plugin-tab-panel">
        <dl className="plugin-kv-grid">
          {manifestPluginApiRange ? (
            <PluginKvRow label="OpenClaw plugin API" icon={Braces} mono>
              {manifestPluginApiRange}
            </PluginKvRow>
          ) : null}
          {artifact ? (
            <>
              <PluginKvRow label="Artifact" icon={Package}>
                {artifact.kind === "npm-pack" ? "ClawPack" : "Legacy ZIP"}
              </PluginKvRow>
              {artifact.kind === "legacy-zip" ? (
                <PluginKvRow label="Compatibility note" icon={Info}>
                  This plugin uses the legacy ZIP path and may have compatibility issues until the
                  publisher uploads a ClawPack.
                </PluginKvRow>
              ) : null}
              {artifact.kind === "npm-pack" && artifact.npmTarballName ? (
                <PluginKvRow label="Tarball" icon={FileArchive} mono>
                  {artifact.npmTarballName}
                </PluginKvRow>
              ) : null}
              {artifact.kind === "npm-pack" && formatArtifactSize(artifact.size) ? (
                <PluginKvRow label="Size" icon={HardDrive}>
                  {formatArtifactSize(artifact.size)}
                </PluginKvRow>
              ) : null}
              {artifact.kind === "npm-pack" && typeof artifact.npmFileCount === "number" ? (
                <PluginKvRow label="Files" icon={Files}>
                  {artifact.npmFileCount}
                </PluginKvRow>
              ) : null}
              {artifact.kind === "npm-pack" && artifact.npmIntegrity ? (
                <PluginKvRow label="Integrity" icon={Fingerprint} hash>
                  {artifact.npmIntegrity}
                </PluginKvRow>
              ) : null}
            </>
          ) : null}
          {compatEntries.map(([key, value]) => (
            <PluginKvRow
              key={key}
              label={formatCompatibilityLabel(key)}
              icon={compatibilityFieldIcon(key)}
              mono
            >
              {value}
            </PluginKvRow>
          ))}
        </dl>
      </div>
    ) : null;
  const configurationPanel =
    pluginManifestSummary && pluginManifestSummary.configFields.length > 0 ? (
      <PluginManifestConfigurationPanel fields={pluginManifestSummary.configFields} />
    ) : null;
  const validationAvailabilityAlert = validationSummaryUnavailable ? (
    <Alert variant="warn" className="plugin-validation-alert">
      <AlertTriangle size={16} aria-hidden="true" />
      <AlertDescription>
        Compatibility details are temporarily unavailable. Please try again later.
      </AlertDescription>
    </Alert>
  ) : null;
  const validationErrors = (
    displayInspectorFindings?.filter((finding) => finding.findingKind === "error") ?? []
  ).sort(compareInspectorFindings);
  const validationWarnings = (
    displayInspectorFindings?.filter((finding) => finding.findingKind !== "error") ?? []
  ).sort(compareInspectorFindings);
  const validationIssueCount = validationErrors.length + validationWarnings.length;
  const validationCliCommand = buildPluginValidateCommand(displayInspectorFindings ?? []);
  const validationReleaseVersion = latestRelease?.version ?? pkg.latestVersion ?? null;
  const showValidationGroups = validationErrors.length > 0 && validationWarnings.length > 0;
  const validationAgentFixPrompt =
    authorInspectorFindings && authorInspectorFindings.length > 0
      ? buildValidationAgentFixPrompt({
          packageName: pkg.name,
          releaseVersion: latestRelease?.version ?? pkg.latestVersion ?? null,
          findings: authorInspectorFindings,
        })
      : null;
  const compactFindingCards = (displayInspectorFindings?.length ?? 0) > 1;
  const validationPanel =
    displayInspectorFindings && displayInspectorFindings.length > 0 ? (
      <section
        id="validation"
        className="plugin-validation-panel"
        aria-labelledby="validation-heading"
      >
        <header className="plugin-validation-overview">
          <div className="plugin-validation-panel-title-row">
            <h2 id="validation-heading" className="plugin-validation-panel-title">
              Validation
            </h2>
            <div className="plugin-validation-panel-title-actions">
              <span className="plugin-validation-panel-stats" aria-label="Validation summary">
                <span
                  className={
                    validationErrors.length > 0
                      ? "plugin-validation-panel-stat"
                      : "plugin-validation-panel-stat is-muted"
                  }
                >
                  {validationErrors.length} {validationErrors.length === 1 ? "error" : "errors"}
                </span>
                <span className="plugin-validation-panel-stats-sep" aria-hidden="true">
                  ·
                </span>
                <span
                  className={
                    validationWarnings.length > 0
                      ? "plugin-validation-panel-stat"
                      : "plugin-validation-panel-stat is-muted"
                  }
                >
                  {validationWarnings.length}{" "}
                  {validationWarnings.length === 1 ? "warning" : "warnings"}
                </span>
              </span>
            </div>
          </div>
          {validationIssueCount > 0 ? (
            <p className="plugin-validation-summary-hint">
              <ValidationSummaryHint
                issueCount={validationIssueCount}
                packageName={pkg.name}
                version={validationReleaseVersion}
              />
            </p>
          ) : null}
          <div className="plugin-validation-actions" role="toolbar" aria-label="Validation actions">
            <div className="plugin-validation-actions-row">
              <div className="plugin-validation-command-block">
                <span id="validation-toolbar-label" className="plugin-validation-toolbar-label">
                  {PLUGIN_VALIDATE_TOOLBAR_LABEL}
                </span>
                <div className="plugin-validation-toolbar">
                  <div
                    id="validation-toolbar-cli"
                    className="plugin-validation-toolbar-cli"
                    aria-labelledby="validation-toolbar-label"
                  >
                    <code className="plugin-validation-command">{validationCliCommand}</code>
                    <InstallCopyButton
                      text={validationCliCommand}
                      ariaLabel="Copy validate command"
                      showLabel={false}
                      className="plugin-validation-toolbar-copy"
                    />
                  </div>
                </div>
              </div>
              {validationAgentFixPrompt ? (
                <div className="plugin-validation-toolbar-agent">
                  <InstallCopyButton
                    text={validationAgentFixPrompt}
                    label="Copy instructions"
                    tooltip="Paste into your coding agent to fix these findings."
                    ariaLabel="Copy fix instructions"
                    className="plugin-validation-panel-agent"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <section className="plugin-validation-panel-findings" aria-label="Issues to review">
          {validationErrors.length > 0 ? (
            <div className="plugin-validation-findings-group is-error">
              {showValidationGroups ? (
                <h4 className="plugin-validation-group-label is-error">
                  Errors ({validationErrors.length})
                </h4>
              ) : null}
              <div className="plugin-warning-list">
                {validationErrors.map((finding) => (
                  <PluginValidationFindingCard
                    key={`${finding.version}:${finding.code}:${finding.message}`}
                    finding={finding}
                    compact={compactFindingCards}
                  />
                ))}
              </div>
            </div>
          ) : null}
          {validationWarnings.length > 0 ? (
            <div className="plugin-validation-findings-group is-warning">
              {showValidationGroups ? (
                <h4 className="plugin-validation-group-label is-warning">
                  Warnings ({validationWarnings.length})
                </h4>
              ) : null}
              <div className="plugin-warning-list">
                {validationWarnings.map((finding) => (
                  <PluginValidationFindingCard
                    key={`${finding.version}:${finding.code}:${finding.message}`}
                    finding={finding}
                    compact={compactFindingCards}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </section>
    ) : null;
  const selectTab = (tab: PluginDetailTab | null) => {
    setActiveTab(tab);
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search + (tab ? "#" + tab : ""),
    );
  };
  const activityPanel = (
    <SidebarMetadata
      ariaLabel="Package activity"
      blocks={[downloadsMetricBlock, { label: "Type", value: familyLabel(pkg.family) }]}
    />
  );

  return (
    <main className="catalog-detail-page plugin-detail-page">
      <CatalogDetailLayout
        className={
          pkg.isOfficial && pkg.icon
            ? "plugin-catalog-page plugin-catalog-page--official-art"
            : "plugin-catalog-page"
        }
        breadcrumb={
          <CatalogDetailBreadcrumb
            href={isPlugin ? "/plugins" : "/skills"}
            label={isPlugin ? "Plugins" : "Skills"}
            current={title}
          />
        }
        icon={
          <MarketplaceIcon
            kind={isPlugin ? "plugin" : "skill"}
            label={title}
            imageUrl={pkg.icon}
            publisherImageUrl={owner?.image}
            tone="muted"
          />
        }
        title={title}
        publisher={
          heroCreatorPublisher || publisherHandle ? (
            <>
              {heroCreatorPublisher?.displayName ? (
                <strong>{heroCreatorPublisher.displayName}</strong>
              ) : null}
              {heroCreatorPublisher?.official ? <OfficialBadge iconOnly size={16} /> : null}
              {publisherHandle ? (
                <a
                  href={buildPublisherProfileHref(publisherHandle)}
                  data-analytics-public-detail=""
                >
                  @{publisherHandle}
                </a>
              ) : null}
            </>
          ) : undefined
        }
        actions={
          <>
            {newVersionHref ? (
              <a className="plugin-catalog-action" href={newVersionHref}>
                <Upload size={14} aria-hidden="true" />
                New version
              </a>
            ) : null}
            <PluginPackageDetails
              downloadHref={pkg.latestVersion && !isDownloadBlocked ? downloadPath : null}
              name={title}
              activeTab={activeTab}
              onTab={selectTab}
              activity={activityPanel}
              configuration={configurationPanel}
              compatibility={compatibilityPanel}
              versionsPanel={versionsPanel}
            />
            {isPlugin ? (
              <Dialog>
                <DialogTrigger asChild>
                  <button
                    className="plugin-catalog-action plugin-catalog-action--primary"
                    type="button"
                    disabled={isDownloadBlocked}
                    aria-describedby={isDownloadBlocked ? "plugin-blocked-notice" : undefined}
                  >
                    Install
                  </button>
                </DialogTrigger>
                {!isDownloadBlocked ? (
                  <DialogContent className="plugin-install-dialog">
                    <DialogHeader>
                      <DialogTitle>Install {title}</DialogTitle>
                      <DialogDescription>Choose an install method.</DialogDescription>
                    </DialogHeader>
                    {installCommandCard}
                  </DialogContent>
                ) : null}
              </Dialog>
            ) : null}
          </>
        }
        summary={
          pkg.summary ? (
            <p data-analytics-public-detail="">
              <InlineMarkdownSummary>{pkg.summary}</InlineMarkdownSummary>
            </p>
          ) : undefined
        }
        sidebar={
          <PluginCatalogRail
            pkg={pkg}
            release={latestRelease}
            ownerHandle={owner?.handle}
            onEditTopics={manageContext ? () => setIsCatalogMetadataDialogOpen(true) : undefined}
          />
        }
      >
        {pendingNotice}
        {!isDownloadBlocked &&
          (!isPlugin ? (
            installCommandCard
          ) : (
            <noscript>
              <p>Install via CLI:</p>
              <pre>
                <code>{installCommand}</code>
              </pre>
              {pkg.latestVersion ? <a href={downloadPath}>Download</a> : null}
            </noscript>
          ))}
        {isDownloadBlocked ? (
          <div id="plugin-blocked-notice" role="status">
            <Badge variant="destructive">Download blocked</Badge>
          </div>
        ) : null}
        {rateLimited?.scope === "metadata" ? (
          <div role="status">
            <Badge variant="compact">Some metadata is temporarily unavailable</Badge>
          </div>
        ) : null}
        {validationAvailabilityAlert}
        {validationPanel}
        <PluginCatalogOverview
          manifest={pluginManifestSummary}
          packageName={pkg.name}
          version={latestRelease?.version ?? pkg.latestVersion ?? null}
          readme={readme}
          readmeAssetBaseUrl={readmeAssetBaseUrl}
        />
      </CatalogDetailLayout>
      {manageContext ? (
        <Dialog open={isCatalogMetadataDialogOpen} onOpenChange={setIsCatalogMetadataDialogOpen}>
          <DialogContent className="plugin-catalog-metadata-dialog">
            <DialogHeader>
              <DialogTitle>Edit plugin topics</DialogTitle>
              <DialogDescription>Add topics to make this plugin easier to find.</DialogDescription>
            </DialogHeader>
            <CatalogMetadataEditor
              kind="plugin"
              showCategories={false}
              categories={manageContext.package.categories}
              suggestedCategories={manageContext.suggestedCategories}
              topics={manageContext.package.topics}
              onSave={async (value) => {
                await setCatalogMetadata({
                  packageId: manageContext.package._id,
                  topics: value.topics,
                });
                toast.success("Catalog metadata updated.");
                setIsCatalogMetadataDialogOpen(false);
                await router.invalidate();
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </main>
  );
}
