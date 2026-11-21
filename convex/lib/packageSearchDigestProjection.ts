import { resolveCatalogTopics } from "clawhub-schema/catalogMetadata";
import { resolveStoredPluginCategories } from "clawhub-schema/pluginCategories";
import type { Doc, Id } from "../_generated/dataModel";

function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, obj[key]])) as Pick<T, K>;
}

type SharedPackageKey = Extract<keyof Doc<"packages">, keyof Doc<"packageSearchDigest">>;

const SHARED_KEYS = [
  "name",
  "normalizedName",
  "displayName",
  "family",
  "channel",
  "isOfficial",
  "ownerUserId",
  "ownerPublisherId",
  "summary",
  "icon",
  "stats",
  "recommendedScore",
  "recommendedScoreVersion",
  "runtimeId",
  "categories",
  "topics",
  "scanStatus",
  "softDeletedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly SharedPackageKey[];

const FACET_SHARED_KEYS = [
  "packageId",
  "name",
  "normalizedName",
  "displayName",
  "family",
  "channel",
  "isOfficial",
  "ownerUserId",
  "ownerPublisherId",
  "ownerHandle",
  "ownerKind",
  "summary",
  "icon",
  "latestVersion",
  "runtimeId",
  "categories",
  "topics",
  "pluginCategoryTags",
  "verificationTier",
  "stats",
  "recommendedScore",
  "recommendedScoreVersion",
  "scanStatus",
  "softDeletedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly Extract<
  keyof Doc<"packagePluginCategorySearchDigest">,
  keyof Doc<"packageTopicSearchDigest">
>[];

export type PackageSearchDigestFields = Pick<Doc<"packages">, (typeof SHARED_KEYS)[number]> & {
  packageId: Id<"packages">;
  latestVersion?: string;
  ownerHandle?: string;
  ownerKind?: "user" | "org";
  verificationTier?: Doc<"packageSearchDigest">["verificationTier"];
  pluginCategoryTags?: string[];
};

export function extractPackageDigestFields(pkg: Doc<"packages">): PackageSearchDigestFields {
  const pluginCategoryTags =
    pkg.family === "code-plugin" || pkg.family === "bundle-plugin"
      ? resolveStoredPluginCategories(pkg)
      : [];
  // Template assignments use their own taxonomy; plugin normalization discards them.
  const categories = pkg.family === "claw" ? (pkg.categories ?? ["other"]) : pluginCategoryTags;
  const inferenceCurrent =
    Boolean(pkg.latestReleaseId) && pkg.latestReleaseId === pkg.inferredFromReleaseId;
  return {
    ...pick(pkg, [...SHARED_KEYS]),
    categories,
    topics: resolveCatalogTopics({
      declared: pkg.topics,
      inferred: pkg.inferredTopics,
      inferenceCurrent,
    }),
    packageId: pkg._id,
    latestVersion: pkg.latestVersionSummary?.version,
    verificationTier: pkg.verification?.tier,
    pluginCategoryTags,
  };
}

export function extractPackageFacetFields(fields: PackageSearchDigestFields) {
  return pick(fields, [...FACET_SHARED_KEYS]);
}
