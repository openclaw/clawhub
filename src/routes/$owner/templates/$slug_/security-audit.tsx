import { createFileRoute, notFound, redirect, useRouter } from "@tanstack/react-router";
import {
  SecurityAuditPage,
  SecurityAuditPageSkeleton,
} from "../../../../components/SecurityAuditPage";
import {
  fetchPackageVersion,
  isRateLimitedPackageApiError,
  type PackageDetailResponse,
  type PackageVersionDetail,
} from "../../../../lib/packageApi";
import { loadTemplatePackage } from "../../../../lib/templatePackage";
import {
  buildTemplateDetailHref,
  buildTemplateSecurityAuditHref,
} from "../../../../lib/templateRoutes";

type TemplateAuditData = {
  detail: PackageDetailResponse | null;
  release: NonNullable<PackageVersionDetail["version"]> | null;
  rateLimited: boolean;
};
export function parseTemplateAuditSearch(search: Record<string, unknown>) {
  const version = typeof search.version === "string" ? search.version.trim() : "";
  return version ? { version } : {};
}
export async function loadTemplateSecurityAudit(
  params: { owner: string; slug: string },
  version?: string,
): Promise<TemplateAuditData> {
  try {
    const detail = await loadTemplatePackage(params);
    const name = detail.package!.name;
    const selectedVersion = version ?? detail.package!.latestVersion;
    if (!selectedVersion) return { detail, release: null, rateLimited: false };
    const result = await fetchPackageVersion(name, selectedVersion);
    // An exact-version read must never silently substitute another artifact or family.
    if (
      !result?.version ||
      result.version.version !== selectedVersion ||
      (result.package && (result.package.name !== name || result.package.family !== "template"))
    )
      throw notFound();
    return { detail, release: result.version, rateLimited: false };
  } catch (error) {
    if (isRateLimitedPackageApiError(error))
      return { detail: null, release: null, rateLimited: true };
    throw error;
  }
}
export const Route = createFileRoute("/$owner/templates/$slug_/security-audit")({
  validateSearch: parseTemplateAuditSearch,
  loaderDeps: ({ search }) => ({ version: search.version }),
  loader: async ({ params, deps }) => {
    const data = await loadTemplateSecurityAudit(params, deps.version);
    const pkg = data.detail?.package;
    if (pkg) {
      const canonical = buildTemplateSecurityAuditHref(
        pkg.name,
        data.detail?.owner?.handle,
        deps.version,
      )!;
      const requested =
        "/" +
        params.owner +
        "/templates/" +
        encodeURIComponent(params.slug) +
        "/security-audit" +
        (deps.version ? "?" + new URLSearchParams({ version: deps.version }) : "");
      if (canonical !== requested) throw redirect({ href: canonical, replace: true });
    }
    return data;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: "Security audit · " + (loaderData?.detail?.package?.displayName ?? "Template") },
    ],
  }),
  pendingComponent: SecurityAuditPageSkeleton,
  errorComponent: TemplateAuditError,
  notFoundComponent: () => (
    <main className="section">
      <div className="card">Template or requested release not found.</div>
    </main>
  ),
  component: TemplateAuditRoute,
});
function TemplateAuditError() {
  const router = useRouter();
  return (
    <main className="section">
      <div className="card" role="alert">
        Could not load this Template security audit.{" "}
        <button type="button" onClick={() => void router.invalidate()}>
          Try again
        </button>
      </div>
    </main>
  );
}
function TemplateAuditRoute() {
  return <TemplateSecurityAuditPage data={Route.useLoaderData()} />;
}
export function TemplateSecurityAuditPage({ data }: { data: TemplateAuditData }) {
  if (data.rateLimited)
    return (
      <main className="section">
        <div className="card" role="status">
          Template security audit is temporarily rate limited. Please try again shortly.
        </div>
      </main>
    );
  const pkg = data.detail?.package;
  if (!pkg || !data.release)
    return (
      <main className="section">
        <div className="card">No published release is available for this Template.</div>
      </main>
    );
  const release = data.release;
  return (
    <SecurityAuditPage
      entity={{
        kind: "template",
        title: pkg.displayName,
        name: pkg.name,
        version: release.version,
        owner: data.detail?.owner,
        detailPath: buildTemplateDetailHref(pkg.name, data.detail?.owner?.handle)!,
      }}
      sha256hash={release.artifact?.sha256 ?? release.sha256hash}
      aigAnalysis={release.aigAnalysis}
      llmAnalysis={release.llmAnalysis}
      skillSpectorAnalysis={release.skillSpectorAnalysis}
    />
  );
}
