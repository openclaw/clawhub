import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { HydratableSkill, PublicUser } from "./public";

function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]])) as Pick<T, K>;
}

/**
 * Fields shared 1:1 between `skills` and `skillSearchDigest` (same name,
 * same type).  Used by both `extractDigestFields` and `digestToHydratableSkill`
 * so adding/removing a field here keeps them in sync.
 */
const SHARED_KEYS = [
  "slug",
  "displayName",
  "summary",
  "ownerUserId",
  "canonicalSkillId",
  "forkOf",
  "latestVersionId",
  "latestVersionSummary",
  "tags",
  "badges",
  "stats",
  "statsDownloads",
  "statsStars",
  "statsInstallsCurrent",
  "statsInstallsAllTime",
  "softDeletedAt",
  "moderationStatus",
  "moderationFlags",
  "moderationReason",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Doc<"skills"> & keyof Doc<"skillSearchDigest">)[];

/** Fields stored in the skillSearchDigest table. */
export type SkillSearchDigestFields = Pick<Doc<"skills">, (typeof SHARED_KEYS)[number]> & {
  skillId: Id<"skills">;
  isSuspicious?: boolean;
  ownerHandle?: string;
  ownerName?: string;
  ownerDisplayName?: string;
  ownerImage?: string;
};

/** Pick the subset of fields from a full skill doc needed for the digest. */
export function extractDigestFields(skill: Doc<"skills">): SkillSearchDigestFields {
  return {
    ...pick(skill, [...SHARED_KEYS]),
    skillId: skill._id,
    isSuspicious: skill.isSuspicious,
  };
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
    if (!hasDigestChanged(existing, fields)) return;
    await ctx.db.patch(existing._id, fields);
  } else {
    await ctx.db.insert("skillSearchDigest", fields);
  }
}

/** Compare new fields against existing row. Returns true if any field differs. */
function hasDigestChanged(
  existing: Doc<"skillSearchDigest">,
  fields: SkillSearchDigestFields,
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
    "ownerHandle" | "ownerName" | "ownerDisplayName" | "ownerImage" | "ownerUserId"
  >,
): { ownerHandle: string | null; owner: PublicUser | null } | null {
  if (digest.ownerHandle === undefined) return null;
  // Empty string means backfilled but owner has no handle.
  // Use userId as fallback handle, matching the live getOwnerInfo path.
  const handle = digest.ownerHandle || undefined;
  const fallbackHandle = handle ?? String(digest.ownerUserId);
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
            _id: digest.ownerUserId,
            _creationTime: 0,
            handle,
            name: digest.ownerName,
            displayName: digest.ownerDisplayName,
            image: digest.ownerImage,
            bio: undefined,
          }
        : null,
  };
}
