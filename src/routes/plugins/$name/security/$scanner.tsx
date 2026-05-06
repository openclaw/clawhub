import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { SecurityScannerPage, type ScannerSlug } from "../../../../components/SecurityScannerPage";
import { getOpenClawPackageCandidateNames } from "../../../../lib/openClawExtensionSlugs";
import {
  fetchPackageDetail,
  fetchPackageVersion,
  isRateLimitedPackageApiError,
  type PackageDetailResponse,
  type PackageVersionDetail,
} from "../../../../lib/packageApi";
import {
  buildPluginDetailHref,
  buildPluginSecurityHref,
  parseScopedPackageName,
} from "../../../../lib/pluginRoutes";

const SCANNERS = new Set<ScannerSlug>(["virustotal", "openclaw", "static-analysis"]);

export type PluginSecurityLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
  resolvedName: string;
  rateLimited: boolean;
};

export function parsePluginSecurityScanner(scanner: string): ScannerSlug {
  if (SCANNERS.has(scanner as ScannerSlug)) return scanner as ScannerSlug;
  throw notFound();
}

export async function loadPluginSecurity(requestedName: string): Promise<PluginSecurityLoaderData> {
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

  if (!detail.package?.latestVersion) {
    return { detail, version: null, resolvedName, rateLimited: false };
  }

  try {
    const version = await fetchPackageVersion(resolvedName, detail.package.latestVersion);
    return { detail, version, resolvedName, rateLimited: false };
  } catch (error) {
    if (isRateLimitedPackageApiError(error)) {
      return { detail, version: null, resolvedName, rateLimited: true };
    }
    throw error;
  }
}

export function pluginSecurityHead(
  name: string,
  scannerParam: string,
  loaderData?: PluginSecurityLoaderData,
) {
  const scanner = parsePluginSecurityScanner(scannerParam);
  const scannerLabel =
    scanner === "virustotal"
      ? "VirusTotal"
      : scanner === "openclaw"
        ? "ClawScan"
        : "Static analysis";
  return {
    meta: [
      {
        title: `${scannerLabel} security · ${loaderData?.detail.package?.displayName ?? name}`,
      },
      {
        name: "description",
        content: `${scannerLabel} security details for ${
          loaderData?.detail.package?.displayName ?? name
        }.`,
      },
    ],
  };
}

export const Route = createFileRoute("/plugins/$name/security/$scanner")({
  beforeLoad: ({ params }) => {
    parsePluginSecurityScanner(params.scanner);
    if (parseScopedPackageName(params.name)) {
      throw redirect({
        href: buildPluginSecurityHref(params.name, params.scanner),
        statusCode: 308,
      });
    }
  },
  loader: async ({ params }) => loadPluginSecurity(params.name),
  head: ({ params, loaderData }) => pluginSecurityHead(params.name, params.scanner, loaderData),
  component: PluginSecurityScannerRoute,
});

function PluginSecurityScannerRoute() {
  const { name, scanner } = Route.useParams();
  return (
    <PluginSecurityScannerPage
      name={name}
      scanner={scanner}
      loaderData={Route.useLoaderData() as PluginSecurityLoaderData}
    />
  );
}

export function PluginSecurityScannerPage({
  name,
  scanner,
  loaderData,
}: {
  name: string;
  scanner: string;
  loaderData: PluginSecurityLoaderData;
}) {
  const { detail, version, resolvedName, rateLimited } = loaderData;
  const pkg = detail.package;
  const release = version?.version ?? null;

  if (rateLimited) {
    return (
      <main className="section">
        <div className="card">Plugin security details are temporarily unavailable.</div>
      </main>
    );
  }

  if (!pkg || !release) {
    return (
      <main className="section">
        <div className="card">Security details are unavailable for this plugin.</div>
      </main>
    );
  }

  return (
    <SecurityScannerPage
      scanner={parsePluginSecurityScanner(scanner)}
      entity={{
        kind: "plugin",
        title: pkg.displayName,
        name: resolvedName,
        version: release.version,
        owner: detail.owner ?? null,
        ownerUserId: null,
        ownerPublisherId: null,
        detailPath: buildPluginDetailHref(name),
      }}
      sha256hash={release.sha256hash ?? null}
      vtAnalysis={release.vtAnalysis ?? null}
      llmAnalysis={release.llmAnalysis ?? null}
      staticScan={release.staticScan ?? null}
    />
  );
}
