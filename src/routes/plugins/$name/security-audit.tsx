import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { SecurityAuditPage } from "../../../components/SecurityAuditPage";
import { getOpenClawPackageCandidateNames } from "../../../lib/openClawExtensionSlugs";
import {
  fetchPackageDetail,
  fetchPackageVersion,
  isRateLimitedPackageApiError,
  type PackageDetailResponse,
  type PackageVersionDetail,
} from "../../../lib/packageApi";
import {
  buildPluginDetailHref,
  buildPluginSecurityAuditHref,
  parseScopedPackageName,
} from "../../../lib/pluginRoutes";

export type PluginSecurityAuditLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
  resolvedName: string;
  rateLimited: boolean;
};

export function parsePluginSecurityAuditSearch(search: Record<string, unknown>) {
  const version = typeof search.version === "string" ? search.version.trim() : "";
  return version ? { version } : {};
}

export async function loadPluginSecurityAudit(
  requestedName: string,
  requestedVersion?: string,
): Promise<PluginSecurityAuditLoaderData> {
  const candidateNames = getOpenClawPackageCandidateNames(requestedName);

  let resolvedName = requestedName;
  let detail: PackageDetailResponse = { package: null, owner: null };

  for (const candidateName of candidateNames) {
    try {
      const candidateDetail = await fetchPackageDetail(candidateName);
      if (candidateDetail.package) {
        detail = candidateDetail;
        resolvedName = candidateName;
        break;
      }
      detail = candidateDetail;
    } catch (error) {
      if (isRateLimitedPackageApiError(error)) {
        return { detail, version: null, resolvedName, rateLimited: true };
      }
      throw error;
    }
  }

  const versionToLoad = requestedVersion ?? detail.package?.latestVersion;
  if (!versionToLoad) {
    return { detail, version: null, resolvedName, rateLimited: false };
  }

  try {
    const version = await fetchPackageVersion(resolvedName, versionToLoad);
    return { detail, version, resolvedName, rateLimited: false };
  } catch (error) {
    if (isRateLimitedPackageApiError(error)) {
      return { detail, version: null, resolvedName, rateLimited: true };
    }
    throw error;
  }
}

export function pluginSecurityAuditHead(name: string, loaderData?: PluginSecurityAuditLoaderData) {
  return {
    meta: [
      {
        title: `Security audit · ${loaderData?.detail.package?.displayName ?? name}`,
      },
      {
        name: "description",
        content: `Security audit details for ${loaderData?.detail.package?.displayName ?? name}.`,
      },
    ],
  };
}

export const Route = createFileRoute("/plugins/$name/security-audit")({
  validateSearch: parsePluginSecurityAuditSearch,
  loaderDeps: ({ search }) => ({ version: search.version }),
  beforeLoad: ({ params, search }) => {
    if (parseScopedPackageName(params.name)) {
      throw redirect({
        href: buildPluginSecurityAuditHref(params.name, { version: search.version }),
        statusCode: 308,
      });
    }
  },
  loader: async ({ params, deps }) => {
    const data = await loadPluginSecurityAudit(params.name, deps.version);
    const ownerHandle = data.detail.owner?.handle ?? null;
    const packageName = data.detail.package?.name ?? null;

    if (packageName && ownerHandle) {
      throw redirect({
        href: buildPluginSecurityAuditHref(packageName, {
          ownerHandle,
          version: deps.version,
        }),
        replace: true,
      });
    }

    return data;
  },
  head: ({ params, loaderData }) => pluginSecurityAuditHead(params.name, loaderData),
  component: PluginSecurityAuditRoute,
});

function PluginSecurityAuditRoute() {
  const { name } = Route.useParams();
  return (
    <PluginSecurityAuditPage
      name={name}
      loaderData={Route.useLoaderData() as PluginSecurityAuditLoaderData}
    />
  );
}

export function PluginSecurityAuditPage({
  name,
  loaderData,
}: {
  name: string;
  loaderData: PluginSecurityAuditLoaderData;
}) {
  const { detail, version, resolvedName, rateLimited } = loaderData;
  const pkg = detail.package;
  const release = version?.version ?? null;
  const requestPackageRescan = useMutation(api.securityScan.requestPackageRescan);
  const manageContext = useQuery(api.packages.getManageContext, {
    name: resolvedName,
    candidateNames: getOpenClawPackageCandidateNames(name),
  });

  if (rateLimited) {
    return (
      <main className="section">
        <div className="card">Plugin security audit is temporarily unavailable.</div>
      </main>
    );
  }

  if (!pkg || !release) {
    return (
      <main className="section">
        <div className="card">Security audit is unavailable for this plugin.</div>
      </main>
    );
  }

  return (
    <SecurityAuditPage
      entity={{
        kind: "plugin",
        title: pkg.displayName,
        name: resolvedName,
        version: release.version,
        owner: detail.owner ?? null,
        ownerUserId: null,
        ownerPublisherId: null,
        detailPath: buildPluginDetailHref(name, { ownerHandle: detail.owner?.handle }),
      }}
      sha256hash={release.artifact?.sha256 ?? null}
      vtAnalysis={release.vtAnalysis ?? null}
      aigAnalysis={release.aigAnalysis ?? null}
      llmAnalysis={release.llmAnalysis ?? null}
      skillSpectorAnalysis={release.skillSpectorAnalysis ?? null}
      skillSpectorApplicable={
        release.pluginManifestSummary
          ? release.pluginManifestSummary.bundledSkills.length > 0
          : true
      }
      staticScan={release.staticScan ?? null}
      canManageArtifact={Boolean(manageContext)}
      onRequestRescan={
        manageContext
          ? () =>
              requestPackageRescan({
                packageId: manageContext.package._id,
                version: release.version,
              })
          : null
      }
    />
  );
}
