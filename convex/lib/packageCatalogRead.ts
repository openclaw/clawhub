import type {
  PackageChannel,
  PackageFamily as PublicPackageFamily,
  PackageVerificationTier,
} from "clawhub-schema";
import { getCatalogTopicSlugs } from "clawhub-schema/catalogMetadata";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isOfficialPublisher } from "./officialPublishers";
import { isPackageBlockedFromPublic } from "./packageSecurity";
import { toPublicPublisher } from "./public";
import { canAccessPublisherOwnerScope, getOwnerPublisher } from "./publishers";
import { toPublicPackageFamily, type StoredPackageFamily } from "./templateStorage";

type DbReaderCtx = Pick<QueryCtx | MutationCtx, "db">;
type PackageFamily = StoredPackageFamily;

export const MAX_PUBLIC_LIST_PAGE_SIZE = 200;

export const MAX_PUBLIC_LIST_FILTER_SCAN_DOCUMENTS = 500;

export const packageListScanStatusValidator = v.union(
  v.literal("clean"),
  v.literal("suspicious"),
  v.literal("malicious"),
  v.literal("pending"),
  v.literal("not-run"),
);

export type PackageListScanStatus = NonNullable<Doc<"packages">["scanStatus"]>;

export type PublicPackageListItem = {
  name: string;
  displayName: string;
  family: PublicPackageFamily;
  runtimeId: string | null;
  channel: PackageChannel;
  isOfficial: boolean;
  summary: string | null;
  icon: string | null;
  ownerHandle: string | null;
  ownerImage: string | null;
  ownerOfficial: boolean;
  createdAt: number;
  updatedAt: number;
  latestVersion: string | null;
  categories?: string[];
  topics?: string[];
  featuredAt?: number;
  trending24h?: { downloads: number; installs: number; windowStart: number; windowEnd: number };
  verificationTier: PackageVerificationTier | null;
  stats: Doc<"packages">["stats"];
};

export type PackageDigestLike = Pick<
  Doc<"packageSearchDigest">,
  | "packageId"
  | "name"
  | "normalizedName"
  | "displayName"
  | "family"
  | "runtimeId"
  | "channel"
  | "isOfficial"
  | "ownerUserId"
  | "ownerPublisherId"
  | "summary"
  | "icon"
  | "ownerHandle"
  | "ownerKind"
  | "createdAt"
  | "updatedAt"
  | "latestVersion"
  | "categories"
  | "topics"
  | "pluginCategoryTags"
  | "verificationTier"
  | "stats"
  | "recommendedScore"
  | "scanStatus"
  | "softDeletedAt"
> & { pluginCategory?: string };

export type PackageOwnerAccessRef = Pick<PackageDigestLike, "ownerUserId" | "ownerPublisherId"> &
  Partial<Pick<PackageDigestLike, "ownerKind">>;

export type PublicPackageListPage = {
  page: PublicPackageListItem[];
  isDone: boolean;
  continueCursor: string;
};

function requiresPrivilegedPackageAccess(
  digest: Pick<PackageDigestLike, "channel" | "scanStatus">,
) {
  return digest.channel === "private" || isPackageBlockedFromPublic(digest.scanStatus);
}

export async function viewerCanAccessPackageOwner(
  ctx: DbReaderCtx,
  digest: PackageOwnerAccessRef,
  viewerUserId: Id<"users"> | undefined,
  membershipCache?: Map<string, Promise<boolean>>,
) {
  if (!viewerUserId) return false;
  if (!digest.ownerPublisherId) return digest.ownerUserId === viewerUserId;

  const ownerPublisherId = digest.ownerPublisherId;
  const cacheKey = `${ownerPublisherId}:${digest.ownerUserId}`;
  const cached = membershipCache?.get(cacheKey);
  if (cached) return await cached;

  const membershipPromise = (async () => {
    const ownerPublisher = await ctx.db.get(ownerPublisherId);
    return await canAccessPublisherOwnerScope(ctx, {
      publisher: ownerPublisher,
      userId: viewerUserId,
      legacyOwnerUserId: digest.ownerUserId,
    });
  })();
  membershipCache?.set(cacheKey, membershipPromise);
  return await membershipPromise;
}

export async function canViewerReadPackage(
  ctx: DbReaderCtx,
  digest: Pick<PackageDigestLike, "channel" | "scanStatus" | "ownerUserId" | "ownerPublisherId"> &
    Partial<Pick<PackageDigestLike, "ownerKind">>,
  viewerUserId: Id<"users"> | undefined,
  membershipCache?: Map<string, Promise<boolean>>,
) {
  if (!requiresPrivilegedPackageAccess(digest)) return true;
  const isPrivilegedViewer = await viewerCanAccessPackageOwner(
    ctx,
    digest,
    viewerUserId,
    membershipCache,
  );
  return (
    (digest.channel !== "private" || isPrivilegedViewer) &&
    (!isPackageBlockedFromPublic(digest.scanStatus) || isPrivilegedViewer)
  );
}

export function digestMatchesFilters(
  digest: PackageDigestLike,
  args: {
    channel?: PackageChannel;
    category?: string;
    topic?: string;
    createdAfter?: number;
    excludedScanStatuses?: PackageListScanStatus[];
  },
) {
  // Catalog discovery must not inherit an owner's permission to inspect hidden reservations.
  if (digest.softDeletedAt || !digest.latestVersion) return false;
  if (digest.channel === "private" && args.channel !== "private") return false;
  if (isPackageBlockedFromPublic(digest.scanStatus)) return false;
  if (digest.scanStatus && args.excludedScanStatuses?.includes(digest.scanStatus)) return false;
  if (args.category) {
    if (digest.family === "claw") {
      if (!(digest.categories ?? []).includes(args.category)) return false;
    } else if (digest.pluginCategory) {
      if (digest.pluginCategory !== args.category) return false;
    } else if (!(digest.pluginCategoryTags ?? []).includes(args.category)) {
      return false;
    }
  }
  if (args.topic && !getCatalogTopicSlugs(digest.topics).includes(args.topic)) {
    return false;
  }
  if (args.createdAfter !== undefined && digest.createdAt < args.createdAfter) return false;
  return true;
}

export function digestMatchesSearchFilters(
  digest: PackageDigestLike,
  args: {
    family?: PackageFamily;
    families?: PackageFamily[];
    channel?: PackageChannel;
    isOfficial?: boolean;
    category?: string;
    topic?: string;
    createdAfter?: number;
    excludedScanStatuses?: PackageListScanStatus[];
  },
) {
  if (args.family && digest.family !== args.family) return false;
  if (args.families?.length && !args.families.includes(digest.family)) return false;
  if (args.channel && digest.channel !== args.channel) return false;
  if (typeof args.isOfficial === "boolean" && digest.isOfficial !== args.isOfficial) {
    return false;
  }
  return digestMatchesFilters(digest, args);
}

function defaultPackageStats(): Doc<"packages">["stats"] {
  return { downloads: 0, installs: 0, stars: 0, versions: 0 };
}

async function resolvePackageListStats(
  ctx: DbReaderCtx,
  digest: PackageDigestLike,
): Promise<Doc<"packages">["stats"]> {
  const pkg = await ctx.db.get(digest.packageId);
  return pkg?.stats ?? digest.stats ?? defaultPackageStats();
}

export async function toPublicPackageListItem(
  ctx: DbReaderCtx,
  digest: PackageDigestLike,
  featuredAt?: number,
): Promise<PublicPackageListItem> {
  // Publisher identity is independent of the package's official channel. Resolve
  // current status so granting/revoking a badge needs no package digest backfill.
  const publisher = digest.ownerPublisherId
    ? await ctx.db.get(digest.ownerPublisherId)
    : await getOwnerPublisher(ctx, digest);
  return {
    name: digest.name,
    displayName: digest.displayName,
    family: toPublicPackageFamily(digest.family),
    runtimeId: digest.runtimeId ?? null,
    channel: digest.channel,
    isOfficial: digest.isOfficial,
    summary: digest.summary ?? null,
    icon: digest.icon ?? null,
    ownerHandle: digest.ownerHandle || null,
    ownerImage: toPublicPublisher(publisher)?.image ?? null,
    ownerOfficial: await isOfficialPublisher(ctx, publisher),
    createdAt: digest.createdAt,
    updatedAt: digest.updatedAt,
    latestVersion: digest.latestVersion ?? null,
    categories: digest.categories,
    topics: digest.topics,
    ...(featuredAt === undefined ? {} : { featuredAt }),
    verificationTier: digest.verificationTier ?? null,
    stats: await resolvePackageListStats(ctx, digest),
  };
}

export async function getPackageByNormalizedName(ctx: DbReaderCtx, normalizedName: string) {
  return (await ctx.db
    .query("packages")
    .withIndex("by_name", (q) => q.eq("normalizedName", normalizedName))
    .unique()) as Doc<"packages"> | null;
}
