import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

function getSkillContribution(skill: Doc<"skills">) {
  if (skill.softDeletedAt) {
    return { publishedSkills: 0, totalStars: 0, totalDownloads: 0 };
  }

  return {
    publishedSkills: 1,
    totalStars: skill.stats?.stars ?? 0,
    totalDownloads: skill.stats?.downloads ?? 0,
  };
}

async function patchUserStats(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
  delta: { publishedSkills: number; totalStars: number; totalDownloads: number },
) {
  const user = await ctx.db.get(userId);
  if (!user) return;

  await ctx.db.patch(userId, {
    publishedSkills: Math.max(0, (user.publishedSkills ?? 0) + delta.publishedSkills),
    totalStars: Math.max(0, (user.totalStars ?? 0) + delta.totalStars),
    totalDownloads: Math.max(0, (user.totalDownloads ?? 0) + delta.totalDownloads),
  });
}

export async function adjustUserSkillStatsForSkillChange(
  ctx: Pick<MutationCtx, "db">,
  previousSkill: Doc<"skills"> | null | undefined,
  nextSkill: Doc<"skills"> | null | undefined,
) {
  if (!previousSkill && !nextSkill) return;

  const prevOwnerId = previousSkill?.ownerUserId ?? null;
  const nextOwnerId = nextSkill?.ownerUserId ?? null;
  const prevContribution = previousSkill ? getSkillContribution(previousSkill) : null;
  const nextContribution = nextSkill ? getSkillContribution(nextSkill) : null;

  if (prevOwnerId && prevOwnerId === nextOwnerId) {
    await patchUserStats(ctx, prevOwnerId, {
      publishedSkills: (nextContribution?.publishedSkills ?? 0) - (prevContribution?.publishedSkills ?? 0),
      totalStars: (nextContribution?.totalStars ?? 0) - (prevContribution?.totalStars ?? 0),
      totalDownloads: (nextContribution?.totalDownloads ?? 0) - (prevContribution?.totalDownloads ?? 0),
    });
    return;
  }

  if (prevOwnerId) {
    await patchUserStats(ctx, prevOwnerId, {
      publishedSkills: -(prevContribution?.publishedSkills ?? 0),
      totalStars: -(prevContribution?.totalStars ?? 0),
      totalDownloads: -(prevContribution?.totalDownloads ?? 0),
    });
  }

  if (nextOwnerId) {
    await patchUserStats(ctx, nextOwnerId, {
      publishedSkills: nextContribution?.publishedSkills ?? 0,
      totalStars: nextContribution?.totalStars ?? 0,
      totalDownloads: nextContribution?.totalDownloads ?? 0,
    });
  }
}
