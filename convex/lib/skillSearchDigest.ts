import { getCatalogTopicSlugs } from "clawhub-schema";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { HydratableSkill, PublicPublisher } from "./public";
import { getOwnerPublisher } from "./publishers";
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
export type SkillSearchDigestFields = Pick<Doc<"skills">, (typeof SHARED_KEYS)[number]> & {
  skillId: Id<"skills">;
  latestVersionSkillId?: Id<"skills">;
  normalizedSlug?: string;
  normalizedSlugFirstToken?: string;
  normalizedDisplayName?: string;
  normalizedDisplayNameFirstToken?: string;
  ownerHandle?: string;
  ownerKind?: "user" | "org";
  ownerName?: string;
  ownerDisplayName?: string;
  ownerImage?: string;
  recommendedScore?: number;
  recommendedScoreVersion?: number;
};

/** Pick the subset of fields from a full skill doc needed for the digest. */
export function extractDigestFields(skill: Doc<"skills">): SkillSearchDigestFields {
  const statsDownloads = readCanonicalStat(skill, "downloads");
  const statsStars = readCanonicalStat(skill, "stars");
  const statsInstallsCurrent = readCanonicalStat(skill, "installsCurrent");
  const statsInstallsAllTime = readCanonicalStat(skill, "installsAllTime");
  return {
    ...pick(skill, [...SHARED_KEYS]),
    statsDownloads,
    statsStars,
    statsInstallsCurrent,
    statsInstallsAllTime,
    recommendedScore: computeRecommendationScore({
      downloads: statsDownloads,
      installs: statsInstallsAllTime,
      stars: statsStars,
    }),
    recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION,
    skillId: skill._id,
    normalizedSlug: normalizeSkillSearchText(skill.slug),
    normalizedSlugFirstToken: getFirstSearchToken(skill.slug),
    normalizedDisplayName: normalizeSkillSearchText(skill.displayName),
    normalizedDisplayNameFirstToken: getFirstSearchToken(skill.displayName),
  };
}

export async function extractValidatedDigestFields(
  ctx: Pick<MutationCtx, "db">,
  skill: Doc<"skills">,
): Promise<SkillSearchDigestFields> {
  const fields = extractDigestFields(skill);
  const version = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;
  if (!version || version.softDeletedAt || version.skillId !== skill._id) {
    return {
      ...fields,
      latestVersionId: undefined,
      latestVersionSkillId: undefined,
      latestVersionSummary: undefined,
    };
  }
  return { ...fields, latestVersionSkillId: version.skillId };
}

export function normalizeSkillSearchText(value: string) {
  return value.trim().toLowerCase();
}

export function getFirstSearchToken(value: string) {
  return tokenize(value)[0];
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

/** Insert or update the digest row for a skill. Skips the write when no fields changed. */
export async function upsertSkillSearchDigest(
  ctx: Pick<MutationCtx, "db">,
  fields: SkillSearchDigestFields,
) {
  const existing = await ctx.db
    .query("skillSearchDigest")
    .withIndex("by_skill", (q) => q.eq("skillId", fields.skillId))
    .unique();
  if (existing) {
    if (hasDigestChanged(existing, fields)) {
      await ctx.db.patch(existing._id, fields);
    }
  } else {
    await ctx.db.insert("skillSearchDigest", fields);
  }
  if ((existing?.topics?.length ?? 0) > 0 || (fields.topics?.length ?? 0) > 0) {
    await syncSkillTopicSearchDigests(ctx, fields);
  }
}

async function syncSkillTopicSearchDigests(
  ctx: Pick<MutationCtx, "db">,
  fields: SkillSearchDigestFields,
) {
  const existing = await ctx.db
    .query("skillTopicSearchDigest")
    .withIndex("by_skill", (q) => q.eq("skillId", fields.skillId))
    .collect();
  const nextByTopic = new Map(
    getCatalogTopicSlugs(fields.topics).map((topic) => [
      topic,
      {
        skillId: fields.skillId,
        topic,
        softDeletedAt: fields.softDeletedAt,
        isSuspicious: fields.isSuspicious,
        normalizedDisplayName: fields.normalizedDisplayName,
        statsDownloads: fields.statsDownloads,
        statsStars: fields.statsStars,
        statsInstallsAllTime: fields.statsInstallsAllTime,
        recommendedScore: fields.recommendedScore,
        createdAt: fields.createdAt,
        updatedAt: fields.updatedAt,
      },
    ]),
  );
  for (const row of existing) {
    const next = nextByTopic.get(row.topic);
    if (!next) {
      await ctx.db.delete(row._id);
      continue;
    }
    if (hasDigestChanged(row, next)) {
      await ctx.db.patch(row._id, next);
    }
    nextByTopic.delete(row.topic);
  }
  for (const next of nextByTopic.values()) {
    await ctx.db.insert("skillTopicSearchDigest", next);
  }
}

export async function deleteSkillSearchDigests(
  ctx: Pick<MutationCtx, "db">,
  skillId: Id<"skills">,
) {
  const digest = await ctx.db
    .query("skillSearchDigest")
    .withIndex("by_skill", (q) => q.eq("skillId", skillId))
    .unique();
  if (digest) await ctx.db.delete(digest._id);
  for (const topicDigest of await ctx.db
    .query("skillTopicSearchDigest")
    .withIndex("by_skill", (q) => q.eq("skillId", skillId))
    .collect()) {
    await ctx.db.delete(topicDigest._id);
  }
}

export async function syncSkillSearchDigestForSkill(
  ctx: Pick<MutationCtx, "db">,
  skill: Doc<"skills"> | null | undefined,
) {
  if (!skill) return;
  const fields = await extractValidatedDigestFields(ctx, skill);
  const owner = await getOwnerPublisher(ctx, {
    ownerPublisherId: skill.ownerPublisherId,
    ownerUserId: skill.ownerUserId,
  });
  await upsertSkillSearchDigest(ctx, {
    ...fields,
    ownerHandle: owner?.handle ?? "",
    ownerKind: owner?.kind,
    ownerName: owner?.linkedUserId ? owner.handle : undefined,
    ownerDisplayName: owner?.displayName,
    ownerImage: owner?.image,
  });
}

/** Compare new fields against existing row. Returns true if any field differs. */
function hasDigestChanged(
  existing: Record<string, unknown>,
  fields: Record<string, unknown>,
): boolean {
  for (const key of Object.keys(fields)) {
    const oldVal = (existing as Record<string, unknown>)[key];
    const newVal = (fields as Record<string, unknown>)[key];
    if (oldVal === newVal) continue;
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) return true;
  }
  return false;
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
