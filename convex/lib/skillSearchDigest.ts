import { getCatalogTopicSlugs } from "clawhub-schema/catalogMetadata";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { resolvePublicBrowseVersionState } from "./publicBrowse";
import { getOwnerPublisher } from "./publishers";
import { hasDigestChanged, reconcileSearchDigestRows } from "./searchDigestRows";
import { extractDigestFields, type SkillSearchDigestFields } from "./skillSearchDigestProjection";

export async function extractValidatedDigestFields(
  ctx: Pick<MutationCtx, "db">,
  skill: Doc<"skills">,
): Promise<SkillSearchDigestFields> {
  const fields = extractDigestFields(skill);
  const version = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;
  const publicVersion = await resolvePublicBrowseVersionState(ctx, skill, {
    latestVersion: version,
  });
  if (!version || version.softDeletedAt || version.skillId !== skill._id) {
    return {
      ...fields,
      latestVersionId: undefined,
      latestVersionSkillId: undefined,
      latestVersionSummary: undefined,
      publicVersion,
    };
  }
  return { ...fields, latestVersionSkillId: version.skillId, publicVersion };
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
  await syncCuratedSkillSearchDigest(
    ctx,
    fields,
    Boolean(existing?.badges?.official || existing?.badges?.highlighted),
  );
}

async function syncCuratedSkillSearchDigest(
  ctx: Pick<MutationCtx, "db">,
  fields: SkillSearchDigestFields,
  wasCurated: boolean,
) {
  const isCurated = Boolean(fields.badges?.official || fields.badges?.highlighted);
  if (!isCurated && !wasCurated) return;
  const existing = await ctx.db
    .query("curatedSkillSearchDigest")
    .withIndex("by_skill", (q) => q.eq("skillId", fields.skillId))
    .unique();
  if (!isCurated) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }

  const next = {
    skillId: fields.skillId,
    slug: fields.slug,
    displayName: fields.displayName,
    summary: fields.summary,
    categories: fields.categories,
    topics: fields.topics,
    statsDownloads: fields.statsDownloads,
    statsStars: fields.statsStars,
    statsInstallsAllTime: fields.statsInstallsAllTime,
    recommendedScore: fields.recommendedScore,
    softDeletedAt: fields.softDeletedAt,
    isSuspicious: fields.isSuspicious,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  };
  if (existing) {
    if (hasDigestChanged(existing, next)) await ctx.db.patch(existing._id, next);
  } else {
    await ctx.db.insert("curatedSkillSearchDigest", next);
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
  await reconcileSearchDigestRows(
    ctx.db,
    "skillTopicSearchDigest",
    existing,
    nextByTopic,
    (row) => row.topic,
  );
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
  const curatedDigest = await ctx.db
    .query("curatedSkillSearchDigest")
    .withIndex("by_skill", (q) => q.eq("skillId", skillId))
    .unique();
  if (curatedDigest) await ctx.db.delete(curatedDigest._id);
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
