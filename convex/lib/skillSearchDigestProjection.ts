import { resolveCatalogTopics, resolveStoredSkillCategories } from "clawhub-schema/catalogMetadata";
import type { Doc, Id } from "../_generated/dataModel";
import type { HydratableSkill, PublicPublisher } from "./public";
import { computeRecommendationScore, RECOMMENDATION_SCORE_VERSION } from "./recommendationScore";
import { tokenize } from "./searchText";
import { readCanonicalStat } from "./skillStats";

function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]])) as Pick<T, K>;
}

type SharedSkillKey = Extract<keyof Doc<"skills">, keyof Doc<"skillSearchDigest">>;

/**
 * Fields shared 1:1 between `skills` and `skillSearchDigest` (same name,
 * same type).  Used by both `extractDigestFields` and `digestToHydratableSkill`
 * so adding/removing a field here keeps them in sync.
 */
const SHARED_KEYS = [
  "slug",
  "displayName",
  "summary",
  "icon",
  "ownerUserId",
  "ownerPublisherId",
  "canonicalSkillId",
  "forkOf",
  "latestVersionId",
  "installKind",
  "githubHasSkillCard",
  "githubCurrentStatus",
  "githubScanStatus",
  "latestVersionSummary",
  "tags",
  "categories",
  "topics",
  "badges",
  "stats",
  "statsDownloads",
  "statsStars",
  "statsInstallsCurrent",
  "statsInstallsAllTime",
  "statsSkillsShInstalls",
  "statsGithubStars",
  "softDeletedAt",
  "moderationStatus",
  "moderationFlags",
  "moderationVerdict",
  "moderationReason",
  "isSuspicious",
  "createdAt",
  "updatedAt",
] as const satisfies readonly SharedSkillKey[];

/** Fields stored in the skillSearchDigest table. */
export type SkillSearchDigestFields = Omit<Doc<"skillSearchDigest">, "_id" | "_creationTime">;

/** Pick the subset of fields from a full skill doc needed for the digest. */
export function extractDigestFields(skill: Doc<"skills">): SkillSearchDigestFields {
  const statsDownloads = readCanonicalStat(skill, "downloads");
  const statsStars = readCanonicalStat(skill, "stars");
  const statsInstallsCurrent = readCanonicalStat(skill, "installsCurrent");
  const statsInstallsAllTime = readCanonicalStat(skill, "installsAllTime");
  const inferenceCurrent =
    Boolean(skill.latestVersionId) && skill.latestVersionId === skill.inferredFromVersionId;
  return {
    ...pick(skill, [...SHARED_KEYS]),
    categories: resolveStoredSkillCategories(skill),
    topics: resolveCatalogTopics({
      declared: skill.topics,
      inferred: skill.inferredTopics,
      inferenceCurrent,
    }),
    statsDownloads,
    statsStars,
    statsInstallsCurrent,
    statsInstallsAllTime,
    recommendedScore: computeRecommendationScore(
      {
        downloads: statsDownloads,
        installs: statsInstallsAllTime,
        stars: statsStars,
      },
      {
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
      },
    ),
    recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION,
    skillId: skill._id,
    normalizedSlug: normalizeSkillSearchText(skill.slug),
    normalizedSlugFirstToken: getFirstSearchToken(skill.slug),
    normalizedDisplayName: normalizeSkillSearchText(skill.displayName),
    normalizedDisplayNameFirstToken: getFirstSearchToken(skill.displayName),
  };
}

export function normalizeSkillSearchText(value: string) {
  return value.trim().toLowerCase();
}

export function getFirstSearchToken(value: string) {
  return tokenize(value)[0];
}

// The skills.sh mirror persists the same tokenizer-derived first tokens, but its columns
// are required, so it falls back to the normalized text when the tokenizer yields nothing.
export function getMirrorFirstSearchToken(value: string) {
  return getFirstSearchToken(value) ?? normalizeSkillSearchText(value);
}

/**
 * Map a digest row to the HydratableSkill shape expected by toPublicSkill /
 * isPublicSkillDoc / isSkillSuspicious.  Fully type-checked: if
 * HydratableSkill gains a field the digest doesn't carry, this will fail
 * to compile.
 */
export function digestToHydratableSkill(digest: Doc<"skillSearchDigest">): HydratableSkill {
  return {
    ...pick(digest, [...SHARED_KEYS]),
    _id: digest.skillId,
    _creationTime: digest.createdAt,
  };
}

/**
 * Extract pre-resolved owner info from a digest row.
 * Returns null if the owner fields haven't been backfilled yet.
 */
export function digestToOwnerInfo(
  digest: Pick<
    Doc<"skillSearchDigest">,
    | "ownerHandle"
    | "ownerKind"
    | "ownerName"
    | "ownerDisplayName"
    | "ownerImage"
    | "ownerUserId"
    | "ownerPublisherId"
  >,
): { ownerHandle: string | null; owner: PublicPublisher | null } | null {
  if (digest.ownerHandle === undefined) return null;
  // Empty string means backfilled but owner has no handle.
  // Use userId as fallback handle, matching the live getOwnerInfo path.
  const handle = digest.ownerHandle || undefined;
  const fallbackHandle = handle ?? String(digest.ownerPublisherId ?? digest.ownerUserId);
  const resolvedHandle = handle ?? fallbackHandle;
  // Determine if we have real profile data (deactivated/deleted owners have
  // all profile fields undefined, while handle-less visible owners still have
  // name/displayName/image populated).
  const hasProfileData =
    digest.ownerName !== undefined ||
    digest.ownerDisplayName !== undefined ||
    digest.ownerImage !== undefined;
  return {
    ownerHandle: fallbackHandle,
    owner:
      handle || hasProfileData
        ? {
            _id: digest.ownerPublisherId ?? ("publishers:missing" as Id<"publishers">),
            _creationTime: 0,
            handle: resolvedHandle,
            displayName: digest.ownerDisplayName ?? digest.ownerName ?? resolvedHandle,
            image: digest.ownerImage,
            bio: undefined,
            kind: digest.ownerKind ?? "user",
            linkedUserId: digest.ownerKind === "org" ? undefined : digest.ownerUserId,
          }
        : null,
  };
}
