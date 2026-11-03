import type { Doc, Id } from "../_generated/dataModel";
import { resolvePackageReleaseScanStatus } from "./packageSecurity";
import type { PublicPublisher } from "./public";

export type ReleaseLike = {
  _id: Id<"packageReleases">;
  packageId: Id<"packages">;
  version: string;
  createdAt: number;
  changelog: string;
  icon?: Doc<"packageReleases">["icon"];
  distTags?: string[];
  files: Array<{
    path: string;
    size: number;
    sha256: string;
    storageId: Id<"_storage">;
    contentType?: string;
  }>;
  compatibility?: Doc<"packageReleases">["compatibility"];
  pluginManifestSummary?: Doc<"packageReleases">["pluginManifestSummary"];
  templateManifestSummary?: Doc<"packageReleases">["clawManifestSummary"];
  clawManifestSummary?: Doc<"packageReleases">["clawManifestSummary"];
  verification?: Doc<"packageReleases">["verification"];
  extractedPackageJson?: Doc<"packageReleases">["extractedPackageJson"];
  sha256hash?: string;
  vtAnalysis?: Doc<"packageReleases">["vtAnalysis"];
  skillSpectorAnalysis?: Doc<"packageReleases">["skillSpectorAnalysis"];
  endorAnalysis?: Doc<"packageReleases">["endorAnalysis"];
  llmAnalysis?: Doc<"packageReleases">["llmAnalysis"];
  staticScan?: Doc<"packageReleases">["staticScan"];
  manualModeration?: Doc<"packageReleases">["manualModeration"];
  integritySha256?: string;
  artifactKind?: Doc<"packageReleases">["artifactKind"];
  clawpackStorageId?: Doc<"packageReleases">["clawpackStorageId"];
  clawpackSha256?: string;
  clawpackSize?: number;
  clawpackFormat?: "tgz";
  npmIntegrity?: string;
  npmShasum?: string;
  npmTarballName?: string;
  npmUnpackedSize?: number;
  npmFileCount?: number;
  softDeletedAt?: number;
  ownerDeletedAt?: number;
  publicationStatus?: "pending" | "published" | "blocked";
};

export type PublicPackageDocLike = {
  _id: Id<"packages">;
  name: string;
  displayName: string;
  family: "skill" | "code-plugin" | "bundle-plugin" | "template";
  tags: Record<string, Id<"packageReleases">>;
  latestReleaseId?: Id<"packageReleases">;
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  scanStatus?: Doc<"packages">["scanStatus"];
  publicDownloadBlocked?: boolean;
  runtimeId?: string;
  summary?: string;
  latestVersion?: string | null;
  compatibility?: Doc<"packages">["compatibility"];
  verification?: Doc<"packages">["verification"];
  artifact?: {
    kind: "legacy-zip" | "npm-pack";
    sha256?: string;
    size?: number;
    format?: string;
    npmIntegrity?: string;
    npmShasum?: string;
    npmTarballName?: string;
    npmUnpackedSize?: number;
    npmFileCount?: number;
  };
  templateManifestSummary?: Doc<"packageReleases">["clawManifestSummary"];
  stats?: { downloads: number; installs: number; stars: number; versions: number };
  createdAt: number;
  updatedAt: number;
};

export function toReleaseArtifact(release: ReleaseLike, packageName?: string) {
  if (release.artifactKind === "npm-pack") {
    return {
      kind: "npm-pack" as const,
      sha256: release.clawpackSha256,
      size: release.clawpackSize,
      format: release.clawpackFormat ?? "tgz",
      npmIntegrity: release.npmIntegrity,
      npmShasum: release.npmShasum,
      npmTarballName: release.npmTarballName,
      npmUnpackedSize: release.npmUnpackedSize,
      npmFileCount: release.npmFileCount,
    };
  }
  const sha256 = release.sha256hash;
  return {
    kind: "legacy-zip" as const,
    ...(sha256 ? { sha256 } : {}),
    ...(release.clawpackSize !== undefined ? { size: release.clawpackSize } : {}),
    format: "zip",
    source: "clawhub" as const,
    artifactKind: "legacy-zip" as const,
    ...(sha256 ? { artifactSha256: sha256 } : {}),
    packageName,
    version: release.version,
  };
}

export function toPackageVersionResponse(release: ReleaseLike, packageName: string) {
  const scanStatus = resolvePackageReleaseScanStatus(release);
  const verification = release.verification ? { ...release.verification, scanStatus } : null;
  return {
    version: release.version,
    createdAt: release.createdAt,
    changelog: release.changelog,
    icon: release.icon ?? null,
    distTags: release.distTags ?? [],
    files: release.files.map((file) => ({
      path: file.path,
      size: file.size,
      sha256: file.sha256,
      contentType: file.contentType,
    })),
    compatibility: release.compatibility ?? null,
    pluginManifestSummary: release.pluginManifestSummary ?? null,
    templateManifestSummary: release.templateManifestSummary ?? release.clawManifestSummary ?? null,
    verification,
    artifact: toReleaseArtifact(release, packageName),
    sha256hash: release.sha256hash ?? null,
    vtAnalysis: release.vtAnalysis ?? null,
    skillSpectorAnalysis: release.skillSpectorAnalysis ?? null,
    ...(release.endorAnalysis ? { endorAnalysis: release.endorAnalysis } : {}),
    llmAnalysis: release.llmAnalysis ?? null,
    staticScan: release.staticScan ?? null,
  };
}

export function toPackageMetadataResponse(
  pkg: PublicPackageDocLike,
  owner: PublicPublisher | null,
  tags: Record<string, string>,
) {
  return {
    package: { ...toPackageDetailResponsePackage(pkg), tags },
    owner: owner
      ? {
          handle: owner.handle ?? null,
          displayName: owner.displayName ?? null,
          image: owner.image ?? null,
          official: owner.official === true,
        }
      : null,
  };
}

function toPackageDetailResponsePackage(pkg: PublicPackageDocLike) {
  const {
    capabilityTags: _capabilityTags,
    capabilities: _capabilities,
    executesCode: _executesCode,
    ...publicPackage
  } = pkg as PublicPackageDocLike & {
    capabilityTags?: unknown;
    capabilities?: unknown;
    executesCode?: unknown;
  };
  return publicPackage;
}
