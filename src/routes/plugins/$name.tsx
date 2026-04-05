import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink, Copy, Check, Download } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SecurityScanResults } from "../../components/SkillSecurityScanResults";
import {
  fetchPackageDetail,
  fetchPackageReadme,
  fetchPackageVersion,
  getPackageDownloadPath,
  type PackageDetailResponse,
  type PackageVersionDetail,
} from "../../lib/packageApi";
import { familyLabel } from "../../lib/packageLabels";

type PluginDetailLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
  readme: string | null;
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
      const candidateDetail = await fetchPackageDetail(candidateName);
      if (candidateDetail.package) {
        detail = candidateDetail;
        resolvedName = candidateName;
        break;
      }
      detail = candidateDetail;
    }

    const readmePromise = fetchPackageReadme(resolvedName);
    const versionPromise = detail.package?.latestVersion
      ? fetchPackageVersion(resolvedName, detail.package.latestVersion)
      : Promise.resolve(null);
    const [version, readme] = await Promise.all([versionPromise, readmePromise]);
    return { detail, version, readme };
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
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#3b82f6" }}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Verified publisher"
        style={{ flexShrink: 0 }}
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
    <button
      type="button"
      className="btn btn-sm"
      style={{ flexShrink: 0 }}
      onClick={() => {
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(text).then(() => {
            setState("copied");
            setTimeout(() => setState("idle"), 2000);
          }).catch(() => {
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
    </button>
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
  const { detail, version, readme } = Route.useLoaderData() as PluginDetailLoaderData;

  if (!detail.package) {
    return (
      <main className="section">
        <div className="card">Plugin not found.</div>
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
        ([, v]) => v !== undefined && v !== null && v !== false && !(Array.isArray(v) && v.length === 0),
      )
    : [];

  const compatEntries = compatibility
    ? Object.entries(compatibility).filter(([, v]) => v !== undefined && v !== null)
    : [];

  return (
    <main className="section">
      <div className="skill-detail-stack">
        {/* Header card */}
        <section className="card">
          <div className="plugin-detail-header">
            <div className="plugin-detail-meta">
              <div className="skill-card-tags" style={{ marginBottom: 8 }}>
                <span className="tag">{familyLabel(pkg.family)}</span>
                {verification?.tier ? (
                  <span className="tag tag-compact">{verification.tier.replace(/-/g, " ")}</span>
                ) : null}
                {pkg.isOfficial ? (
                  <span className="tag" style={{ background: "rgba(59, 130, 246, 0.15)", color: "#3b82f6" }}>
                    <VerifiedBadge />
                  </span>
                ) : null}
              </div>
              <h1 className="section-title" style={{ marginBottom: 4 }}>
                {pkg.displayName}
                {pkg.latestVersion ? (
                  <span className="plugin-version-badge">v{pkg.latestVersion}</span>
                ) : null}
              </h1>
              <p className="section-subtitle" style={{ marginBottom: 8 }}>
                {pkg.summary ?? "No summary provided."}
              </p>
              <div className="plugin-meta-row">
                <span className="mono" style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>
                  {pkg.name}
                </span>
                {pkg.runtimeId ? (
                  <>
                    <span style={{ color: "var(--ink-soft)", opacity: 0.4 }}>·</span>
                    <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>
                      runtime <span className="mono">{pkg.runtimeId}</span>
                    </span>
                  </>
                ) : null}
                {owner?.handle ? (
                  <>
                    <span style={{ color: "var(--ink-soft)", opacity: 0.4 }}>·</span>
                    <Link
                      to="/u/$handle"
                      params={{ handle: owner.handle }}
                      className="plugin-meta-link"
                    >
                      by @{owner.handle}
                    </Link>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {pkg.family === "code-plugin" && !pkg.isOfficial ? (
            <div className="tag tag-accent" style={{ marginTop: 12 }}>
              Community code plugin. Review compatibility and verification before install.
            </div>
          ) : null}

          {/* Install */}
          <div className="plugin-install-section">
            <div className="plugin-install-bar">
              <pre className="plugin-install-code"><code>{installSnippet}</code></pre>
              <CopyButton text={installSnippet} />
            </div>
          </div>

          {/* Latest Release */}
          {pkg.latestVersion ? (
            <div className="plugin-release-row">
              <span style={{ fontSize: "0.88rem" }}>
                Latest release: <strong>v{pkg.latestVersion}</strong>
              </span>
              <a
                href={getPackageDownloadPath(name, pkg.latestVersion)}
                className="btn btn-sm"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Download zip
              </a>
            </div>
          ) : null}
        </section>

        {/* Capabilities */}
        {capEntries.length > 0 ? (
          <section className="card">
            <div className="plugin-section-header">
              <h2 className="plugin-section-title">Capabilities</h2>
              <CopyButton text={JSON.stringify(capabilities, null, 2)} />
            </div>
            <div className="plugin-kv-grid">
              {capEntries.map(([key, value]) => (
                <div key={key} className="plugin-kv-row">
                  <dt className="plugin-kv-label">{CAPABILITY_LABELS[key] ?? key}</dt>
                  <dd className="plugin-kv-value">
                    {key === "capabilityTags" && Array.isArray(value) ? (
                      <div className="plugin-tag-list">
                        {(value as string[]).map((tag) => (
                          <Link
                            key={tag}
                            to="/plugins"
                            search={{ q: tag }}
                            className="tag tag-compact"
                          >
                            {tag}
                          </Link>
                        ))}
                      </div>
                    ) : key === "hostTargets" && Array.isArray(value) ? (
                      <div className="plugin-tag-list">
                        {(value as string[]).map((target) => (
                          <span key={target} className="tag tag-compact">{target}</span>
                        ))}
                      </div>
                    ) : (
                      formatCapabilityValue(value)
                    )}
                  </dd>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Compatibility */}
        {compatEntries.length > 0 ? (
          <section className="card">
            <div className="plugin-section-header">
              <h2 className="plugin-section-title">Compatibility</h2>
              <CopyButton text={JSON.stringify(compatibility, null, 2)} />
            </div>
            <div className="plugin-kv-grid">
              {compatEntries.map(([key, value]) => (
                <div key={key} className="plugin-kv-row">
                  <dt className="plugin-kv-label">
                    {key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                  </dt>
                  <dd className="plugin-kv-value mono">{String(value)}</dd>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Security Scan */}
        {latestRelease ? (
          <section className="card">
            <SecurityScanResults
              sha256hash={latestRelease.sha256hash ?? undefined}
              vtAnalysis={latestRelease.vtAnalysis ?? undefined}
              llmAnalysis={latestRelease.llmAnalysis ?? undefined}
              staticFindings={latestRelease.staticScan?.findings ?? []}
            />
          </section>
        ) : null}

        {/* Verification */}
        {verification && !isEmptyObject(verification) ? (
          <section className="card">
            <div className="plugin-section-header">
              <h2 className="plugin-section-title">Verification</h2>
            </div>
            <div className="plugin-kv-grid">
              {verification.tier ? (
                <div className="plugin-kv-row">
                  <dt className="plugin-kv-label">Tier</dt>
                  <dd className="plugin-kv-value">{verification.tier.replace(/-/g, " ")}</dd>
                </div>
              ) : null}
              {verification.scope ? (
                <div className="plugin-kv-row">
                  <dt className="plugin-kv-label">Scope</dt>
                  <dd className="plugin-kv-value">{verification.scope.replace(/-/g, " ")}</dd>
                </div>
              ) : null}
              {verification.summary ? (
                <div className="plugin-kv-row">
                  <dt className="plugin-kv-label">Summary</dt>
                  <dd className="plugin-kv-value">{verification.summary}</dd>
                </div>
              ) : null}
              {verification.sourceRepo ? (() => {
                const raw = verification.sourceRepo;
                const href = /^https?:\/\//.test(raw) ? raw : `https://github.com/${raw}`;
                const display = href.replace(/^https?:\/\//, "");
                return (
                  <div className="plugin-kv-row">
                    <dt className="plugin-kv-label">Source</dt>
                    <dd className="plugin-kv-value">
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="plugin-external-link"
                      >
                        {display}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </dd>
                  </div>
                );
              })() : null}
              {verification.sourceCommit ? (
                <div className="plugin-kv-row">
                  <dt className="plugin-kv-label">Commit</dt>
                  <dd className="plugin-kv-value mono">{verification.sourceCommit.slice(0, 12)}</dd>
                </div>
              ) : null}
              {verification.sourceTag ? (
                <div className="plugin-kv-row">
                  <dt className="plugin-kv-label">Tag</dt>
                  <dd className="plugin-kv-value mono">{verification.sourceTag}</dd>
                </div>
              ) : null}
              {verification.hasProvenance !== undefined ? (
                <div className="plugin-kv-row">
                  <dt className="plugin-kv-label">Provenance</dt>
                  <dd className="plugin-kv-value">{verification.hasProvenance ? "Yes" : "No"}</dd>
                </div>
              ) : null}
              {verification.scanStatus ? (
                <div className="plugin-kv-row">
                  <dt className="plugin-kv-label">Scan status</dt>
                  <dd className="plugin-kv-value">{verification.scanStatus}</dd>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Tags */}
        {pkg.tags && Object.keys(pkg.tags).length > 0 ? (
          <section className="card">
            <h2 className="plugin-section-title">Tags</h2>
            <div className="plugin-kv-grid">
              {Object.entries(pkg.tags).map(([key, value]) => (
                <div key={key} className="plugin-kv-row">
                  <dt className="plugin-kv-label">{key}</dt>
                  <dd className="plugin-kv-value mono">{value}</dd>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Readme */}
        {readme ? (
          <section className="card markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{readme}</ReactMarkdown>
          </section>
        ) : null}
      </div>
    </main>
  );
}
