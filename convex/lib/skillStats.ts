import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { toDayKey } from "./leaderboards";

type SkillStatDeltas = {
  downloads?: number;
  stars?: number;
  installsCurrent?: number;
  installsAllTime?: number;
};

export type SkillStatReadable = {
  stats: Partial<
    Pick<Doc<"skills">["stats"], "downloads" | "stars" | "installsCurrent" | "installsAllTime">
  >;
  statsDownloads?: number;
  statsStars?: number;
  statsInstallsCurrent?: number;
  statsInstallsAllTime?: number;
  statsSkillsShInstalls?: number;
  statsGithubStars?: number;
};

type ExternalSkillMetricSnapshot = {
  skillsShInstalls?: number;
  githubStars?: number;
};

function nonNegativeCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

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
  skill: SkillStatReadable,
  field: "downloads" | "stars" | "installsCurrent" | "installsAllTime",
): number {
  const topLevelKey = `stats${field[0].toUpperCase()}${field.slice(1)}` as
    | "statsDownloads"
    | "statsStars"
    | "statsInstallsCurrent"
    | "statsInstallsAllTime";
  return typeof skill[topLevelKey] === "number" ? skill[topLevelKey]! : (skill.stats[field] ?? 0);
}

export function readSkillMetricSources(skill: SkillStatReadable) {
  return {
    clawHubDownloads: readCanonicalStat(skill, "downloads"),
    skillsShInstalls: nonNegativeCount(skill.statsSkillsShInstalls),
    openClawInstallsCurrent: readCanonicalStat(skill, "installsCurrent"),
    openClawInstallsAllTime: readCanonicalStat(skill, "installsAllTime"),
    githubStars: nonNegativeCount(skill.statsGithubStars),
    bookmarks: readCanonicalStat(skill, "stars"),
  };
}

export function readPublicDownloads(skill: SkillStatReadable): number {
  return readCanonicalStat(skill, "downloads") + nonNegativeCount(skill.statsSkillsShInstalls);
}

export function buildExternalSkillMetricPatch(snapshot: ExternalSkillMetricSnapshot) {
  return {
    ...(snapshot.skillsShInstalls === undefined
      ? {}
      : { statsSkillsShInstalls: nonNegativeCount(snapshot.skillsShInstalls) }),
    ...(snapshot.githubStars === undefined
      ? {}
      : { statsGithubStars: nonNegativeCount(snapshot.githubStars) }),
  };
}

export function applySkillStatDeltas(skill: Doc<"skills">, deltas: SkillStatDeltas) {
  const currentDownloads = readCanonicalStat(skill, "downloads");
  const currentStars = readCanonicalStat(skill, "stars");
  const currentInstallsCurrent = readCanonicalStat(skill, "installsCurrent");
  const currentInstallsAllTime = readCanonicalStat(skill, "installsAllTime");

  const nextDownloads = Math.max(0, currentDownloads + (deltas.downloads ?? 0));
  const nextStars = Math.max(0, currentStars + (deltas.stars ?? 0));
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
