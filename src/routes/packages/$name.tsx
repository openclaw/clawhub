import { createFileRoute } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  fetchPackageDetail,
  fetchPackageReadme,
  fetchPackageVersion,
  getPackageDownloadPath,
  type PackageDetailResponse,
  type PackageVersionDetail,
} from "../../lib/packageApi";
import { familyLabel, packageCapabilityLabel } from "../../lib/packageLabels";

type PackageDetailLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
  readme: string | null;
};

export const Route = createFileRoute("/packages/$name")({
  loader: async ({ params }): Promise<PackageDetailLoaderData> => {
    const detail = await fetchPackageDetail(params.name);
    const version = detail.package?.latestVersion
      ? await fetchPackageVersion(params.name, detail.package.latestVersion)
      : null;
    const readme = await fetchPackageReadme(params.name, detail.package?.latestVersion);
    return { detail, version, readme };
  },
  head: ({ params, loaderData }) => ({
    meta: [
      {
        title: loaderData?.detail.package?.displayName
          ? `${loaderData.detail.package.displayName} · Packages`
          : params.name,
      },
      {
        name: "description",
        content: loaderData?.detail.package?.summary ?? `Package ${params.name}`,
      },
    ],
  }),
  component: PackageDetailRoute,
});

function PackageDetailRoute() {
  const { name } = Route.useParams();
  const { detail, version, readme } = Route.useLoaderData() as PackageDetailLoaderData;

  if (!detail.package) {
    return (
      <main className="section">
        <div className="card">Package not found.</div>
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
            <span className={`tag ${pkg.capabilities?.executesCode ? "tag-accent" : ""}`}>
              {packageCapabilityLabel(pkg.family, pkg.capabilities?.executesCode)}
            </span>
            <span className="tag">{pkg.channel}</span>
            {pkg.isOfficial ? <span className="tag">Official</span> : null}
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
                <code>
                  {JSON.stringify(latestRelease.compatibility ?? pkg.compatibility ?? {}, null, 2)}
                </code>
              </pre>
            </details>
          ) : null}
          {latestRelease ? (
            <details className="bundle-details" open>
              <summary>Capabilities</summary>
              <pre>
                <code>
                  {JSON.stringify(latestRelease.capabilities ?? pkg.capabilities ?? {}, null, 2)}
                </code>
              </pre>
            </details>
          ) : null}
          <details className="bundle-details" open>
            <summary>Verification</summary>
            <pre>
              <code>
                {JSON.stringify(latestRelease?.verification ?? pkg.verification ?? {}, null, 2)}
              </code>
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
