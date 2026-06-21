import {
  createFileRoute,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, BadgeCheck, Download, Info, Share2, Upload } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { CatalogMetadataEditor } from "../../components/CatalogMetadataEditor";
import { DetailHero, DetailPageShell } from "../../components/DetailPageShell";
import {
  DetailSecuritySummary,
  DetailSecuritySummaryLabel,
} from "../../components/DetailSecuritySummary";
import { EmptyState } from "../../components/EmptyState";
import { InstallCopyButton } from "../../components/InstallCopyButton";
import { Container } from "../../components/layout/Container";
import { MarkdownPreview } from "../../components/MarkdownPreview";
import { OfficialTag } from "../../components/OfficialBadge";
import {
  PLUGIN_VERSIONS_PAGE_SIZE,
  PluginVersionsPanel,
} from "../../components/PluginVersionsPanel";
import { SidebarMetadata } from "../../components/SidebarMetadata";
import { SkillDetailSkeleton } from "../../components/skeletons/SkillDetailSkeleton";
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
import { formatRetryDelay } from "../../lib/formatRetryDelay";
import { BrowseCategoryIcon } from "../../lib/browseCategoryIcons";
import {
  buildPluginCategoryBrowseHref,
  PLUGIN_CATEGORIES,
  resolvePluginBrowseCategorySlug,
} from "../../lib/categories";
import { formatCompactStat } from "../../lib/numberFormat";
import { buildPluginMeta } from "../../lib/og";
import { getOpenClawPackageCandidateNames } from "../../lib/openClawExtensionSlugs";
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
  buildPluginDetailHref,
  buildPluginSecurityAuditHref,
  parseScopedPackageName,
} from "../../lib/pluginRoutes";
import { buildReadmeAssetBaseUrl } from "../../lib/readmeAssetBaseUrl";
import { timeAgo } from "../../lib/timeAgo";
import { useAuthStatus } from "../../lib/useAuthStatus";

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
  | "skills"
  | "validation";

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
  loader: async ({ params }) => loadPluginDetail(params.name),
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
  if (hash === "warnings") return "validation";
  if (hash === "verification") return "compatibility";
  if (hash === "mcp-servers" || hash === "mcpServers") return "mcpServers";
  return hash === "versions" ||
    hash === "compatibility" ||
    hash === "configuration" ||
    hash === "skills" ||
    hash === "validation"
    ? hash
    : "readme";
}

function PluginDetailTabs({
  activeTab,
  setActiveTab,
  readmePanel,
  versionsPanel,
  compatibilityPanel,
  configurationPanel,
  mcpServersPanel,
  skillsPanel,
  validationPanel,
  validationCount,
}: {
  activeTab: PluginDetailTab;
  setActiveTab: (tab: PluginDetailTab) => void;
  readmePanel: ReactNode;
  versionsPanel: ReactNode;
  compatibilityPanel: ReactNode | null;
  configurationPanel: ReactNode | null;
  mcpServersPanel: ReactNode | null;
  skillsPanel: ReactNode | null;
  validationPanel: ReactNode | null;
  validationCount: number;
}) {
  const [hasMountedVersions, setHasMountedVersions] = useState(false);
  const selectTab = (tab: PluginDetailTab) => {
    setActiveTab(tab);
    if (typeof window === "undefined") return;
    const hash = tab === "readme" ? "" : tab === "mcpServers" ? "#mcp-servers" : `#${tab}`;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
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
              : activeTab === "validation" && validationPanel
                ? "validation"
                : "readme";
  useEffect(() => {
    if (effectiveActiveTab === "versions") setHasMountedVersions(true);
  }, [effectiveActiveTab]);
  const activePanel =
    effectiveActiveTab === "compatibility" && compatibilityPanel
      ? compatibilityPanel
      : effectiveActiveTab === "configuration" && configurationPanel
        ? configurationPanel
        : effectiveActiveTab === "mcpServers" && mcpServersPanel
          ? mcpServersPanel
          : effectiveActiveTab === "skills" && skillsPanel
            ? skillsPanel
            : effectiveActiveTab === "validation" && validationPanel
              ? validationPanel
              : readmePanel;

  return (
    <div className="tab-card">
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
          README
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
        {validationPanel ? (
          <button
            id="plugin-tab-validation"
            className={`tab-button${effectiveActiveTab === "validation" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={effectiveActiveTab === "validation"}
            aria-controls="plugin-tabpanel-validation"
            onClick={() => selectTab("validation")}
          >
            Validation ({validationCount})
          </button>
        ) : null}
      </div>
      <div
        className="tab-body"
        role="tabpanel"
        id={`plugin-tabpanel-${effectiveActiveTab}`}
        aria-labelledby={`plugin-tab-${effectiveActiveTab}`}
      >
        {effectiveActiveTab === "versions" ? null : activePanel}
        {hasMountedVersions || effectiveActiveTab === "versions" ? (
          <div hidden={effectiveActiveTab !== "versions"}>{versionsPanel}</div>
        ) : null}
      </div>
    </div>
  );
}

type PluginManifestSummary = NonNullable<
  NonNullable<PackageVersionDetail["version"]>["pluginManifestSummary"]
>;
type BundledPluginSkill = PluginManifestSummary["bundledSkills"][number];
type PluginConfigField = PluginManifestSummary["configFields"][number];
type PluginMcpServer = PluginManifestSummary["mcpServers"][number];

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
  const inspectorFindings = useQuery(
    api.packages.listPackageInspectorWarningsForManager,
    manageContext ? { name: manageContext.package.name, limit: 100 } : "skip",
  ) as PluginInspectorFinding[] | undefined;
  const authorInspectorFindings = Array.isArray(inspectorFindings)
    ? inspectorFindings.filter((finding) => finding.authorRemediation?.summary)
    : undefined;
  const [activeTab, setActiveTab] = useState<PluginDetailTab>("readme");
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
    .slice(0, 5);
  const owner = detail.owner;
  const latestRelease = version?.version ?? null;
  const isDownloadBlocked =
    pkg.scanStatus === "malicious" || latestRelease?.verification?.scanStatus === "malicious";
  const installSnippet =
    pkg.family === "code-plugin"
      ? `openclaw plugins install clawhub:${pkg.name}`
      : pkg.family === "bundle-plugin"
        ? `openclaw plugins install clawhub:${pkg.name}`
        : `openclaw skills install ${pkg.name}`;

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
  const readmePanel = readme ? (
    <MarkdownPreview assetBaseUrl={readmeAssetBaseUrl}>{readme}</MarkdownPreview>
  ) : (
    <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
      <p className="empty-state-title">No README available</p>
      <p className="empty-state-body">This plugin doesn't have a README yet.</p>
    </div>
  );
  const versionsPanel = (
    <PluginVersionsPanel
      packageName={pkg.name}
      versions={versions}
      latestVersion={pkg.latestVersion ?? null}
      canDeleteVersions={canDeleteVersions === true}
      onVersionDeleted={() => router.invalidate()}
    />
  );
  const compatibilityPanel =
    compatEntries.length > 0 || artifact || manifestPluginApiRange ? (
      <div className="plugin-tab-panel">
        <dl className="plugin-kv-grid">
          {manifestPluginApiRange ? (
            <div className="plugin-kv-row">
              <dt className="plugin-kv-label">OpenClaw plugin API</dt>
              <dd className="plugin-kv-value font-mono text-xs">{manifestPluginApiRange}</dd>
            </div>
          ) : null}
          {artifact ? (
            <>
              <div className="plugin-kv-row">
                <dt className="plugin-kv-label">Artifact</dt>
                <dd className="plugin-kv-value">
                  {artifact.kind === "npm-pack" ? "ClawPack" : "Legacy ZIP"}
                </dd>
              </div>
              {artifact.kind === "legacy-zip" ? (
                <div className="plugin-kv-row">
                  <dt className="plugin-kv-label">Compatibility note</dt>
                  <dd className="plugin-kv-value">
                    This plugin uses the legacy ZIP path and may have compatibility issues until the
                    publisher uploads a ClawPack.
                  </dd>
                </div>
              ) : null}
              {artifact.kind === "npm-pack" && artifact.npmTarballName ? (
                <div className="plugin-kv-row">
                  <dt className="plugin-kv-label">Tarball</dt>
                  <dd className="plugin-kv-value font-mono text-xs">{artifact.npmTarballName}</dd>
                </div>
              ) : null}
              {artifact.kind === "npm-pack" && formatArtifactSize(artifact.size) ? (
                <div className="plugin-kv-row">
                  <dt className="plugin-kv-label">Size</dt>
                  <dd className="plugin-kv-value">{formatArtifactSize(artifact.size)}</dd>
                </div>
              ) : null}
              {artifact.kind === "npm-pack" && typeof artifact.npmFileCount === "number" ? (
                <div className="plugin-kv-row">
                  <dt className="plugin-kv-label">Files</dt>
                  <dd className="plugin-kv-value">{artifact.npmFileCount}</dd>
                </div>
              ) : null}
              {artifact.kind === "npm-pack" && artifact.npmIntegrity ? (
                <div className="plugin-kv-row">
                  <dt className="plugin-kv-label">Integrity</dt>
                  <dd className="plugin-kv-value font-mono text-xs">{artifact.npmIntegrity}</dd>
                </div>
              ) : null}
            </>
          ) : null}
          {compatEntries.map(([key, value]) => (
            <div key={key} className="plugin-kv-row">
              <dt className="plugin-kv-label">
                {key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
              </dt>
              <dd className="plugin-kv-value font-mono text-xs">{value}</dd>
            </div>
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
  const validationCount = authorInspectorFindings?.length ?? validationSummary?.findingCount ?? 0;
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
  const validationPanel =
    authorInspectorFindings && authorInspectorFindings.length > 0 ? (
      <div className="plugin-tab-panel plugin-warnings-panel">
        <Alert variant="info" role="status">
          <Info size={16} aria-hidden="true" />
          <AlertDescription>
            <span>
              Validation outputs are only visible to plugin owners and admins. Run locally using the
              CLI:
            </span>
            <code className="plugin-validation-command">
              clawhub package validate &lt;path-to-plugin&gt;
            </code>
          </AlertDescription>
        </Alert>
        <div className="plugin-warning-list">
          {authorInspectorFindings.map((finding) => (
            <article
              key={`${finding.version}:${finding.code}:${finding.message}`}
              className={`plugin-warning-item is-${finding.findingKind ?? "warning"}`}
            >
              <div className="plugin-warning-item-header">
                <Badge variant={finding.findingKind === "error" ? "destructive" : "warning"}>
                  {finding.findingKind === "error" ? "Error" : "Warning"}
                </Badge>
                <code>{finding.code}</code>
                {finding.issueClass ? <span>{finding.issueClass}</span> : null}
                {finding.severity ? <span>{finding.severity}</span> : null}
              </div>
              <p>{finding.message}</p>
              <dl className="plugin-warning-meta">
                <div>
                  <dt>Plugin version</dt>
                  <dd>v{finding.version}</dd>
                </div>
                {finding.targetOpenClawVersion ? (
                  <div>
                    <dt>Target</dt>
                    <dd>OpenClaw {finding.targetOpenClawVersion}</dd>
                  </div>
                ) : null}
              </dl>
              {finding.evidence && finding.evidence.length > 0 ? (
                <ul className="plugin-warning-evidence">
                  {finding.evidence.slice(0, 4).map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              ) : null}
              {finding.authorRemediation?.summary ? (
                <div className="plugin-warning-remediation">
                  <h4>Fix</h4>
                  <p>{finding.authorRemediation.summary}</p>
                  {finding.authorRemediation.docsUrl ? (
                    <>
                      <h4>Docs</h4>
                      <a href={finding.authorRemediation.docsUrl} target="_blank" rel="noreferrer">
                        {finding.authorRemediation.docsUrl}
                      </a>
                    </>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    ) : null;
  const catalogMetadataPanel = manageContext ? (
    <Card>
      <CardHeader>
        <CardTitle>Catalog metadata</CardTitle>
      </CardHeader>
      <CardContent>
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
          }}
        />
      </CardContent>
    </Card>
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
            {display}
          </a>
        );
      })()
    : null;
  const ownerMetadataValue = owner ? (
    <span className="user-badge user-badge-md">
      <span className="user-avatar" aria-hidden="true">
        {owner.image ? (
          <img className="user-avatar-img" src={owner.image} alt="" loading="lazy" />
        ) : (
          <span className="user-avatar-fallback">
            {(owner.displayName ?? owner.handle ?? "p").charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      {owner.handle ? (
        <a className="user-name" href={`/user/${encodeURIComponent(owner.handle)}`}>
          {owner.displayName ?? owner.handle}
        </a>
      ) : (
        <span className="user-name">{owner.displayName ?? "unknown"}</span>
      )}
      {pkg.isOfficial ? (
        <span className="owner-official-icon" aria-label="Official" title="Official">
          <BadgeCheck size={14} aria-hidden="true" />
        </span>
      ) : null}
    </span>
  ) : null;
  const hasSourceMetadata = Boolean(
    sourceRepoLink || ownerMetadataValue || latestRelease || pkg.latestVersion,
  );
  const securitySummary = latestRelease ? (
    <DetailSecuritySummary
      auditHref={buildPluginSecurityAuditHref(name)}
      vtAnalysis={latestRelease.vtAnalysis ?? null}
      llmAnalysis={latestRelease.llmAnalysis ?? null}
    />
  ) : null;

  return (
    <main className="section detail-page-section plugin-detail-page">
      <DetailPageShell>
        <DetailHero
          main={
            <div className="skill-hero-title">
              <nav className="skill-hero-breadcrumbs" aria-label="Plugin breadcrumbs">
                <a href="/plugins">plugins</a>
                <span aria-hidden="true">/</span>
                <a href={owner?.handle ? `/user/${encodeURIComponent(owner.handle)}` : "#"}>
                  {owner?.handle ?? owner?.displayName ?? "unknown"}
                </a>
                <span aria-hidden="true">/</span>
                <a href={buildPluginDetailHref(pkg.name)} aria-current="page">
                  {pkg.name}
                </a>
              </nav>
              <div className="skill-hero-heading-stack">
                {headerCategories.length > 0 || headerTopics.length > 0 ? (
                  <div className="skill-hero-taxonomy-row" aria-label="Plugin metadata">
                    {headerCategories.length > 0 ? (
                      <div className="skill-category-meta-list" aria-label="Categories">
                        {headerCategories.map((category, index) => (
                          <Fragment key={category.slug}>
                            <a
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
                            {index < headerCategories.length - 1 ? (
                              <span className="skill-category-comma" aria-hidden="true">
                                ,
                              </span>
                            ) : null}
                          </Fragment>
                        ))}
                      </div>
                    ) : null}
                    {headerCategories.length > 0 && headerTopics.length > 0 ? (
                      <span className="skill-hero-taxonomy-separator" aria-hidden="true" />
                    ) : null}
                    {headerTopics.length > 0 ? (
                      <div className="skill-hero-topic-list" aria-label="Topics">
                        {headerTopics.map((topic) => (
                          <span className="skill-hero-topic" key={topic}>
                            #{topic.toLowerCase().replace(/\s+/g, "-")}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="skill-hero-title-row">
                  <h1 className="skill-page-title">{pkg.displayName}</h1>
                  {pkg.isOfficial ? (
                    <div className="skill-title-badges">
                      <OfficialTag />
                    </div>
                  ) : null}
                  {isDownloadBlocked ? (
                    <div className="skill-title-actions">
                      <Badge variant="destructive">Download blocked</Badge>
                    </div>
                  ) : null}
                </div>
              </div>
              <p className="section-subtitle">{pkg.summary ?? "No summary provided."}</p>

              {rateLimited?.scope === "metadata" ? (
                <div className="skill-hero-badges">
                  <Badge variant="compact">Some metadata is temporarily unavailable</Badge>
                </div>
              ) : null}
            </div>
          }
          sidebar={
            <div className="skill-hero-sidebar-stack">
              {hasSourceMetadata ? (
                <SidebarMetadata
                  ariaLabel="Plugin metadata"
                  density="compact"
                  blocks={[
                    {
                      label: "Installs",
                      value: formatCompactStat(pkg.stats?.installs ?? 0),
                      large: true,
                    },
                    { label: "Repository", value: sourceRepoLink },
                    { label: "Creator", value: ownerMetadataValue },
                    securitySummary
                      ? {
                          key: "security-audit",
                          label: <DetailSecuritySummaryLabel />,
                          value: securitySummary,
                        }
                      : { label: "", value: null },
                    {
                      label: "Last updated",
                      value: (
                        <span title={new Date(pkg.updatedAt).toLocaleString()}>
                          {timeAgo(pkg.updatedAt)}
                        </span>
                      ),
                    },
                    {
                      grid: [
                        {
                          label: "Current version",
                          value: pkg.latestVersion ? `v${pkg.latestVersion}` : null,
                        },
                        { label: "Type", value: familyLabel(pkg.family) },
                      ],
                    },
                  ]}
                />
              ) : null}

              {(pkg.latestVersion && !isDownloadBlocked) || newVersionHref ? (
                <div className="skill-sidebar-actions">
                  {pkg.latestVersion && !isDownloadBlocked ? (
                    <Button asChild variant="outline" className="skill-sidebar-action-button">
                      <a href={downloadPath}>
                        <Download size={14} aria-hidden="true" />
                        Download
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    type="button"
                    className="skill-sidebar-action-button"
                    onClick={() => {
                      if (typeof window === "undefined") return;
                      void navigator.clipboard.writeText(window.location.href);
                      toast.success("Link copied");
                    }}
                  >
                    <Share2 size={14} aria-hidden="true" />
                    Share
                  </Button>
                  {newVersionHref ? (
                    <>
                      <hr className="skill-sidebar-action-divider" />
                      <Button asChild variant="outline" className="skill-sidebar-action-button">
                        <a href={newVersionHref}>
                          <Upload size={14} aria-hidden="true" />
                          New version
                        </a>
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          }
        >
          <div className="plugin-install-stack">
            {incompatibilityAlert}
            <Card className="skill-install-command-card">
              <CardHeader>
                <CardTitle>Install</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="skill-install-command-wrap">
                  <div className="skill-install-command-shell">
                    <pre className="skill-install-command">
                      <code>{installSnippet}</code>
                    </pre>
                    <InstallCopyButton
                      text={installSnippet}
                      ariaLabel="Copy plugin install command"
                      showLabel={false}
                      className="skill-install-command-inline-button"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
            {catalogMetadataPanel}
          </div>
          <PluginDetailTabs
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            readmePanel={readmePanel}
            versionsPanel={versionsPanel}
            compatibilityPanel={compatibilityPanel}
            configurationPanel={configurationPanel}
            mcpServersPanel={mcpServersPanel}
            skillsPanel={skillsPanel}
            validationPanel={validationPanel}
            validationCount={validationCount}
          />
        </DetailHero>
      </DetailPageShell>
    </main>
  );
}
