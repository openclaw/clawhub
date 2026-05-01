import { createFileRoute, notFound } from "@tanstack/react-router";
import { SecurityScannerPage, type ScannerSlug } from "../../../../components/SecurityScannerPage";
import {
  fetchPackageDetail,
  fetchPackageVersion,
  isRateLimitedPackageApiError,
  type PackageDetailResponse,
  type PackageVersionDetail,
} from "../../../../lib/packageApi";

const SCANNERS = new Set<ScannerSlug>(["virustotal", "openclaw", "static-analysis"]);

type PluginSecurityLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
  resolvedName: string;
  rateLimited: boolean;
};

function parseScanner(scanner: string): ScannerSlug {
  if (SCANNERS.has(scanner as ScannerSlug)) return scanner as ScannerSlug;
  throw notFound();
}

export const Route = createFileRoute("/plugins/$name/security/$scanner")({
  beforeLoad: ({ params }) => {
    parseScanner(params.scanner);
  },
  loader: async ({ params }): Promise<PluginSecurityLoaderData> => {
    const requestedName = params.name;
    const candidateNames = requestedName.includes("/")
      ? [requestedName]
      : [requestedName, `@openclaw/${requestedName}`];

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
  },
  head: ({ params, loaderData }) => {
    const scanner = parseScanner(params.scanner);
    const scannerLabel =
      scanner === "virustotal"
        ? "VirusTotal"
        : scanner === "openclaw"
          ? "ClawScan"
          : "Static analysis";
    return {
      meta: [
        {
          title: `${scannerLabel} security · ${
            loaderData?.detail.package?.displayName ?? params.name
          }`,
        },
        {
          name: "description",
          content: `${scannerLabel} security details for ${
            loaderData?.detail.package?.displayName ?? params.name
          }.`,
        },
      ],
    };
  },
  component: PluginSecurityScannerRoute,
});

function PluginSecurityScannerRoute() {
  const { name, scanner } = Route.useParams();
  const { detail, version, resolvedName, rateLimited } = Route.useLoaderData();
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
      scanner={parseScanner(scanner)}
      entity={{
        kind: "plugin",
        title: pkg.displayName,
        name: resolvedName,
        version: release.version,
        owner: detail.owner ?? null,
        ownerUserId: null,
        ownerPublisherId: null,
        detailPath: `/plugins/${encodeURIComponent(name)}`,
      }}
      sha256hash={release.sha256hash ?? null}
      vtAnalysis={release.vtAnalysis ?? null}
      llmAnalysis={release.llmAnalysis ?? null}
      staticScan={release.staticScan ?? null}
    />
  );
}
