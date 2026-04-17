import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { toDayKey } from "./leaderboards";

type SkillStatDeltas = {
  downloads?: number;
  stars?: number;
  comments?: number;
  installsCurrent?: number;
  installsAllTime?: number;
};

/**
 * Read the canonical value of a migrated stat field from a skill document.
 *
 * Top-level fields (`statsDownloads`, etc.) are the source of truth — they are
 * indexable and kept up-to-date by the event pipeline. The nested `stats.*`
 * fields are only used as a fallback for pre-migration documents where the
 * top-level field is still `undefined`.
 *
 * All code that reads a migrated stat value should go through this function
 * rather than accessing `skill.stats.*` directly.
 */
export function readCanonicalStat(
  skill: Doc<"skills">,
  field: "downloads" | "stars" | "installsCurrent" | "installsAllTime",
): number {
  const topLevelKey = `stats${field[0].toUpperCase()}${field.slice(1)}` as
    | "statsDownloads"
    | "statsStars"
    | "statsInstallsCurrent"
    | "statsInstallsAllTime";
  return typeof skill[topLevelKey] === "number" ? skill[topLevelKey]! : (skill.stats[field] ?? 0);
}

export function applySkillStatDeltas(skill: Doc<"skills">, deltas: SkillStatDeltas) {
  const currentDownloads = readCanonicalStat(skill, "downloads");
  const currentStars = readCanonicalStat(skill, "stars");
  const currentInstallsCurrent = readCanonicalStat(skill, "installsCurrent");
  const currentInstallsAllTime = readCanonicalStat(skill, "installsAllTime");

  const currentComments = skill.stats.comments;
  const nextDownloads = Math.max(0, currentDownloads + (deltas.downloads ?? 0));
  const nextStars = Math.max(0, currentStars + (deltas.stars ?? 0));
  const nextComments = Math.max(0, currentComments + (deltas.comments ?? 0));
  const nextInstallsCurrent = Math.max(0, currentInstallsCurrent + (deltas.installsCurrent ?? 0));
  const nextInstallsAllTime = Math.max(0, currentInstallsAllTime + (deltas.installsAllTime ?? 0));

  return {
    statsDownloads: nextDownloads,
    statsStars: nextStars,
    statsInstallsCurrent: nextInstallsCurrent,
    statsInstallsAllTime: nextInstallsAllTime,
    stats: {
      ...skill.stats,
      downloads: nextDownloads,
      stars: nextStars,
      comments: nextComments,
      installsCurrent: nextInstallsCurrent,
      installsAllTime: nextInstallsAllTime,
    },
  };
}

export async function bumpDailySkillStats(
  ctx: MutationCtx,
  params: {
    skillId: Id<"skills">;
    now: number;
    downloads?: number;
    installs?: number;
  },
) {
  const downloads = params.downloads ?? 0;
  const installs = params.installs ?? 0;
  if (downloads === 0 && installs === 0) return;

  const day = toDayKey(params.now);
  const existing = await ctx.db
    .query("skillDailyStats")
    .withIndex("by_skill_day", (q) => q.eq("skillId", params.skillId).eq("day", day))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      downloads: Math.max(0, existing.downloads + downloads),
      installs: Math.max(0, existing.installs + installs),
      updatedAt: params.now,
    });
    return;
  }

  await ctx.db.insert("skillDailyStats", {
    skillId: params.skillId,
    day,
    downloads: Math.max(0, downloads),
    installs: Math.max(0, installs),
    updatedAt: params.now,
  });
}
