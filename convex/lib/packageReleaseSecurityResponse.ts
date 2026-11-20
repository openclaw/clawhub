import { formatSecurityAuditOverview, aggregateAuditVerdict } from "clawhub-schema/securityAudit";
import { getPackageReleaseArtifactSha256 } from "./packageArtifacts";
import type { PublicPackageDocLike, ReleaseLike } from "./packageReadProjection";
import {
  getPackageDownloadSecurityBlock,
  getPackageTrustReasons,
  resolvePackageReleaseScanStatus,
} from "./packageSecurity";
import { publicApiOrigin } from "./publicApiOrigin";
import { toPublicPackageFamily } from "./templateStorage";

export function toPackageReleaseSecurityResponse(params: {
  request: Request;
  pkg: PublicPackageDocLike;
  release: Pick<
    ReleaseLike,
    | "_id"
    | "version"
    | "createdAt"
    | "artifactKind"
    | "clawpackSha256"
    | "npmIntegrity"
    | "npmShasum"
    | "npmTarballName"
    | "llmAnalysis"
    | "verification"
    | "manualModeration"
    | "sha256hash"
    | "endorAnalysis"
  >;
  ownerHandle?: string | null;
}) {
  const scanStatus = resolvePackageReleaseScanStatus(params.release);
  const artifactSha256 = getPackageReleaseArtifactSha256(params.release);
  const packageBlockedFromDownload = params.pkg.publicDownloadBlocked === true;
  const reasons = getPackageTrustReasons(params.release, scanStatus);
  if (packageBlockedFromDownload) reasons.push("package:malicious");
  return {
    overview: formatSecurityAuditOverview({ llmAnalysis: params.release.llmAnalysis }),
    verdict: aggregateAuditVerdict(params.release),
    securityAuditUrl: buildPackageSecurityAuditUrl(params.request, {
      name: params.pkg.name,
      family: toPublicPackageFamily(params.pkg.family),
      ownerHandle: params.ownerHandle,
      version: params.release.version,
    }),
    package: {
      name: params.pkg.name,
      displayName: params.pkg.displayName,
      family: toPublicPackageFamily(params.pkg.family),
    },
    release: {
      releaseId: params.release._id,
      version: params.release.version,
      artifactKind: params.release.artifactKind ?? null,
      ...(artifactSha256 ? { artifactSha256 } : {}),
      ...(params.release.npmIntegrity ? { npmIntegrity: params.release.npmIntegrity } : {}),
      ...(params.release.npmShasum ? { npmShasum: params.release.npmShasum } : {}),
      ...(params.release.npmTarballName ? { npmTarballName: params.release.npmTarballName } : {}),
      createdAt: params.release.createdAt,
      ...(params.release.endorAnalysis ? { endorAnalysis: params.release.endorAnalysis } : {}),
    },
    trust: {
      scanStatus,
      moderationState: params.release.manualModeration?.state ?? null,
      blockedFromDownload:
        packageBlockedFromDownload || getPackageDownloadSecurityBlock(params.release) !== null,
      reasons,
      pending: scanStatus === "pending" || scanStatus === "not-run",
      // Staleness came only from retired VirusTotal telemetry; kept for API shape.
      stale: false,
    },
  };
}

function buildPackageSecurityAuditUrl(
  request: Request,
  pkg: {
    name: string;
    family: ReturnType<typeof toPublicPackageFamily>;
    ownerHandle?: string | null;
    version: string;
  },
) {
  const [scope, scopedName] = pkg.name.split("/");
  const scoped =
    scope?.startsWith("@") && scopedName ? { owner: scope.slice(1), slug: scopedName } : null;
  // Templates have their own publisher-scoped audit page; an unscoped Template
  // name needs its owner handle to address it, mirroring the web detail link.
  const templateOwner =
    pkg.family === "template"
      ? (scoped?.owner ?? pkg.ownerHandle?.trim().replace(/^@+/, "").toLowerCase())
      : undefined;
  const path = templateOwner
    ? `/${encodeURIComponent(templateOwner.toLowerCase())}/templates/${encodeURIComponent(scoped?.slug ?? pkg.name)}/security-audit`
    : scoped
      ? `/${encodeURIComponent(scoped.owner)}/plugins/${encodeURIComponent(scoped.slug)}/security-audit`
      : `/plugins/${encodeURIComponent(pkg.name)}/security-audit`;
  const url = new URL(path, publicApiOrigin(request));
  url.searchParams.set("version", pkg.version);
  return url.toString();
}
