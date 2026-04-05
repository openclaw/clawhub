import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ExternalLink, Copy, Check, Download } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Container } from "../../components/layout/Container";
import { MarkdownPreview } from "../../components/MarkdownPreview";
import { SecurityScanResults } from "../../components/SkillSecurityScanResults";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
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

type PluginDetailRateLimitState =
  | {
      scope: "detail" | "metadata";
      retryAfterSeconds: number | null;
    }
  | null;

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
      return {
        detail,
        version: null,
        readme: null,
        rateLimited: null,
      };
    }

    let metadataRateLimited: PluginDetailRateLimitState = null;
    const readmePromise = fetchPackageReadme(resolvedName).catch((error: unknown) => {
      if (!isRateLimitedPackageApiError(error)) throw error;
      metadataRateLimited ??= {
        scope: "metadata",
        retryAfterSeconds: error.retryAfterSeconds,
      };
      return null;
    });
    const versionPromise = detail.package?.latestVersion
      ? fetchPackageVersion(resolvedName, detail.package.latestVersion).catch((error: unknown) => {
          if (!isRateLimitedPackageApiError(error)) throw error;
          metadataRateLimited ??= {
            scope: "metadata",
            retryAfterSeconds: error.retryAfterSeconds,
          };
          return null;
        })
      : Promise.resolve(null);
    const [version, readme] = await Promise.all([versionPromise, readmePromise]);
    return { detail, version, readme, rateLimited: metadataRateLimited };
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

function fallbackCopy(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const ok = document.execCommand("copy");
    return ok;
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full shrink-0 sm:w-auto"
      onClick={() => {
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard
            .writeText(text)
            .then(() => {
              setState("copied");
              setTimeout(() => setState("idle"), 2000);
            })
            .catch(() => {
              if (fallbackCopy(text)) {
                setState("copied");
                setTimeout(() => setState("idle"), 2000);
              } else {
                setState("failed");
                setTimeout(() => setState("idle"), 2000);
              }
            });
        } else if (fallbackCopy(text)) {
          setState("copied");
          setTimeout(() => setState("idle"), 2000);
        } else {
          setState("failed");
          setTimeout(() => setState("idle"), 2000);
        }
      }}
      aria-label="Copy to clipboard"
    >
      {state === "copied" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {state === "copied" ? "Copied" : state === "failed" ? "Failed" : "Copy"}
    </Button>
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
  const installSnippet =
    pkg.family === "code-plugin"
      ? `openclaw plugins install clawhub:${pkg.name}`
      : pkg.family === "bundle-plugin"
        ? `openclaw bundles install clawhub:${pkg.name}`
        : `openclaw skills install ${pkg.name}`;

  const capabilities = latestRelease?.capabilities ?? pkg.capabilities;
  const compatibility = latestRelease?.compatibility ?? pkg.compatibility;
  const verification = latestRelease?.verification ?? pkg.verification;

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
    <main className="py-10">
      <Container>
        <div className="flex flex-col gap-5">
          {/* Header card */}
          <Card>
            <CardContent>
              <div className="flex flex-wrap gap-1.5 mb-2">
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
              </div>
              <h1 className="font-display text-2xl font-bold text-[color:var(--ink)] mb-1">
                {pkg.displayName}
                {pkg.latestVersion ? (
                  <span className="ml-2 inline-block rounded-[var(--radius-pill)] bg-[color:var(--surface-muted)] px-2 py-0.5 text-xs font-semibold text-[color:var(--ink-soft)]">
                    v{pkg.latestVersion}
                  </span>
                ) : null}
              </h1>
              <p className="text-sm text-[color:var(--ink-soft)] mb-2">
                {pkg.summary ?? "No summary provided."}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-sm text-[color:var(--ink-soft)]">
                <span className="font-mono text-xs">{pkg.name}</span>
                {pkg.runtimeId ? (
                  <>
                    <span className="opacity-40">&middot;</span>
                    <span>
                      runtime <span className="font-mono text-xs">{pkg.runtimeId}</span>
                    </span>
                  </>
                ) : null}
                {owner?.handle ? (
                  <>
                    <span className="opacity-40">&middot;</span>
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

              {pkg.family === "code-plugin" && !pkg.isOfficial ? (
                <Badge variant="accent" className="mt-3 self-start">
                  Community code plugin. Review compatibility and verification before install.
                </Badge>
              ) : null}

              {/* Install */}
              <div className="mt-4">
                <div className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-3 sm:flex-row sm:items-center sm:gap-2">
                  <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs text-[color:var(--ink)]">
                    <code>{installSnippet}</code>
                  </pre>
                  <CopyButton text={installSnippet} />
                </div>
              </div>

              {/* Latest Release */}
              {pkg.latestVersion ? (
                <div className="mt-3 flex flex-col gap-3 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-2">
                  <span className="text-sm">
                    Latest release: <strong>v{pkg.latestVersion}</strong>
                  </span>
                  <a
                    href={getPackageDownloadPath(name, pkg.latestVersion)}
                    className="inline-flex min-h-[34px] w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] border border-[color:var(--border-ui)] bg-transparent px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)] transition-all duration-200 no-underline hover:border-[color:var(--border-ui-hover)] hover:bg-[color:var(--surface)] sm:w-auto sm:whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Download zip
                  </a>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Capabilities */}
          {capEntries.length > 0 ? (
            <Card>
              <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Capabilities</CardTitle>
                <CopyButton text={JSON.stringify(capabilities, null, 2)} />
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-3 text-sm">
                  {capEntries.map(([key, value]) => (
                    <div key={key} className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 last:border-b-0 last:pb-0 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0">
                      <dt className="font-semibold text-[color:var(--ink-soft)] sm:pr-2">
                        {CAPABILITY_LABELS[key] ?? key}
                      </dt>
                      <dd className="text-[color:var(--ink)]">
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
                <CopyButton text={JSON.stringify(compatibility, null, 2)} />
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-3 text-sm">
                  {compatEntries.map(([key, value]) => (
                    <div key={key} className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 last:border-b-0 last:pb-0 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0">
                      <dt className="font-semibold text-[color:var(--ink-soft)] sm:pr-2">
                        {key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                      </dt>
                      <dd className="font-mono text-xs text-[color:var(--ink)]">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {/* Security Scan */}
          {latestRelease ? (
            <Card>
              <CardContent>
                <SecurityScanResults
                  sha256hash={latestRelease.sha256hash ?? undefined}
                  vtAnalysis={latestRelease.vtAnalysis ?? undefined}
                  llmAnalysis={latestRelease.llmAnalysis ?? undefined}
                  staticFindings={latestRelease.staticScan?.findings ?? []}
                />
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
                                className="inline-flex items-center gap-1 text-[color:var(--accent)] hover:underline"
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
                      <dd className="font-mono text-xs text-[color:var(--ink)]">
                        {verification.sourceCommit.slice(0, 12)}
                      </dd>
                    </div>
                  ) : null}
                  {verification.sourceTag ? (
                    <div className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0">
                      <dt className="font-semibold text-[color:var(--ink-soft)]">Tag</dt>
                      <dd className="font-mono text-xs text-[color:var(--ink)]">
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
                    <div key={key} className="flex flex-col gap-1.5 border-b border-[color:var(--line)] pb-3 last:border-b-0 last:pb-0 sm:grid sm:grid-cols-[minmax(140px,220px)_1fr] sm:gap-x-4 sm:gap-y-0">
                      <dt className="font-semibold text-[color:var(--ink-soft)]">{key}</dt>
                      <dd className="font-mono text-xs text-[color:var(--ink)]">{value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {/* Readme */}
          {readme ? (
            <Card>
              <CardContent>
                <MarkdownPreview>{readme}</MarkdownPreview>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </Container>
    </main>
  );
}
