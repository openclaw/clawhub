import {
  createFileRoute,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Braces,
  ChevronRight,
  Download,
  FileArchive,
  Files,
  Fingerprint,
  Hammer,
  HardDrive,
  Info,
  Package,
  Plus,
  Server,
  Sparkles,
  Tag,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { CatalogMetadataEditor } from "../../components/CatalogMetadataEditor";
import {
  DetailHero,
  DETAIL_HERO_TOPIC_LIMIT,
  DetailPageShell,
} from "../../components/DetailPageShell";
import {
  DetailSecuritySummary,
  DetailSecuritySummaryLabel,
} from "../../components/DetailSecuritySummary";
import { useDownloadsSidebarMetricBlock } from "../../components/DownloadsMetricCard";
import { EmptyState } from "../../components/EmptyState";
import { InlineCodeSummary } from "../../components/InlineCodeSummary";
import { InstallCopyButton } from "../../components/InstallCopyButton";
import { Container } from "../../components/layout/Container";
import { MarkdownPreview } from "../../components/MarkdownPreview";
import {
  PLUGIN_VERSIONS_PAGE_SIZE,
  PluginVersionsPanel,
} from "../../components/PluginVersionsPanel";
import { SidebarMetadata } from "../../components/SidebarMetadata";
import { SkillDetailSkeleton } from "../../components/skeletons/SkillDetailSkeleton";
import { OpenClawCliInstallCommand } from "../../components/SkillInstallSurface";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { UserBadge } from "../../components/UserBadge";
import { getActivityTrendEndDay } from "../../lib/activityTrend";
import { BrowseCategoryIcon } from "../../lib/browseCategoryIcons";
import {
  buildPluginCategoryBrowseHref,
  buildPluginTopicBrowseHref,
  formatCatalogTopicLabel,
  PLUGIN_CATEGORIES,
  resolvePluginBrowseCategorySlug,
} from "../../lib/categories";
import { formatRetryDelay } from "../../lib/formatRetryDelay";
import { buildPluginMeta } from "../../lib/og";
import { getOpenClawPackageCandidateNames } from "../../lib/openClawExtensionSlugs";
import { buildPublisherProfileHref } from "../../lib/ownerRoute";
import {
  fetchPackageDetail,
  fetchPackageFile,
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
  displayPluginPackageName,
  parseScopedPackageName,
} from "../../lib/pluginRoutes";
import { buildReadmeAssetBaseUrl } from "../../lib/readmeAssetBaseUrl";
import { timeAgo } from "../../lib/timeAgo";
import { useAuthStatus } from "../../lib/useAuthStatus";
import { useDeferredPackageActivityTrend } from "../../lib/useDeferredActivityTrend";
import { useHeroCreatorPublisher } from "../../lib/useHeroCreatorPublisher";
import { useMediaQuery } from "../../lib/useMediaQuery";

type PluginDetailRateLimitState = {
  scope: "detail" | "metadata";
  retryAfterSeconds: number | null;
} | null;

type PluginDetailTab =
  | "readme"
  | "versions"
  | "compatibility"
  | "configuration"
  | "mcpServers"
  | "skills";

type PluginInspectorFinding = {
  packageName: string;
  version: string;
  findingKind?: "warning" | "error";
  code: string;
  severity?: string;
  level?: string;
  issueClass?: string;
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
  findingCount: number;
  errorCount: number;
  warningCount: number;
  incompatibleAfterOpenClawVersion: string | null;
};

export type PluginDetailLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
  versions: Awaited<ReturnType<typeof fetchPackageVersions>> | null;
  readme: string | null;
  rateLimited: PluginDetailRateLimitState;
};

export async function loadPluginDetail(requestedName: string): Promise<PluginDetailLoaderData> {
  const candidateNames = getOpenClawPackageCandidateNames(requestedName);

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
          versions: null,
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
    return { detail, version: null, versions: null, readme: null, rateLimited: null };
  }

  try {
    const [version, versions, readme] = await Promise.all([
      detail.package.latestVersion
        ? fetchPackageVersion(resolvedName, detail.package.latestVersion)
        : Promise.resolve(null),
      fetchPackageVersions(resolvedName, { limit: PLUGIN_VERSIONS_PAGE_SIZE }).catch(() => null),
      fetchPackageReadme(resolvedName),
    ]);

    return { detail, version, versions, readme, rateLimited: null };
  } catch (error) {
    if (isRateLimitedPackageApiError(error)) {
      return {
        detail,
        version: null,
        versions: null,
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
  return {
    meta: [
      { title: meta.title },
      { name: "description", content: meta.description },
      { property: "og:title", content: meta.title },
      { property: "og:description", content: meta.description },
      { property: "og:url", content: meta.url },
      { property: "og:image", content: meta.image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: meta.title },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: meta.title },
      { name: "twitter:description", content: meta.description },
      { name: "twitter:image", content: meta.image },
    ],
    links: [{ rel: "canonical", href: meta.url }],
  };
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

function pluginDetailTabFromHash(hashValue: string): PluginDetailTab {
  const hash = hashValue.replace("#", "");
  if (hash === "warnings" || hash === "validation") return "readme";
  if (hash === "verification") return "compatibility";
  if (hash === "mcp-servers" || hash === "mcpServers") return "mcpServers";
  return hash === "versions" ||
    hash === "compatibility" ||
    hash === "configuration" ||
    hash === "skills"
    ? hash
    : "readme";
}

const PLUGIN_README_COLLAPSED_LINE_COUNT = 50;

function PluginDetailTabs({
  activeTab,
  setActiveTab,
  readme,
  readmeAssetBaseUrl,
  versionsPanel,
  compatibilityPanel,
  configurationPanel,
  mcpServersPanel,
  skillsPanel,
}: {
  activeTab: PluginDetailTab;
  setActiveTab: (tab: PluginDetailTab) => void;
  readme: string | null;
  readmeAssetBaseUrl?: string;
  versionsPanel: (hidden: boolean) => ReactNode;
  compatibilityPanel: ReactNode | null;
  configurationPanel: ReactNode | null;
  mcpServersPanel: ReactNode | null;
  skillsPanel: ReactNode | null;
}) {
  const [hasMountedVersions, setHasMountedVersions] = useState(activeTab === "versions");
  const [isReadmeExpanded, setIsReadmeExpanded] = useState(false);
  const readmeLineCount = useMemo(() => readme?.split(/\r\n|\n|\r/).length ?? 0, [readme]);
  const isReadmeLong = readmeLineCount > PLUGIN_README_COLLAPSED_LINE_COUNT;

  useEffect(() => {
    setIsReadmeExpanded(false);
  }, [readme]);
  const selectTab = (tab: PluginDetailTab) => {
    const scrollPosition =
      typeof window === "undefined" ? null : { left: window.scrollX, top: window.scrollY };
    setActiveTab(tab);
    if (typeof window === "undefined") return;
    const hash = tab === "readme" ? "" : tab === "mcpServers" ? "#mcp-servers" : `#${tab}`;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
    window.requestAnimationFrame(() => {
      if (!scrollPosition) return;
      window.scrollTo(scrollPosition.left, scrollPosition.top);
    });
  };

  const effectiveActiveTab =
    activeTab === "versions"
      ? "versions"
      : activeTab === "compatibility" && compatibilityPanel
        ? "compatibility"
        : activeTab === "configuration" && configurationPanel
          ? "configuration"
          : activeTab === "mcpServers" && mcpServersPanel
            ? "mcpServers"
            : activeTab === "skills" && skillsPanel
              ? "skills"
              : "readme";
  useEffect(() => {
    if (effectiveActiveTab === "versions") setHasMountedVersions(true);
  }, [effectiveActiveTab]);
  const readmePanel = readme ? (
    <>
      <div
        className={`skill-readme-preview${
          isReadmeLong && !isReadmeExpanded ? " is-collapsed" : ""
        }`}
      >
        <MarkdownPreview assetBaseUrl={readmeAssetBaseUrl}>{readme}</MarkdownPreview>
      </div>
      {isReadmeLong ? (
        <button
          type="button"
          className="skill-readme-toggle"
          aria-expanded={isReadmeExpanded}
          onClick={() => setIsReadmeExpanded((expanded) => !expanded)}
        >
          {isReadmeExpanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </>
  ) : (
    <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
      <p className="empty-state-title">No README available</p>
      <p className="empty-state-body">This plugin doesn't have a README yet.</p>
    </div>
  );
  const activePanel =
    effectiveActiveTab === "compatibility" && compatibilityPanel
      ? compatibilityPanel
      : effectiveActiveTab === "configuration" && configurationPanel
        ? configurationPanel
        : effectiveActiveTab === "mcpServers" && mcpServersPanel
          ? mcpServersPanel
          : effectiveActiveTab === "skills" && skillsPanel
            ? skillsPanel
            : readmePanel;

  return (
    <div className="tab-card detail-mobile-tabs">
      <div className="tab-header" role="tablist" aria-label="Plugin detail tabs">
        <button
          id="plugin-tab-readme"
          className={`tab-button${effectiveActiveTab === "readme" ? " is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={effectiveActiveTab === "readme"}
          aria-controls="plugin-tabpanel-readme"
          onClick={() => selectTab("readme")}
        >
          README.md
        </button>
        {skillsPanel ? (
          <button
            id="plugin-tab-skills"
            className={`tab-button${effectiveActiveTab === "skills" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={effectiveActiveTab === "skills"}
            aria-controls="plugin-tabpanel-skills"
            onClick={() => selectTab("skills")}
          >
            Skills
          </button>
        ) : null}
        {mcpServersPanel ? (
          <button
            id="plugin-tab-mcpServers"
            className={`tab-button${effectiveActiveTab === "mcpServers" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={effectiveActiveTab === "mcpServers"}
            aria-controls="plugin-tabpanel-mcpServers"
            onClick={() => selectTab("mcpServers")}
          >
            MCP Servers
          </button>
        ) : null}
        {configurationPanel ? (
          <button
            id="plugin-tab-configuration"
            className={`tab-button${effectiveActiveTab === "configuration" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={effectiveActiveTab === "configuration"}
            aria-controls="plugin-tabpanel-configuration"
            onClick={() => selectTab("configuration")}
          >
            Configuration
          </button>
        ) : null}
        {compatibilityPanel ? (
          <button
            id="plugin-tab-compatibility"
            className={`tab-button${effectiveActiveTab === "compatibility" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={effectiveActiveTab === "compatibility"}
            aria-controls="plugin-tabpanel-compatibility"
            onClick={() => selectTab("compatibility")}
          >
            Compatibility
          </button>
        ) : null}
        <button
          id="plugin-tab-versions"
          className={`tab-button${effectiveActiveTab === "versions" ? " is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={effectiveActiveTab === "versions"}
          aria-controls="plugin-tabpanel-versions"
          onClick={() => selectTab("versions")}
        >
          Versions
        </button>
      </div>
      {effectiveActiveTab !== "versions" ? (
        <div
          className={`tab-body${effectiveActiveTab === "readme" ? " skill-readme-body" : ""}`}
          role="tabpanel"
          id={`plugin-tabpanel-${effectiveActiveTab}`}
          aria-labelledby={`plugin-tab-${effectiveActiveTab}`}
        >
          {activePanel}
        </div>
      ) : null}
      {hasMountedVersions || effectiveActiveTab === "versions"
        ? versionsPanel(effectiveActiveTab !== "versions")
        : null}
    </div>
  );
}

type PluginManifestSummary = NonNullable<
  NonNullable<PackageVersionDetail["version"]>["pluginManifestSummary"]
>;
type BundledPluginSkill = PluginManifestSummary["bundledSkills"][number];
type PluginConfigField = PluginManifestSummary["configFields"][number];
type PluginMcpServer = PluginManifestSummary["mcpServers"][number];

type PluginKvRowProps = {
  label: string;
  icon?: LucideIcon;
  mono?: boolean;
  hash?: boolean;
  children: ReactNode;
};

function GitHubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18.92-.26 1.9-.38 2.88-.39.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

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

function PluginManifestMcpServersPanel({ servers }: { servers: PluginMcpServer[] }) {
  return (
    <div className="plugin-manifest-capabilities">
      <section className="plugin-manifest-section">
        <div className="plugin-manifest-chip-list">
          {servers.map((server) => (
            <Badge key={server.name} variant="compact">
              {server.name}
            </Badge>
          ))}
        </div>
      </section>
    </div>
  );
}

function PluginManifestSkillsPanel({
  packageName,
  version,
  skills,
}: {
  packageName: string;
  version: string | null;
  skills: BundledPluginSkill[];
}) {
  const [previewSkill, setPreviewSkill] = useState<BundledPluginSkill | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  async function openSkillPreview(skill: BundledPluginSkill) {
    setPreviewSkill(skill);
    setPreviewContent(null);
    setPreviewError(null);
    setIsPreviewLoading(true);
    try {
      const content = await fetchPackageFile(packageName, skill.skillMdPath, version);
      setPreviewContent(content ?? "Skill markdown is unavailable.");
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Failed to load skill markdown.");
    } finally {
      setIsPreviewLoading(false);
    }
  }

  return (
    <div className="plugin-manifest-capabilities">
      <section className="plugin-manifest-section">
        <div className="plugin-manifest-list">
          {skills.map((skill) => (
            <article key={skill.skillMdPath} className="plugin-manifest-row">
              <div className="plugin-manifest-row-main">
                <code>{skill.name}</code>
                {skill.description ? <p>{skill.description}</p> : null}
                <span>{skill.rootPath}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void openSkillPreview(skill)}
                aria-label={`Preview ${skill.name}`}
              >
                Preview
              </Button>
            </article>
          ))}
        </div>
      </section>
      <Dialog open={Boolean(previewSkill)} onOpenChange={(open) => !open && setPreviewSkill(null)}>
        <DialogContent className="max-h-[85vh] max-w-[min(920px,92vw)] overflow-auto">
          <DialogHeader>
            <DialogTitle>{previewSkill?.name ?? "Bundled skill"}</DialogTitle>
            <DialogDescription>{previewSkill?.skillMdPath}</DialogDescription>
          </DialogHeader>
          {isPreviewLoading ? (
            <div className="stat">Loading skill markdown...</div>
          ) : previewError ? (
            <div className="stat">Failed to load skill markdown: {previewError}</div>
          ) : previewContent ? (
            <MarkdownPreview>{previewContent}</MarkdownPreview>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const PLUGIN_VALIDATE_CLI = "clawhub package validate <path-to-plugin>";
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
      Hey, we found <strong>{issueLabel}</strong> with {versionLabel} of{" "}
      <strong>{packageName}</strong>. Review the findings below, apply the fix, and upload a new
      version.
    </>
  );
}

function formatValidationFindingMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;
  const normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return normalized.endsWith(".") ? normalized : `${normalized}.`;
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
    PLUGIN_VALIDATE_CLI,
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
        <div className="plugin-warning-meta-field">
          <dt className="plugin-warning-meta-key">Target</dt>
          <dd className="plugin-warning-meta-value">OpenClaw {finding.targetOpenClawVersion}</dd>
        </div>
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
    <main className="section detail-page-section plugin-detail-page" aria-busy="true">
      <div role="status" aria-label="Loading plugin details">
        <SkillDetailSkeleton kind="plugin" />
      </div>
    </main>
  );
}

type PluginDetailPageProps = {
  name: string;
  loaderData: PluginDetailLoaderData;
};

export function PluginDetailPage(props: PluginDetailPageProps) {
  return <PluginDetailPageContent key={props.name} {...props} />;
}

function PluginDetailPageContent({ name, loaderData }: PluginDetailPageProps) {
  const { detail, version, versions, readme, rateLimited } = loaderData;
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { me } = useAuthStatus();
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
    me && !isNestedPluginRoute && detail.package
      ? { name: manageLookupName, candidateNames: manageCandidateNames }
      : "skip",
  );
  const validationSummary = useQuery(
    api.packages.getPackageInspectorValidationSummaryPublic,
    detail.package ? { name: detail.package.name } : "skip",
  ) as PluginInspectorValidationSummary | undefined;
  const activityTrendEndDay = getActivityTrendEndDay();
  const { trend: activityTrend, loading: activityTrendLoading } = useDeferredPackageActivityTrend(
    detail.package ? { name: detail.package.name, endDay: activityTrendEndDay } : null,
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
    ? inspectorFindings.filter((finding) => finding.authorRemediation?.summary)
    : undefined;
  const displayInspectorFindings =
    authorInspectorFindings && shouldShowDevValidationFindingMocks()
      ? [...authorInspectorFindings, ...buildDevValidationFindingMocks(authorInspectorFindings[0])]
      : authorInspectorFindings;
  const [activeTab, setActiveTab] = useState<PluginDetailTab>("readme");
  const [mobileDetailPanel, setMobileDetailPanel] = useState<"content" | "stats">("content");
  const isMobileDetailLayout = useMediaQuery("(max-width: 900px)");
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const [isCatalogMetadataDialogOpen, setIsCatalogMetadataDialogOpen] = useState(false);
  const setCatalogMetadata = useMutation(api.packages.setPackageCatalogMetadata);
  useEffect(() => {
    const syncTabFromHash = () => setActiveTab(pluginDetailTabFromHash(window.location.hash));
    window.addEventListener("hashchange", syncTabFromHash);
    syncTabFromHash();
    return () => window.removeEventListener("hashchange", syncTabFromHash);
  }, []);
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

  const pkg = detail.package;
  const headerCategories = (pkg.categories ?? [])
    .flatMap((value) => {
      const slug = resolvePluginBrowseCategorySlug(value);
      const category = PLUGIN_CATEGORIES.find((item) => item.slug === slug);
      return category ? [category] : [];
    })
    .slice(0, 3);
  const headerTopics = (pkg.topics ?? [])
    .map((topic) => topic.trim())
    .filter(Boolean)
    .slice(0, DETAIL_HERO_TOPIC_LIMIT);
  const headerSummary = pkg.summary ?? "No summary provided.";
  const hasSummaryToggle = headerSummary.length > 220;
  const owner = detail.owner;
  const heroCreatorPublisher = useHeroCreatorPublisher({
    owner,
    packageOfficial: pkg.isOfficial === true,
  });
  const latestRelease = version?.version ?? null;
  const isDownloadBlocked =
    pkg.scanStatus === "malicious" || latestRelease?.verification?.scanStatus === "malicious";
  const skillInstallOwner = owner?.handle ?? pkg.ownerHandle ?? "owner";
  const installSnippet =
    pkg.family === "code-plugin"
      ? `openclaw plugins install clawhub:${pkg.name}`
      : pkg.family === "bundle-plugin"
        ? `openclaw plugins install clawhub:${pkg.name}`
        : `openclaw skills install @${skillInstallOwner.replace(/^@+/, "")}/${pkg.name}`;

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
  const showCatalogMetadataEmptyState = Boolean(
    manageContext && headerCategories.length === 0 && headerTopics.length === 0,
  );
  const compatEntries = compatibility
    ? Object.entries(compatibility).filter(([, v]) => v !== undefined && v !== null)
    : [];
  const manifestPluginApiRange = pluginManifestSummary?.compatibility?.pluginApiRange;
  const versionsPanel = (hidden: boolean) => (
    <PluginVersionsPanel
      packageName={pkg.name}
      versions={versions}
      latestVersion={pkg.latestVersion ?? null}
      canDeleteVersions={canDeleteVersions === true}
      onVersionDeleted={() => router.invalidate()}
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
  const mcpServersPanel =
    pluginManifestSummary && pluginManifestSummary.mcpServers.length > 0 ? (
      <PluginManifestMcpServersPanel servers={pluginManifestSummary.mcpServers} />
    ) : null;
  const skillsPanel =
    pluginManifestSummary && pluginManifestSummary.bundledSkills.length > 0 ? (
      <PluginManifestSkillsPanel
        packageName={pkg.name}
        version={latestRelease?.version ?? pkg.latestVersion ?? null}
        skills={pluginManifestSummary.bundledSkills}
      />
    ) : null;
  const incompatibilityAlert =
    validationSummary &&
    validationSummary.errorCount > 0 &&
    validationSummary.incompatibleAfterOpenClawVersion ? (
      <Alert variant="destructive" className="plugin-validation-alert">
        <AlertTriangle size={16} aria-hidden="true" />
        <AlertDescription>
          This plugin is incompatible with OpenClaw versions greater than{" "}
          {validationSummary.incompatibleAfterOpenClawVersion}.
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
                    <code className="plugin-validation-command">{PLUGIN_VALIDATE_CLI}</code>
                    <InstallCopyButton
                      text={PLUGIN_VALIDATE_CLI}
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
  const sourceRepoLink = verification?.sourceRepo
    ? (() => {
        const raw = verification.sourceRepo;
        const href = /^https?:\/\//.test(raw) ? raw : `https://github.com/${raw}`;
        const display = href
          .replace(/^https?:\/\/github\.com\//, "")
          .replace(/^https?:\/\//, "")
          .replace(/\/$/, "");
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className="plugin-external-link">
            <GitHubIcon />
            {display}
          </a>
        );
      })()
    : null;
  const pluginHeroCreator = heroCreatorPublisher ? (
    <UserBadge
      user={heroCreatorPublisher}
      fallbackHandle={heroCreatorPublisher.handle ?? pkg.ownerHandle ?? null}
      prefix=""
      size="md"
      showName
      showHandle={false}
      showMutedHandle
      stackMutedHandleBelowName
      disableTooltip
    />
  ) : null;
  const hasSourceMetadata = Boolean(sourceRepoLink || owner || latestRelease || pkg.latestVersion);
  const securitySummary = latestRelease ? (
    <DetailSecuritySummary
      auditHref={buildPluginSecurityAuditHref(name, { ownerHandle: owner?.handle })}
      vtAnalysis={latestRelease.vtAnalysis ?? null}
      llmAnalysis={latestRelease.llmAnalysis ?? null}
    />
  ) : null;
  const pluginSidebarDownloadActions =
    pkg.latestVersion && !isDownloadBlocked ? (
      <div className="plugin-sidebar-download-actions">
        <Button asChild variant="outline" size="sm" className="plugin-sidebar-download-button">
          <a href={downloadPath}>
            <Download size={13} aria-hidden="true" />
            Download
          </a>
        </Button>
      </div>
    ) : null;
  const hasDownloadsGraph = activityTrendLoading || Boolean(activityTrend?.downloads);
  const pluginDownloadsMetricBlock =
    !hasDownloadsGraph && pluginSidebarDownloadActions
      ? {
          ...downloadsMetricBlock,
          value: (
            <div className="plugin-downloads-metric-value-row">
              <div className="plugin-downloads-metric-content">{downloadsMetricBlock.value}</div>
              {pluginSidebarDownloadActions}
            </div>
          ),
        }
      : downloadsMetricBlock;
  const pluginDownloadMetadataBlock =
    hasDownloadsGraph && pluginSidebarDownloadActions
      ? {
          key: "plugin-download",
          label: "",
          value: pluginSidebarDownloadActions,
        }
      : null;
  const pluginSidebarMetadataBlocks = hasSourceMetadata
    ? [
        pluginDownloadsMetricBlock,
        { label: "Repository", value: sourceRepoLink },
        securitySummary
          ? {
              key: "security-audit",
              label: <DetailSecuritySummaryLabel />,
              value: securitySummary,
            }
          : { label: "", value: null },
        {
          grid: [
            {
              label: "Last updated",
              value: (
                <span title={new Date(pkg.updatedAt).toLocaleString()}>
                  {timeAgo(pkg.updatedAt)}
                </span>
              ),
            },
            {
              label: "Current version",
              value: pkg.latestVersion ? `v${pkg.latestVersion}` : null,
            },
          ],
        },
        { label: "Type", value: familyLabel(pkg.family) },
        ...(pluginDownloadMetadataBlock ? [pluginDownloadMetadataBlock] : []),
      ]
    : [
        pluginDownloadsMetricBlock,
        ...(pluginDownloadMetadataBlock ? [pluginDownloadMetadataBlock] : []),
      ];
  const pluginSidebarStatsContent =
    hasSourceMetadata || pluginSidebarDownloadActions ? (
      <SidebarMetadata
        ariaLabel="Plugin metadata"
        density="compact"
        className="skill-sidebar-deferred-metadata"
        blocks={pluginSidebarMetadataBlocks}
      />
    ) : null;
  const managementToolbar = newVersionHref ? (
    <div className="skill-management-toolbar">
      <div className="skill-management-toolbar-inner">
        <Button asChild variant="ghost" size="xs" className="skill-management-toolbar-action">
          <a href={newVersionHref} aria-label="New version">
            <Upload size={13} aria-hidden="true" />
            New version
          </a>
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <main className="section detail-page-section plugin-detail-page">
      <DetailPageShell>
        {managementToolbar}
        <DetailHero
          main={
            <div className="skill-hero-title">
              <nav className="skill-hero-breadcrumbs" aria-label="Plugin breadcrumbs">
                <a href="/plugins">plugins</a>
                <span aria-hidden="true">/</span>
                <a href={owner?.handle ? buildPublisherProfileHref(owner.handle) : "#"}>
                  {owner?.handle ?? owner?.displayName ?? "unknown"}
                </a>
                <span aria-hidden="true">/</span>
                <a
                  href={buildPluginDetailHref(pkg.name, { ownerHandle: owner?.handle })}
                  aria-current="page"
                >
                  {displayPluginPackageName(pkg.name)}
                </a>
              </nav>
              <div className="skill-hero-heading-stack">
                {showCatalogMetadataEmptyState ? (
                  <div
                    className="plugin-catalog-empty-alert plugin-catalog-empty-alert--hero"
                    role="status"
                  >
                    <span className="plugin-catalog-empty-alert-visibility">
                      Visible only to you
                    </span>
                    <div className="plugin-catalog-empty-alert-row">
                      <div className="plugin-catalog-empty-alert-icon" aria-hidden="true">
                        <Sparkles size={14} />
                      </div>
                      <span className="plugin-catalog-empty-alert-title">
                        Categorize your plugin
                      </span>
                      <span className="skill-hero-taxonomy-separator" aria-hidden="true" />
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        className="plugin-catalog-empty-alert-cta"
                        aria-label="Add categories and topics"
                        onClick={() => setIsCatalogMetadataDialogOpen(true)}
                      >
                        <Plus size={13} aria-hidden="true" />
                        Add categories & topics
                      </Button>
                    </div>
                  </div>
                ) : headerCategories.length > 0 || headerTopics.length > 0 ? (
                  <div className="skill-hero-taxonomy-row" aria-label="Plugin metadata">
                    {headerCategories.length > 0 ? (
                      <div className="skill-category-meta-list" aria-label="Categories">
                        {headerCategories.map((category) => (
                          <a
                            key={category.slug}
                            className="skill-category-meta-link"
                            href={buildPluginCategoryBrowseHref(category)}
                            aria-label={`View ${category.label} plugins`}
                          >
                            <BrowseCategoryIcon
                              slug={category.slug}
                              icon={category.icon}
                              size={14}
                              className="skill-category-icon"
                            />
                            <span>{category.label}</span>
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {headerCategories.length > 0 && headerTopics.length > 0 ? (
                      <span className="skill-hero-taxonomy-separator" aria-hidden="true" />
                    ) : null}
                    {headerTopics.length > 0 ? (
                      <div className="skill-hero-topic-list" aria-label="Topics">
                        {headerTopics.map((topic) => (
                          <a
                            key={topic}
                            className="skill-hero-topic"
                            href={buildPluginTopicBrowseHref(topic)}
                            aria-label={`View plugins tagged ${formatCatalogTopicLabel(topic)}`}
                          >
                            {formatCatalogTopicLabel(topic)}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="skill-hero-title-row">
                  <h1 className="skill-page-title">{pkg.displayName}</h1>
                  {isDownloadBlocked ? (
                    <div className="skill-title-actions">
                      <Badge variant="destructive">Download blocked</Badge>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="skill-summary-block">
                <p
                  className={`section-subtitle skill-summary-line${
                    hasSummaryToggle && !isSummaryExpanded ? " line-clamp-2" : ""
                  }`}
                >
                  <InlineCodeSummary>{headerSummary}</InlineCodeSummary>
                </p>
                {hasSummaryToggle ? (
                  <button
                    type="button"
                    className="skill-summary-toggle"
                    aria-expanded={isSummaryExpanded}
                    onClick={() => setIsSummaryExpanded((expanded) => !expanded)}
                  >
                    {isSummaryExpanded ? "Show less" : "Read more"}
                  </button>
                ) : null}
              </div>
              {pluginHeroCreator ? (
                <div className="skill-hero-creator">{pluginHeroCreator}</div>
              ) : null}

              {rateLimited?.scope === "metadata" ? (
                <div className="skill-hero-badges">
                  <Badge variant="compact">Some metadata is temporarily unavailable</Badge>
                </div>
              ) : null}
            </div>
          }
          sidebar={
            <div className="skill-hero-sidebar-stack">
              {pluginSidebarStatsContent && !isMobileDetailLayout ? (
                <div className="detail-sidebar-stats">{pluginSidebarStatsContent}</div>
              ) : null}
            </div>
          }
        >
          <div className="detail-mobile-master-tabs" data-active={mobileDetailPanel}>
            <div
              className="detail-mobile-master-tab-list"
              role="tablist"
              aria-label="Plugin mobile sections"
            >
              <button
                id="plugin-mobile-master-tab-content"
                className={`detail-mobile-master-tab${
                  mobileDetailPanel === "content" ? " is-active" : ""
                }`}
                type="button"
                role="tab"
                aria-selected={mobileDetailPanel === "content"}
                aria-controls="plugin-mobile-master-panel-content"
                onClick={() => setMobileDetailPanel("content")}
              >
                About
              </button>
              {pluginSidebarStatsContent && isMobileDetailLayout ? (
                <button
                  id="plugin-mobile-master-tab-stats"
                  className={`detail-mobile-master-tab${
                    mobileDetailPanel === "stats" ? " is-active" : ""
                  }`}
                  type="button"
                  role="tab"
                  aria-selected={mobileDetailPanel === "stats"}
                  aria-controls="plugin-mobile-master-panel-stats"
                  onClick={() => setMobileDetailPanel("stats")}
                >
                  Stats
                </button>
              ) : null}
            </div>
            <div
              className="detail-mobile-master-panel detail-mobile-master-panel-content"
              id="plugin-mobile-master-panel-content"
              role="tabpanel"
              aria-labelledby="plugin-mobile-master-tab-content"
              hidden={mobileDetailPanel !== "content"}
            >
              {validationPanel}
              <div className="plugin-install-stack detail-mobile-install">
                {incompatibilityAlert}
                <Card className="skill-install-command-card">
                  <CardHeader className="detail-hero-summary-row plugin-install-card-header">
                    <CardTitle className="skill-install-panel-title">Install</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="skill-install-command-wrap">
                      <div className="skill-install-command-shell skill-install-command-shell-cli">
                        <span className="skill-install-command-prompt" aria-hidden="true">
                          $
                        </span>
                        <pre className="skill-install-command">
                          <OpenClawCliInstallCommand command={installSnippet} />
                        </pre>
                        <InstallCopyButton
                          text={installSnippet}
                          ariaLabel="Copy plugin install command"
                          showLabel={false}
                          variant="ghost"
                          size="icon-sm"
                          className="skill-install-command-inline-button"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
              <PluginDetailTabs
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                readme={readme}
                readmeAssetBaseUrl={readmeAssetBaseUrl}
                versionsPanel={versionsPanel}
                compatibilityPanel={compatibilityPanel}
                configurationPanel={configurationPanel}
                mcpServersPanel={mcpServersPanel}
                skillsPanel={skillsPanel}
              />
            </div>
            {pluginSidebarStatsContent && isMobileDetailLayout ? (
              <div
                className="detail-mobile-master-panel detail-mobile-master-stats"
                id="plugin-mobile-master-panel-stats"
                role="tabpanel"
                aria-labelledby="plugin-mobile-master-tab-stats"
                hidden={mobileDetailPanel !== "stats"}
              >
                {pluginSidebarStatsContent}
              </div>
            ) : null}
          </div>
        </DetailHero>
      </DetailPageShell>
      {manageContext ? (
        <Dialog open={isCatalogMetadataDialogOpen} onOpenChange={setIsCatalogMetadataDialogOpen}>
          <DialogContent className="plugin-catalog-metadata-dialog">
            <DialogHeader>
              <DialogTitle>Categorize this plugin</DialogTitle>
              <DialogDescription>
                Select up to 3 categories and add topics to organize this plugin.
              </DialogDescription>
            </DialogHeader>
            <CatalogMetadataEditor
              kind="plugin"
              categories={manageContext.package.categories}
              suggestedCategories={manageContext.suggestedCategories}
              topics={manageContext.package.topics}
              onSave={async (value) => {
                await setCatalogMetadata({
                  packageId: manageContext.package._id,
                  categories: value.categories,
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
