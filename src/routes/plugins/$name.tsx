import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
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
import { SidebarMetadata } from "../../components/SidebarMetadata";
import { SkillDetailSkeleton } from "../../components/skeletons/SkillDetailSkeleton";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { formatRetryDelay } from "../../lib/formatRetryDelay";
import { formatCompactStat } from "../../lib/numberFormat";
import { buildPluginMeta } from "../../lib/og";
import { getOpenClawPackageCandidateNames } from "../../lib/openClawExtensionSlugs";
import {
  fetchPackageDetail,
  fetchPackageReadme,
  getPackageArtifactDownloadPath,
  fetchPackageVersion,
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
import { useAuthStatus } from "../../lib/useAuthStatus";

type PluginDetailRateLimitState = {
  scope: "detail" | "metadata";
  retryAfterSeconds: number | null;
} | null;

type PluginDetailTab = "readme" | "capabilities" | "compatibility" | "verification";

export type PluginDetailLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
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
    return { detail, version: null, readme: null, rateLimited: null };
  }

  try {
    const [version, readme] = await Promise.all([
      detail.package.latestVersion
        ? fetchPackageVersion(resolvedName, detail.package.latestVersion)
        : Promise.resolve(null),
      fetchPackageReadme(resolvedName),
    ]);

    return { detail, version, readme, rateLimited: null };
  } catch (error) {
    if (isRateLimitedPackageApiError(error)) {
      return {
        detail,
        version: null,
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

const CAPABILITY_LABELS: Record<string, string> = {
  executesCode: "Executes code",
  runtimeId: "Runtime ID",
  pluginKind: "Plugin kind",
  channels: "Channels",
  providers: "Providers",
  hooks: "Hooks",
  bundledSkills: "Bundled skills",
  setupEntry: "Setup entry",
  toolNames: "Tools",
  commandNames: "Commands",
  serviceNames: "Services",
  capabilityTags: "Tags",
  httpRouteCount: "HTTP routes",
  bundleFormat: "Bundle format",
  hostTargets: "Host targets",
};

function formatCapabilityValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length === 0 ? "None" : value.join(", ");
  return JSON.stringify(value);
}

function formatDisplayValue(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

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

function isEmptyObject(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return true;
  return Object.keys(obj).length === 0;
}

function PluginDetailTabs({
  activeTab,
  setActiveTab,
  readmePanel,
  capabilitiesPanel,
  compatibilityPanel,
  verificationPanel,
}: {
  activeTab: PluginDetailTab;
  setActiveTab: (tab: PluginDetailTab) => void;
  readmePanel: ReactNode;
  capabilitiesPanel: ReactNode | null;
  compatibilityPanel: ReactNode | null;
  verificationPanel: ReactNode | null;
}) {
  const selectTab = (tab: PluginDetailTab) => {
    setActiveTab(tab);
    if (typeof window === "undefined") return;
    const hash = tab === "readme" ? "" : `#${tab}`;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  };

  const effectiveActiveTab =
    activeTab === "capabilities" && capabilitiesPanel
      ? "capabilities"
      : activeTab === "compatibility" && compatibilityPanel
        ? "compatibility"
        : activeTab === "verification" && verificationPanel
          ? "verification"
          : "readme";
  const activePanel =
    effectiveActiveTab === "capabilities" && capabilitiesPanel
      ? capabilitiesPanel
      : effectiveActiveTab === "compatibility" && compatibilityPanel
        ? compatibilityPanel
        : effectiveActiveTab === "verification" && verificationPanel
          ? verificationPanel
          : readmePanel;

  return (
    <div className="tab-card">
      <div className="tab-header" role="tablist" aria-label="Plugin detail tabs">
        <button
          className={`tab-button${effectiveActiveTab === "readme" ? " is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={effectiveActiveTab === "readme"}
          onClick={() => selectTab("readme")}
        >
          README
        </button>
        {capabilitiesPanel ? (
          <button
            className={`tab-button${effectiveActiveTab === "capabilities" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={effectiveActiveTab === "capabilities"}
            onClick={() => selectTab("capabilities")}
          >
            Capabilities
          </button>
        ) : null}
        {compatibilityPanel ? (
          <button
            className={`tab-button${effectiveActiveTab === "compatibility" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={effectiveActiveTab === "compatibility"}
            onClick={() => selectTab("compatibility")}
          >
            Compatibility
          </button>
        ) : null}
        {verificationPanel ? (
          <button
            className={`tab-button${effectiveActiveTab === "verification" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={effectiveActiveTab === "verification"}
            onClick={() => selectTab("verification")}
          >
            Verification
          </button>
        ) : null}
      </div>
      <div className="tab-body">{activePanel}</div>
    </div>
  );
}

function PluginDetailRoute() {
  return (
    <PluginDetailPage
      name={Route.useParams().name}
      loaderData={Route.useLoaderData() as PluginDetailLoaderData}
    />
  );
}

export function PluginDetailPending() {
  return (
    <main className="section detail-page-section" aria-busy="true">
      <div role="status" aria-label="Loading plugin details">
        <SkillDetailSkeleton kind="plugin" />
      </div>
    </main>
  );
}

export function PluginDetailPage({
  name,
  loaderData,
}: {
  name: string;
  loaderData: PluginDetailLoaderData;
}) {
  const { detail, version, readme, rateLimited } = loaderData;
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
  const [activeTab, setActiveTab] = useState<PluginDetailTab>(() => {
    if (typeof window === "undefined") return "readme";
    const hash = window.location.hash.replace("#", "");
    return hash === "capabilities" || hash === "compatibility" || hash === "verification"
      ? hash
      : "readme";
  });
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

  const capabilities = latestRelease?.capabilities ?? pkg.capabilities;
  const compatibility = latestRelease?.compatibility ?? pkg.compatibility;
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
  const capEntries = capabilities
    ? Object.entries(capabilities).filter(
        ([, v]) =>
          v !== undefined && v !== null && v !== false && !(Array.isArray(v) && v.length === 0),
      )
    : [];
  const executesCodeValue =
    typeof capabilities?.executesCode === "boolean"
      ? formatCapabilityValue(capabilities.executesCode)
      : null;
  const tabCapEntries = capEntries.filter(([key]) => key !== "executesCode");

  const compatEntries = compatibility
    ? Object.entries(compatibility).filter(([, v]) => v !== undefined && v !== null)
    : [];
  const readmePanel = readme ? (
    <MarkdownPreview assetBaseUrl={readmeAssetBaseUrl}>{readme}</MarkdownPreview>
  ) : (
    <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
      <p className="empty-state-title">No README available</p>
      <p className="empty-state-body">This plugin doesn't have a README yet.</p>
    </div>
  );
  const capabilitiesPanel =
    tabCapEntries.length > 0 ? (
      <div className="plugin-tab-panel">
        <dl className="plugin-kv-grid">
          {tabCapEntries.map(([key, value]) => (
            <div key={key} className="plugin-kv-row">
              <dt className="plugin-kv-label">{CAPABILITY_LABELS[key] ?? key}</dt>
              <dd className="plugin-kv-value">
                {key === "capabilityTags" && Array.isArray(value) ? (
                  <div className="plugin-tag-list">
                    {(value as string[]).map((tag) => (
                      <Link key={tag} to="/plugins" search={{ q: tag }}>
                        <Badge variant="compact">{tag}</Badge>
                      </Link>
                    ))}
                  </div>
                ) : key === "hostTargets" && Array.isArray(value) ? (
                  <div className="plugin-tag-list">
                    {(value as string[]).map((target) => (
                      <Badge key={target} variant="compact">
                        {target}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  formatCapabilityValue(value)
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    ) : null;
  const compatibilityPanel =
    compatEntries.length > 0 || artifact ? (
      <div className="plugin-tab-panel">
        <dl className="plugin-kv-grid">
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
  const verificationPanel =
    verification && !isEmptyObject(verification) ? (
      <div className="plugin-tab-panel">
        <dl className="plugin-kv-grid">
          {verification.tier ? (
            <div className="plugin-kv-row">
              <dt className="plugin-kv-label">Tier</dt>
              <dd className="plugin-kv-value">{formatDisplayValue(verification.tier)}</dd>
            </div>
          ) : null}
          {verification.scope ? (
            <div className="plugin-kv-row">
              <dt className="plugin-kv-label">Scope</dt>
              <dd className="plugin-kv-value">{formatDisplayValue(verification.scope)}</dd>
            </div>
          ) : null}
          {verification.summary ? (
            <div className="plugin-kv-row">
              <dt className="plugin-kv-label">Summary</dt>
              <dd className="plugin-kv-value">{verification.summary}</dd>
            </div>
          ) : null}
        </dl>
      </div>
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
  const tagMetadataValue =
    pkg.tags && Object.keys(pkg.tags).length > 0 ? (
      <span className="plugin-sidebar-tag-list">
        {Object.entries(pkg.tags).map(([key, value]) => (
          <span key={key}>
            {key} {String(value)}
          </span>
        ))}
      </span>
    ) : null;
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
    </span>
  ) : null;
  const hasSourceMetadata = Boolean(
    sourceRepoLink ||
    ownerMetadataValue ||
    latestRelease ||
    executesCodeValue ||
    pkg.latestVersion ||
    tagMetadataValue,
  );
  const securitySummary = latestRelease ? (
    <DetailSecuritySummary
      auditHref={buildPluginSecurityAuditHref(name)}
      vtAnalysis={latestRelease.vtAnalysis ?? null}
      llmAnalysis={latestRelease.llmAnalysis ?? null}
    />
  ) : null;

  return (
    <main className="section detail-page-section">
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
                <a href="/plugins">plugins</a>
                <span aria-hidden="true">/</span>
                <a href={buildPluginDetailHref(pkg.name)}>{pkg.name}</a>
              </nav>
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
              <p className="section-subtitle">{pkg.summary ?? "No summary provided."}</p>

              {rateLimited?.scope === "metadata" ? (
                <div className="skill-hero-badges">
                  <Badge variant="compact">Some metadata is temporarily unavailable</Badge>
                </div>
              ) : null}
            </div>
          }
          sidebar={
            <div className="plugin-sidebar-stack">
              {hasSourceMetadata ? (
                <SidebarMetadata
                  ariaLabel="Plugin metadata"
                  density="compact"
                  blocks={[
                    {
                      label: "Downloads",
                      value: formatCompactStat(pkg.stats?.downloads ?? 0),
                      large: true,
                    },
                    { label: "Repository", value: sourceRepoLink },
                    { label: "Owner", value: ownerMetadataValue },
                    securitySummary
                      ? {
                          key: "security-audit",
                          label: <DetailSecuritySummaryLabel />,
                          value: securitySummary,
                        }
                      : { label: "", value: null },
                    { label: "Executes code", value: executesCodeValue },
                    {
                      grid: [
                        {
                          label: "Current version",
                          value: pkg.latestVersion ? `v${pkg.latestVersion}` : null,
                        },
                        { label: "Type", value: familyLabel(pkg.family) },
                      ],
                    },
                    { label: "Tags", value: tagMetadataValue },
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
                  {newVersionHref ? (
                    <Button asChild variant="outline" className="skill-sidebar-action-button">
                      <a href={newVersionHref}>
                        <Upload size={14} aria-hidden="true" />
                        New version
                      </a>
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          }
        >
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
          <PluginDetailTabs
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            readmePanel={readmePanel}
            capabilitiesPanel={capabilitiesPanel}
            compatibilityPanel={compatibilityPanel}
            verificationPanel={verificationPanel}
          />
        </DetailHero>
      </DetailPageShell>
    </main>
  );
}
