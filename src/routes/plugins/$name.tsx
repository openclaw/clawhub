import { createFileRoute } from "@tanstack/react-router";
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
import { familyLabel, packageCapabilityLabel } from "../../lib/packageLabels";

type PluginDetailLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
  readme: string | null;
};

export const Route = createFileRoute("/plugins/$name")({
  loader: async ({ params }): Promise<PluginDetailLoaderData> => {
    const detail = await fetchPackageDetail(params.name);
    const version =
      detail.package?.latestVersion
        ? await fetchPackageVersion(params.name, detail.package.latestVersion)
        : null;
    const readme = await fetchPackageReadme(params.name, detail.package?.latestVersion);
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
  const latestRelease = version?.version ?? null;
  const installSnippet =
    pkg.family === "code-plugin"
      ? `openclaw plugins install clawhub:${pkg.name}`
      : pkg.family === "bundle-plugin"
        ? `openclaw bundles install clawhub:${pkg.name}`
        : `openclaw skills install ${pkg.name}`;

  return (
    <main className="section">
      <div className="skill-detail-stack">
        <section className="card">
          <div className="skill-card-tags" style={{ marginBottom: 12 }}>
            <span className="tag">{familyLabel(pkg.family)}</span>
            {pkg.capabilities?.executesCode ? (
              <span className="tag tag-accent">
                {packageCapabilityLabel(pkg.family, pkg.capabilities.executesCode)}
              </span>
            ) : null}
            {pkg.isOfficial ? (
              <span className="tag" style={{ background: "rgba(59, 130, 246, 0.15)", color: "#3b82f6" }}>
                <VerifiedBadge />
              </span>
            ) : null}
            {pkg.verification?.tier ? <span className="tag">{pkg.verification.tier}</span> : null}
          </div>
          <h1 className="section-title" style={{ marginBottom: 8 }}>
            {pkg.displayName}
          </h1>
          <p className="section-subtitle" style={{ marginBottom: 12 }}>
            {pkg.summary ?? "No summary provided."}
          </p>
          {pkg.family === "code-plugin" && !pkg.isOfficial ? (
            <div className="tag tag-accent" style={{ marginBottom: 12 }}>
              Community code plugin. Review compatibility and verification before install.
            </div>
          ) : null}
          <div className="skills-row-slug" style={{ marginBottom: 12 }}>
            {pkg.name}
            {pkg.runtimeId ? ` · runtime id ${pkg.runtimeId}` : ""}
          </div>
          <details className="bundle-details" open>
            <summary>Install</summary>
            <pre>
              <code>{installSnippet}</code>
            </pre>
          </details>
          <details className="bundle-details" open>
            <summary>Latest Release</summary>
            <div style={{ display: "grid", gap: 8 }}>
              <div>{pkg.latestVersion ? `Version ${pkg.latestVersion}` : "No latest tag"}</div>
              {pkg.latestVersion ? (
                <div>
                  <a href={getPackageDownloadPath(name, pkg.latestVersion)}>Download zip</a>
                </div>
              ) : null}
            </div>
          </details>
          {latestRelease ? (
            <details className="bundle-details" open>
              <summary>Compatibility</summary>
              <pre>
                <code>{JSON.stringify(latestRelease.compatibility ?? pkg.compatibility ?? {}, null, 2)}</code>
              </pre>
            </details>
          ) : null}
          {latestRelease ? (
            <details className="bundle-details" open>
              <summary>Capabilities</summary>
              <pre>
                <code>{JSON.stringify(latestRelease.capabilities ?? pkg.capabilities ?? {}, null, 2)}</code>
              </pre>
            </details>
          ) : null}
          {latestRelease ? (
            <SecurityScanResults
              sha256hash={latestRelease.sha256hash ?? undefined}
              vtAnalysis={latestRelease.vtAnalysis ?? undefined}
              llmAnalysis={latestRelease.llmAnalysis ?? undefined}
              staticFindings={latestRelease.staticScan?.findings ?? []}
            />
          ) : null}
          <details className="bundle-details" open>
            <summary>Verification</summary>
            <pre>
              <code>{JSON.stringify(latestRelease?.verification ?? pkg.verification ?? {}, null, 2)}</code>
            </pre>
          </details>
          <details className="bundle-details" open>
            <summary>Tags</summary>
            <pre>
              <code>{JSON.stringify(pkg.tags, null, 2)}</code>
            </pre>
          </details>
        </section>

        {readme ? (
          <section className="card">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{readme}</ReactMarkdown>
          </section>
        ) : null}
      </div>
    </main>
  );
}
