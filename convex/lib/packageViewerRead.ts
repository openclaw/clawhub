import type {
  PackageArtifactSummary,
  PackageChannel,
  PackageFamily as PublicPackageFamily,
} from "clawhub-schema";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { toPublicPublisherWithOfficial } from "./officialPublishers";
import { getPackageReleaseArtifactSha256 } from "./packageArtifacts";
import { getPackageByNormalizedName, viewerCanAccessPackageOwner } from "./packageCatalogRead";
import { normalizePackageName } from "./packageRegistry";
import { resolvePackageReleaseFamily } from "./packageReleaseFamily";
import {
  hasNoPublishedPackageVersions,
  isPublishedPackageRelease,
} from "./packageReleaseVisibility";
import { isPackageBlockedFromPublic, resolvePackageReleaseScanStatus } from "./packageSecurity";
import { getOwnerPublisher, normalizePublisherHandle } from "./publishers";
import { selectTemplateDetailRelease } from "./templateDetailView";
import {
  toPublicPackageFamily,
  toStoredPackageFamily,
  type StoredPackageFamily,
} from "./templateStorage";

type DbReaderCtx = Pick<QueryCtx | MutationCtx, "db">;
type PackageFamily = StoredPackageFamily;

type PackageReleaseSelector = {
  version?: string;
  tag?: string;
  releaseId?: Id<"packageReleases">;
};

type PublicPackageDoc = {
  _id: Id<"packages">;
  name: string;
  displayName: string;
  family: PublicPackageFamily;
  templateProfilePolicyVersion?: 1;
  channel: PackageChannel;
  isOfficial: boolean;
  runtimeId?: string;
  summary?: string;
  icon: string | null;
  tags: Record<string, Id<"packageReleases">>;
  latestReleaseId?: Id<"packageReleases">;
  latestVersion?: string | null;
  categories?: string[];
  topics?: string[];
  compatibility?: Doc<"packages">["compatibility"];
  verification?: Doc<"packages">["verification"];
  artifact?: PackageArtifactSummary;
  templateManifestSummary?: Doc<"packageReleases">["clawManifestSummary"];
  templateInventory?: Doc<"packageReleases">["templateInventory"];
  scanStatus?: Doc<"packages">["scanStatus"];
  stats: Doc<"packages">["stats"];
  createdAt: number;
  updatedAt: number;
};

export function resolvePublicPackageScanStatus(
  pkg: Pick<Doc<"packages">, "scanStatus">,
  latestRelease?: Doc<"packageReleases"> | null,
) {
  if (latestRelease && !latestRelease.softDeletedAt) {
    const releaseScanStatus = resolvePackageReleaseScanStatus(latestRelease);
    return releaseScanStatus === "not-run" ? pkg.scanStatus : releaseScanStatus;
  }
  return pkg.scanStatus;
}

function normalizePublicPackageSourcePath(sourcePath: unknown) {
  if (typeof sourcePath !== "string") return undefined;
  const trimmed = sourcePath.trim();
  if (!trimmed || trimmed === ".") return undefined;
  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "") || undefined;
}

function getReleaseSourcePath(release?: Pick<Doc<"packageReleases">, "source"> | null) {
  const source = release?.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
  return normalizePublicPackageSourcePath((source as { path?: unknown }).path);
}

function resolvePublicPackageVerification(
  pkg: Pick<Doc<"packages">, "verification" | "latestVersionSummary" | "scanStatus">,
  latestRelease?: Doc<"packageReleases"> | null,
) {
  const scanStatus = resolvePublicPackageScanStatus(pkg, latestRelease);
  const source = pkg.verification ?? pkg.latestVersionSummary?.verification;
  if (!source) return source;
  const sourcePath = source.sourcePath ?? getReleaseSourcePath(latestRelease);
  const verification = sourcePath ? { ...source, sourcePath } : source;
  return scanStatus ? { ...verification, scanStatus } : verification;
}

export function toPublicPackage(
  pkg: Doc<"packages"> | null | undefined,
  latestRelease?: Doc<"packageReleases"> | null,
): PublicPackageDoc | null {
  if (!pkg || pkg.softDeletedAt !== undefined) return null;
  if (latestRelease && latestRelease.packageId !== pkg._id) return null;
  if (hasNoPublishedPackageVersions(pkg)) return null;
  if (
    latestRelease !== undefined &&
    latestRelease &&
    (latestRelease.publicationStatus === "pending" || latestRelease.publicationStatus === "blocked")
  ) {
    return null;
  }
  const latestVersion =
    latestRelease === undefined
      ? (pkg.latestVersionSummary?.version ?? null)
      : isPublishedPackageRelease(latestRelease)
        ? latestRelease.version
        : null;
  const scanStatus = resolvePublicPackageScanStatus(pkg, latestRelease);
  return {
    _id: pkg._id,
    name: pkg.name,
    displayName: pkg.displayName,
    family: toPublicPackageFamily(pkg.family),
    templateProfilePolicyVersion: pkg.clawProfilePolicyVersion,
    channel: pkg.channel,
    isOfficial: pkg.isOfficial,
    runtimeId: pkg.runtimeId,
    summary: pkg.summary,
    icon: pkg.icon ?? null,
    tags: pkg.tags,
    latestReleaseId: pkg.latestReleaseId,
    latestVersion,
    categories: pkg.categories,
    topics: pkg.topics,
    compatibility: pkg.compatibility,
    verification: resolvePublicPackageVerification(pkg, latestRelease),
    artifact:
      latestRelease === undefined
        ? pkg.latestVersionSummary?.artifact
        : isPublishedPackageRelease(latestRelease)
          ? packageArtifactSummary(latestRelease)
          : undefined,
    templateInventory:
      pkg.family === "claw" && isPublishedPackageRelease(latestRelease)
        ? latestRelease.templateInventory
        : undefined,
    templateManifestSummary:
      pkg.family === "claw" && isPublishedPackageRelease(latestRelease)
        ? latestRelease.clawManifestSummary
        : undefined,
    scanStatus,
    stats: pkg.stats,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
  };
}

export function toPublicPackageRelease(release: Doc<"packageReleases">, family: PackageFamily) {
  // Plugin snapshots may distinguish historical bundles from current native
  // releases. They can never loosen the Template/skill projection boundary.
  family = resolvePackageReleaseFamily(family, release);
  if (family === "claw") {
    const sourcePath = release.verification?.sourcePath ?? getReleaseSourcePath(release);
    return {
      _id: release._id,
      packageId: release.packageId,
      version: release.version,
      changelog: release.changelog,
      summary: release.summary,
      icon: release.icon,
      distTags: release.distTags,
      files: release.files.map((file) => ({
        path: file.path,
        size: file.size,
        sha256: file.sha256,
        contentType: file.contentType,
      })),
      integritySha256: release.integritySha256,
      artifactKind: release.artifactKind,
      clawpackSha256: release.clawpackSha256,
      clawpackSize: release.clawpackSize,
      clawpackFormat: release.clawpackFormat,
      npmIntegrity: release.npmIntegrity,
      npmShasum: release.npmShasum,
      npmTarballName: release.npmTarballName,
      npmUnpackedSize: release.npmUnpackedSize,
      npmFileCount: release.npmFileCount,
      templateManifestSummary: release.clawManifestSummary,
      templateInventory: release.templateInventory,
      compatibility: release.compatibility,
      runtimeId: release.runtimeId,
      sourceRepo: release.sourceRepo,
      verification:
        release.verification && sourcePath
          ? { ...release.verification, sourcePath }
          : release.verification,
      sha256hash: release.sha256hash,
      aigAnalysis: release.aigAnalysis,
      skillSpectorAnalysis: release.skillSpectorAnalysis,
      endorAnalysis: release.endorAnalysis,
      llmAnalysis: release.llmAnalysis,
      createdAt: release.createdAt,
    };
  }
  return toPublicPluginRelease(release);
}

export function toPublicPluginRelease(release: Doc<"packageReleases">) {
  const {
    capabilities: _capabilities,
    clawManifestSummary: _clawManifestSummary,
    templateInventory: _templateInventory,
    extractedTemplateManifest: _extractedTemplateManifest,
    ...publicRelease
  } = release as Doc<"packageReleases"> & {
    capabilities?: unknown;
    extractedTemplateManifest?: unknown;
  };
  const sourcePath = release.verification?.sourcePath ?? getReleaseSourcePath(release);
  if (!release.verification || !sourcePath) return publicRelease;
  return {
    ...publicRelease,
    verification: {
      ...release.verification,
      sourcePath,
    },
  };
}

export function packageArtifactSummary(
  release: Pick<
    Doc<"packageReleases">,
    | "artifactKind"
    | "clawpackSha256"
    | "sha256hash"
    | "clawpackSize"
    | "clawpackFormat"
    | "npmIntegrity"
    | "npmShasum"
    | "npmTarballName"
    | "npmUnpackedSize"
    | "npmFileCount"
  >,
): PackageArtifactSummary {
  if (release.artifactKind === "npm-pack") {
    return {
      kind: "npm-pack",
      sha256: getPackageReleaseArtifactSha256(release) ?? undefined,
      size: release.clawpackSize,
      format: release.clawpackFormat ?? "tgz",
      npmIntegrity: release.npmIntegrity,
      npmShasum: release.npmShasum,
      npmTarballName: release.npmTarballName,
      npmUnpackedSize: release.npmUnpackedSize,
      npmFileCount: release.npmFileCount,
    };
  }
  return {
    kind: "legacy-zip",
    sha256: getPackageReleaseArtifactSha256(release) ?? undefined,
    format: "zip",
  };
}

// Templates share the skill reference grammar: `@publisher/slug` also names a
// Template stored under the unscoped `slug` and owned by that publisher. An
// live exact package name always wins, and plugins keep exact-name reads.
async function getTemplateByPublisherRef(ctx: DbReaderCtx, normalizedName: string) {
  const ref = /^@([^/]+)\/([^/]+)$/.exec(normalizedName);
  if (!ref) return null;
  const pkg = await getPackageByNormalizedName(ctx, ref[2]);
  if (!pkg || pkg.family !== toStoredPackageFamily("template")) return null;
  const owner = await getOwnerPublisher(ctx, {
    ownerPublisherId: pkg.ownerPublisherId,
    ownerUserId: pkg.ownerUserId,
  });
  return normalizePublisherHandle(owner?.handle) === ref[1] ? pkg : null;
}

export async function getReadablePackageByName(
  ctx: DbReaderCtx,
  name: string,
  viewerUserId?: Id<"users">,
) {
  const normalizedName = normalizePackageName(name);
  const exact = await getPackageByNormalizedName(ctx, normalizedName);
  const pkg =
    exact && exact.softDeletedAt === undefined
      ? exact
      : await getTemplateByPublisherRef(ctx, normalizedName);
  if (!pkg || pkg.softDeletedAt !== undefined) return null;
  if (pkg.channel === "private" || isPackageBlockedFromPublic(pkg.scanStatus)) {
    const canAccessOwner = await viewerCanAccessPackageOwner(ctx, pkg, viewerUserId);
    if (pkg.channel === "private" && !canAccessOwner) return null;

    if (isPackageBlockedFromPublic(pkg.scanStatus)) {
      const latestRelease = pkg.latestReleaseId ? await ctx.db.get(pkg.latestReleaseId) : null;
      const scanStatus = resolvePublicPackageScanStatus(pkg, latestRelease);
      if (isPackageBlockedFromPublic(scanStatus) && !canAccessOwner) return null;
    }
  }
  return pkg;
}

export async function selectPublishedPackageRelease(
  ctx: DbReaderCtx,
  pkg: Doc<"packages">,
  selector: PackageReleaseSelector,
) {
  const releaseId =
    selector.releaseId ?? (selector.tag ? pkg.tags[selector.tag] : pkg.latestReleaseId);
  const release = selector.version
    ? await ctx.db
        .query("packageReleases")
        .withIndex("by_package_version", (q) =>
          q.eq("packageId", pkg._id).eq("version", selector.version!),
        )
        .unique()
    : releaseId
      ? await ctx.db.get(releaseId)
      : null;
  return isPublishedPackageRelease(release, pkg._id) ? release : null;
}

export async function readPublishedPackageTags(
  ctx: DbReaderCtx,
  pkg: Doc<"packages">,
  knownLatest?: Doc<"packageReleases"> | null,
) {
  // Convex objects have at most 1024 fields; aliases share one read per release.
  const releases = await Promise.all(
    [...new Set(Object.values(pkg.tags))]
      .filter((id) => id !== knownLatest?._id)
      .map((releaseId) => selectPublishedPackageRelease(ctx, pkg, { releaseId })),
  );
  if (isPublishedPackageRelease(knownLatest, pkg._id)) releases.push(knownLatest);
  const versions = new Map(
    releases.flatMap((release) => (release ? [[release._id, release.version] as const] : [])),
  );
  return Object.fromEntries(
    Object.entries(pkg.tags).flatMap(([tag, releaseId]) => {
      const version = versions.get(releaseId);
      return version ? [[tag, version]] : [];
    }),
  );
}

export async function readPackageForViewer(
  ctx: QueryCtx,
  args: { name: string; viewerUserId?: Id<"users">; includeTemplateDetail?: boolean },
) {
  const snapshot = await readPackageSnapshotForViewer(ctx, args);
  if (!snapshot) return null;
  const { publicPackage, latestRelease, owner, pkg } = snapshot;
  if (args.includeTemplateDetail && pkg.family === "claw") {
    // Authority, the published latest pointer, scan and file descriptor share one DB snapshot.
    return {
      package: publicPackage,
      owner,
      latestRelease: null,
      templateDetail: {
        tags: await readPublishedPackageTags(ctx, pkg, latestRelease),
        release: selectTemplateDetailRelease(publicPackage, latestRelease),
      },
    };
  }
  return {
    package: publicPackage,
    latestRelease: isPublishedPackageRelease(latestRelease)
      ? toPublicPackageRelease(latestRelease, pkg.family)
      : null,
    owner,
  };
}

export async function readPackageSnapshotForViewer(
  ctx: QueryCtx,
  args: { name: string; viewerUserId?: Id<"users"> },
) {
  const pkg = await getReadablePackageByName(ctx, args.name, args.viewerUserId);
  if (!pkg) return null;
  const latestRelease = pkg.latestReleaseId ? await ctx.db.get(pkg.latestReleaseId) : null;
  const publicPackage = toPublicPackage(pkg, latestRelease);
  if (!publicPackage) return null;
  const owner = await toPublicPublisherWithOfficial(
    ctx,
    await getOwnerPublisher(ctx, {
      ownerPublisherId: pkg.ownerPublisherId,
      ownerUserId: pkg.ownerUserId,
    }),
  );
  return { pkg, publicPackage, latestRelease, owner };
}

export async function readPackageReleaseSnapshotForViewer(
  ctx: QueryCtx,
  args: {
    name: string;
    packageId?: Id<"packages">;
    viewerUserId?: Id<"users">;
  } & PackageReleaseSelector,
) {
  const pkg = await getReadablePackageByName(ctx, args.name, args.viewerUserId);
  if (!pkg || (args.packageId && pkg._id !== args.packageId)) return null;
  const release = await selectPublishedPackageRelease(ctx, pkg, args);
  if (!release) return null;
  const latestRelease =
    pkg.latestReleaseId === release._id
      ? release
      : pkg.latestReleaseId
        ? await ctx.db.get(pkg.latestReleaseId)
        : null;
  const publicPackage = toPublicPackage(pkg, latestRelease);
  return publicPackage
    ? {
        package: {
          ...publicPackage,
          family: toPublicPackageFamily(resolvePackageReleaseFamily(pkg.family, release)),
        },
        release,
      }
    : null;
}

export async function readPackageVersionForViewer(
  ctx: QueryCtx,
  args: { name: string; version: string; viewerUserId?: Id<"users"> },
) {
  const snapshot = await readPackageReleaseSnapshotForViewer(ctx, args);
  if (!snapshot) return null;
  const { package: pkg, release } = snapshot;
  return {
    package: pkg,
    version: {
      ...toPublicPackageRelease(release, toStoredPackageFamily(pkg.family)),
      // Keep download authority internal: the public Template projection omits
      // reviewer notes, but both archive routers must still enforce moderation.
      manualModeration: release.manualModeration,
      staticScan: release.staticScan,
      // Internal HTTP handlers need the opaque storage id to stream exact ClawPack bytes.
      ...(release.clawpackStorageId ? { clawpackStorageId: release.clawpackStorageId } : {}),
    },
  };
}
