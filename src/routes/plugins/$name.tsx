import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, ExternalLink, Download } from "lucide-react";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DetailHero, DetailPageShell } from "../../components/DetailPageShell";
import { DetailSecuritySummary } from "../../components/DetailSecuritySummary";
import { EmptyState } from "../../components/EmptyState";
import { InstallCopyButton } from "../../components/InstallCopyButton";
import { Container } from "../../components/layout/Container";
import { MarkdownPreview } from "../../components/MarkdownPreview";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { getUserFacingConvexError } from "../../lib/convexError";
import { formatRetryDelay } from "../../lib/formatRetryDelay";
import {
  fetchPackageDetail,
  fetchPackageReadme,
  fetchPackageVersion,
  getPackageDownloadPath,
  isRateLimitedPackageApiError,
  type PackageDetailResponse,
  type PackageVersionDetail,
} from "../../lib/packageApi";
import { familyLabel } from "../../lib/packageLabels";
import { useAuthStatus } from "../../lib/useAuthStatus";

type PluginDetailRateLimitState = {
  scope: "detail" | "metadata";
  retryAfterSeconds: number | null;
} | null;

type PluginDetailLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
  readme: string | null;
  rateLimited: PluginDetailRateLimitState;
};

export const Route = createFileRoute("/plugins/$name")({
  loader: async ({ params }): Promise<PluginDetailLoaderData> => {
    const requestedName = params.name;
    const candidateNames = requestedName.includes("/")
      ? [requestedName]
      : [requestedName, `@openclaw/${requestedName}`];

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
  },
  head: ({ params, loaderData }) => ({
    meta: [
      {
        title: loaderData?.detail.package?.displayName
          ? `${loaderData.detail.package.displayName} · Plugins`
          : params.name,
      },
      {
        name: "description",
        content: loaderData?.detail.package?.summary ?? `Plugin ${params.name}`,
      },
    ],
  }),
  component: PluginDetailRoute,
});

function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[#3b82f6]">
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Verified publisher"
        className="shrink-0"
      >
        <path
          d="M8 0L9.79 1.52L12.12 1.21L12.93 3.41L15.01 4.58L14.42 6.84L15.56 8.82L14.12 10.5L14.12 12.82L11.86 13.41L10.34 15.27L8 14.58L5.66 15.27L4.14 13.41L1.88 12.82L1.88 10.5L0.44 8.82L1.58 6.84L0.99 4.58L3.07 3.41L3.88 1.21L6.21 1.52L8 0Z"
          fill="#3b82f6"
        />
        <path
          d="M5.5 8L7 9.5L10.5 6"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Verified
    </span>
  );
}

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

function isEmptyObject(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return true;
  return Object.keys(obj).length === 0;
}

function PluginDetailRoute() {
  const { name } = Route.useParams();
  const { detail, version, readme, rateLimited } = Route.useLoaderData() as PluginDetailLoaderData;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { isAuthenticated } = useAuthStatus();
  const requestPluginRescan = useMutation(api.packages.requestRescan);
  const rescanState = useQuery(
    api.packages.getOwnerRescanStateByName,
    isAuthenticated && detail.package ? { name: detail.package.name } : "skip",
  ) as ComponentProps<typeof DetailSecuritySummary>["rescanState"] | undefined;

  if (pathname.includes("/security/")) {
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
    pkg.verification?.scanStatus === "malicious" ||
    latestRelease?.verification?.scanStatus === "malicious" ||
    latestRelease?.vtAnalysis?.status === "malicious" ||
    latestRelease?.vtAnalysis?.verdict === "malicious";
  const installSnippet =
    pkg.family === "code-plugin"
      ? `openclaw plugins install clawhub:${pkg.name}`
      : pkg.family === "bundle-plugin"
        ? `openclaw bundles install clawhub:${pkg.name}`
        : `openclaw skills install ${pkg.name}`;

  const capabilities = latestRelease?.capabilities ?? pkg.capabilities;
  const compatibility = latestRelease?.compatibility ?? pkg.compatibility;
  const verification = latestRelease?.verification ?? pkg.verification;
  const requestRescan = async () => {
    const packageId = (pkg as { _id?: Id<"packages"> })._id;
    if (!packageId) {
      toast.error("Could not request a rescan for this plugin.");
      return;
    }
    try {
      await requestPluginRescan({ packageId });
      toast.success("Rescan requested.", {
        action: {
          label: "Dashboard",
          onClick: () => {
            window.location.href = "/dashboard";
          },
        },
      });
    } catch (error) {
      toast.error(getUserFacingConvexError(error, "Could not request a rescan."));
    }
  };

  const capEntries = capabilities
    ? Object.entries(capabilities).filter(
        ([, v]) =>
          v !== undefined && v !== null && v !== false && !(Array.isArray(v) && v.length === 0),
      )
    : [];

  const compatEntries = compatibility
    ? Object.entries(compatibility).filter(([, v]) => v !== undefined && v !== null)
    : [];

  return (
    <main className="section detail-page-section">
      <DetailPageShell>
        <DetailHero
          main={
            <div className="skill-hero-title">
              <div className="skill-hero-title-row">
                <h1 className="skill-page-title">{pkg.displayName}</h1>
                {pkg.latestVersion ? (
                  <span className="plugin-version-badge">v{pkg.latestVersion}</span>
                ) : null}
                {pkg.latestVersion && !isDownloadBlocked ? (
                  <div className="skill-title-actions">
                    <Button asChild variant="outline" size="sm" className="no-underline">
                      <a href={getPackageDownloadPath(name, pkg.latestVersion)}>
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        Download
                      </a>
                    </Button>
                  </div>
                ) : null}
                {isDownloadBlocked ? (
                  <div className="skill-title-actions">
                    <Badge variant="destructive">Download blocked</Badge>
                  </div>
                ) : null}
              </div>
              <p className="section-subtitle">{pkg.summary ?? "No summary provided."}</p>

              <div className="skill-hero-inline-meta">
                <div className="skill-hero-stats-row">
                  <span className="stat font-mono text-xs">{pkg.name}</span>
                  {pkg.runtimeId ? (
                    <>
                      <span className="text-ink-soft opacity-40">·</span>
                      <span className="stat">
                        runtime <span className="font-mono text-xs">{pkg.runtimeId}</span>
                      </span>
                    </>
                  ) : null}
                  {owner?.handle ? (
                    <>
                      <span className="text-ink-soft opacity-40">·</span>
                      <Link
                        to="/u/$handle"
                        params={{ handle: owner.handle }}
                        className="text-[color:var(--accent)] hover:underline"
                      >
                        by @{owner.handle}
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="skill-hero-badges">
                <Badge>{familyLabel(pkg.family)}</Badge>
                {verification?.tier ? (
                  <Badge variant="compact">{verification.tier.replace(/-/g, " ")}</Badge>
                ) : null}
                {rateLimited?.scope === "metadata" ? (
                  <Badge variant="compact">Some metadata is temporarily unavailable</Badge>
                ) : null}
                {pkg.isOfficial ? (
                  <Badge className="bg-[rgba(59,130,246,0.15)] text-[#3b82f6]">
                    <VerifiedBadge />
                  </Badge>
                ) : null}
                {pkg.family === "code-plugin" && !pkg.isOfficial ? (
                  <Badge variant="accent">
                    Community code plugin. Review compatibility and verification before install.
                  </Badge>
                ) : null}
              </div>
            </div>
          }
        >
          <div className="skill-hero-action-grid">
            {latestRelease ? (
              <DetailSecuritySummary
                scannerBasePath={`/plugins/${encodeURIComponent(name)}/security`}
                sha256hash={latestRelease.sha256hash ?? null}
                vtAnalysis={latestRelease.vtAnalysis ?? null}
                llmAnalysis={latestRelease.llmAnalysis ?? null}
                staticScan={latestRelease.staticScan ?? null}
                rescanState={rescanState ?? null}
                onRequestRescan={rescanState ? requestRescan : null}
              />
            ) : null}
            <Card className="skill-install-command-card">
              <CardHeader>
                <CardTitle>Install</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="skill-install-command-wrap">
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
              </CardContent>
            </Card>
          </div>

          {readme ? (
            <Card className="tab-card">
              <CardHeader>
                <CardTitle>README</CardTitle>
              </CardHeader>
              <CardContent>
                <MarkdownPreview>{readme}</MarkdownPreview>
              </CardContent>
            </Card>
          ) : null}

          {/* Capabilities */}
          {capEntries.length > 0 ? (
            <Card>
              <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Capabilities</CardTitle>
                <InstallCopyButton
                  text={JSON.stringify(capabilities, null, 2)}
                  ariaLabel="Copy capabilities JSON"
                />
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-3 text-sm">
                  {capEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 last:border-b-0 last:pb-0 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0"
                    >
                      <dt className="font-semibold text-[color:var(--ink-soft)] sm:pr-2">
                        {CAPABILITY_LABELS[key] ?? key}
                      </dt>
                      <dd className="min-w-0 break-words text-[color:var(--ink)]">
                        {key === "capabilityTags" && Array.isArray(value) ? (
                          <div className="flex flex-wrap gap-1.5">
                            {(value as string[]).map((tag) => (
                              <Link key={tag} to="/plugins" search={{ q: tag }}>
                                <Badge variant="compact">{tag}</Badge>
                              </Link>
                            ))}
                          </div>
                        ) : key === "hostTargets" && Array.isArray(value) ? (
                          <div className="flex flex-wrap gap-1.5">
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
              </CardContent>
            </Card>
          ) : null}

          {/* Compatibility */}
          {compatEntries.length > 0 ? (
            <Card>
              <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Compatibility</CardTitle>
                <InstallCopyButton
                  text={JSON.stringify(compatibility, null, 2)}
                  ariaLabel="Copy compatibility JSON"
                />
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-3 text-sm">
                  {compatEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 last:border-b-0 last:pb-0 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0"
                    >
                      <dt className="font-semibold text-[color:var(--ink-soft)] sm:pr-2">
                        {key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                      </dt>
                      <dd className="min-w-0 break-all font-mono text-xs text-[color:var(--ink)]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {/* Verification */}
          {verification && !isEmptyObject(verification) ? (
            <Card>
              <CardHeader>
                <CardTitle>Verification</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-3 text-sm">
                  {verification.tier ? (
                    <div className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0">
                      <dt className="font-semibold text-[color:var(--ink-soft)]">Tier</dt>
                      <dd className="text-[color:var(--ink)]">
                        {verification.tier.replace(/-/g, " ")}
                      </dd>
                    </div>
                  ) : null}
                  {verification.scope ? (
                    <div className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0">
                      <dt className="font-semibold text-[color:var(--ink-soft)]">Scope</dt>
                      <dd className="text-[color:var(--ink)]">
                        {verification.scope.replace(/-/g, " ")}
                      </dd>
                    </div>
                  ) : null}
                  {verification.summary ? (
                    <div className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0">
                      <dt className="font-semibold text-[color:var(--ink-soft)]">Summary</dt>
                      <dd className="text-[color:var(--ink)]">{verification.summary}</dd>
                    </div>
                  ) : null}
                  {verification.sourceRepo
                    ? (() => {
                        const raw = verification.sourceRepo;
                        const href = /^https?:\/\//.test(raw) ? raw : `https://github.com/${raw}`;
                        const display = href.replace(/^https?:\/\//, "");
                        return (
                          <div className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0">
                            <dt className="font-semibold text-[color:var(--ink-soft)]">Source</dt>
                            <dd className="text-[color:var(--ink)]">
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex max-w-full flex-wrap items-center gap-1 break-all text-[color:var(--accent)] hover:underline"
                              >
                                {display}
                                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              </a>
                            </dd>
                          </div>
                        );
                      })()
                    : null}
                  {verification.sourceCommit ? (
                    <div className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0">
                      <dt className="font-semibold text-[color:var(--ink-soft)]">Commit</dt>
                      <dd className="min-w-0 break-all font-mono text-xs text-[color:var(--ink)]">
                        {verification.sourceCommit.slice(0, 12)}
                      </dd>
                    </div>
                  ) : null}
                  {verification.sourceTag ? (
                    <div className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0">
                      <dt className="font-semibold text-[color:var(--ink-soft)]">Tag</dt>
                      <dd className="min-w-0 break-all font-mono text-xs text-[color:var(--ink)]">
                        {verification.sourceTag}
                      </dd>
                    </div>
                  ) : null}
                  {verification.hasProvenance !== undefined ? (
                    <div className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0">
                      <dt className="font-semibold text-[color:var(--ink-soft)]">Provenance</dt>
                      <dd className="text-[color:var(--ink)]">
                        {verification.hasProvenance ? "Yes" : "No"}
                      </dd>
                    </div>
                  ) : null}
                  {verification.scanStatus ? (
                    <div className="flex flex-col gap-1.5 last:border-b-0 last:pb-0 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0">
                      <dt className="font-semibold text-[color:var(--ink-soft)]">Scan status</dt>
                      <dd className="text-[color:var(--ink)]">{verification.scanStatus}</dd>
                    </div>
                  ) : null}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {/* Tags */}
          {pkg.tags && Object.keys(pkg.tags).length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-3 text-sm">
                  {Object.entries(pkg.tags).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 last:border-b-0 last:pb-0 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0"
                    >
                      <dt className="font-semibold text-[color:var(--ink-soft)]">{key}</dt>
                      <dd className="min-w-0 break-all font-mono text-xs text-[color:var(--ink)]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ) : null}
        </DetailHero>
      </DetailPageShell>
    </main>
  );
}
