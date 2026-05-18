import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { readCanonicalStat } from "./skillStats";

export type PublisherStatsContribution = {
  publishedSkills: number;
  publishedPackages: number;
  totalInstalls: number;
  totalDownloads: number;
  totalStars: number;
};

export function emptyPublisherStatsContribution(): PublisherStatsContribution {
  return {
    publishedSkills: 0,
    publishedPackages: 0,
    totalInstalls: 0,
    totalDownloads: 0,
    totalStars: 0,
  };
}

export function getSkillPublisherContribution(skill: Doc<"skills">): PublisherStatsContribution {
  if (skill.softDeletedAt) return emptyPublisherStatsContribution();
  return {
    publishedSkills: 1,
    publishedPackages: 0,
    totalInstalls: readCanonicalStat(skill, "installsAllTime"),
    totalDownloads: readCanonicalStat(skill, "downloads"),
    totalStars: readCanonicalStat(skill, "stars"),
  };
}

export function getPackagePublisherContribution(pkg: Doc<"packages">): PublisherStatsContribution {
  if (pkg.softDeletedAt) return emptyPublisherStatsContribution();
  return {
    publishedSkills: 0,
    publishedPackages: 1,
    totalInstalls: pkg.stats.installs,
    totalDownloads: pkg.stats.downloads,
    totalStars: pkg.stats.stars,
  };
}

function publisherHasStats(publisher: Doc<"publishers">): publisher is Doc<"publishers"> & {
  publishedSkills: number;
  publishedPackages: number;
  totalInstalls: number;
  totalDownloads: number;
  totalStars: number;
} {
  return (
    typeof publisher.publishedSkills === "number" &&
    typeof publisher.publishedPackages === "number" &&
    typeof publisher.totalInstalls === "number" &&
    typeof publisher.totalDownloads === "number" &&
    typeof publisher.totalStars === "number"
  );
}

async function recomputePublisherStats(
  ctx: Pick<MutationCtx, "db">,
  publisherId: Id<"publishers">,
): Promise<PublisherStatsContribution> {
  const [skills, packages] = await Promise.all([
    ctx.db
      .query("skills")
      .withIndex("by_owner_publisher_active_updated", (q) =>
        q.eq("ownerPublisherId", publisherId).eq("softDeletedAt", undefined),
      )
      .collect(),
    ctx.db
      .query("packages")
      .withIndex("by_owner_publisher_active_updated", (q) =>
        q.eq("ownerPublisherId", publisherId).eq("softDeletedAt", undefined),
      )
      .collect(),
  ]);
  return [
    ...skills.map(getSkillPublisherContribution),
    ...packages.map(getPackagePublisherContribution),
  ].reduce(
    (total, contribution) => ({
      publishedSkills: total.publishedSkills + contribution.publishedSkills,
      publishedPackages: total.publishedPackages + contribution.publishedPackages,
      totalInstalls: total.totalInstalls + contribution.totalInstalls,
      totalDownloads: total.totalDownloads + contribution.totalDownloads,
      totalStars: total.totalStars + contribution.totalStars,
    }),
    emptyPublisherStatsContribution(),
  );
}

export function isZeroPublisherStatsContribution(delta: PublisherStatsContribution) {
  return (
    delta.publishedSkills === 0 &&
    delta.publishedPackages === 0 &&
    delta.totalInstalls === 0 &&
    delta.totalDownloads === 0 &&
    delta.totalStars === 0
  );
}

async function patchPublisherStats(
  ctx: Pick<MutationCtx, "db">,
  publisherId: Id<"publishers">,
  delta: PublisherStatsContribution,
) {
  if (isZeroPublisherStatsContribution(delta)) return;

  const publisher = await ctx.db.get(publisherId);
  if (!publisher) return;

  if (!publisherHasStats(publisher)) {
    await ctx.db.patch(publisherId, await recomputePublisherStats(ctx, publisherId));
    return;
  }

  await ctx.db.patch(publisherId, {
    publishedSkills: Math.max(0, publisher.publishedSkills + delta.publishedSkills),
    publishedPackages: Math.max(0, publisher.publishedPackages + delta.publishedPackages),
    totalInstalls: Math.max(0, publisher.totalInstalls + delta.totalInstalls),
    totalDownloads: Math.max(0, publisher.totalDownloads + delta.totalDownloads),
    totalStars: Math.max(0, publisher.totalStars + delta.totalStars),
  });
}

function diffPublisherStats(
  next: PublisherStatsContribution | null,
  previous: PublisherStatsContribution | null,
): PublisherStatsContribution {
  return {
    publishedSkills: (next?.publishedSkills ?? 0) - (previous?.publishedSkills ?? 0),
    publishedPackages: (next?.publishedPackages ?? 0) - (previous?.publishedPackages ?? 0),
    totalInstalls: (next?.totalInstalls ?? 0) - (previous?.totalInstalls ?? 0),
    totalDownloads: (next?.totalDownloads ?? 0) - (previous?.totalDownloads ?? 0),
    totalStars: (next?.totalStars ?? 0) - (previous?.totalStars ?? 0),
  };
}

export async function adjustPublisherStatsForSkillChange(
  ctx: Pick<MutationCtx, "db">,
  previousSkill: Doc<"skills"> | null | undefined,
  nextSkill: Doc<"skills"> | null | undefined,
) {
  if (!previousSkill && !nextSkill) return;

  const previousPublisherId = previousSkill?.ownerPublisherId ?? null;
  const nextPublisherId = nextSkill?.ownerPublisherId ?? null;
  const previousContribution = previousSkill ? getSkillPublisherContribution(previousSkill) : null;
  const nextContribution = nextSkill ? getSkillPublisherContribution(nextSkill) : null;

  if (previousPublisherId && previousPublisherId === nextPublisherId) {
    await patchPublisherStats(ctx, previousPublisherId, {
      ...diffPublisherStats(nextContribution, previousContribution),
    });
    return;
  }

  if (previousPublisherId) {
    await patchPublisherStats(
      ctx,
      previousPublisherId,
      diffPublisherStats(null, previousContribution),
    );
  }
  if (nextPublisherId) {
    await patchPublisherStats(ctx, nextPublisherId, diffPublisherStats(nextContribution, null));
  }
}

export async function adjustPublisherStatsForPackageChange(
  ctx: Pick<MutationCtx, "db">,
  previousPackage: Doc<"packages"> | null | undefined,
  nextPackage: Doc<"packages"> | null | undefined,
) {
  if (!previousPackage && !nextPackage) return;

  const previousPublisherId = previousPackage?.ownerPublisherId ?? null;
  const nextPublisherId = nextPackage?.ownerPublisherId ?? null;
  const previousContribution = previousPackage
    ? getPackagePublisherContribution(previousPackage)
    : null;
  const nextContribution = nextPackage ? getPackagePublisherContribution(nextPackage) : null;

  if (previousPublisherId && previousPublisherId === nextPublisherId) {
    await patchPublisherStats(ctx, previousPublisherId, {
      ...diffPublisherStats(nextContribution, previousContribution),
    });
    return;
  }

  if (previousPublisherId) {
    await patchPublisherStats(
      ctx,
      previousPublisherId,
      diffPublisherStats(null, previousContribution),
    );
  }
  if (nextPublisherId) {
    await patchPublisherStats(ctx, nextPublisherId, diffPublisherStats(nextContribution, null));
  }
}
