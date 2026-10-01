export type RecommendationStats = {
  downloads: number;
  installs: number;
  stars: number;
};

export type RecommendationContext = {
  createdAt?: number;
  updatedAt?: number;
  now?: number;
};

const DOWNLOAD_WEIGHT = 55;
const INSTALL_WEIGHT = 150;
const STAR_WEIGHT = 115;
const FRESHNESS_WEIGHT = 70;
const NOVELTY_WEIGHT = 100;
const FRESHNESS_HALF_LIFE_DAYS = 120;
const NOVELTY_WINDOW_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1_000;

// Bump this when changing weights, then run statsMaintenance:runRecommendationScoreBackfillInternal.
export const RECOMMENDATION_SCORE_VERSION = 4;

function safeCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

function getAgeDays(timestamp: number | undefined, now: number) {
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (now - (timestamp as number)) / DAY_MS);
}

export function computeRecommendationScore(
  stats: RecommendationStats,
  context: RecommendationContext = {},
) {
  const downloads = Math.sqrt(safeCount(stats.downloads)) * DOWNLOAD_WEIGHT;
  const installs = Math.sqrt(safeCount(stats.installs)) * INSTALL_WEIGHT;
  const stars = Math.sqrt(safeCount(stats.stars)) * STAR_WEIGHT;
  const now = Number.isFinite(context.now) ? (context.now as number) : Date.now();
  const updatedAgeDays = getAgeDays(context.updatedAt, now);
  const createdAgeDays = getAgeDays(context.createdAt, now);
  const freshness =
    updatedAgeDays === null
      ? 0
      : Math.exp((-Math.LN2 * updatedAgeDays) / FRESHNESS_HALF_LIFE_DAYS) * FRESHNESS_WEIGHT;
  const novelty =
    createdAgeDays === null || createdAgeDays > NOVELTY_WINDOW_DAYS
      ? 0
      : (1 - createdAgeDays / NOVELTY_WINDOW_DAYS) * NOVELTY_WEIGHT;
  return Math.round(downloads + installs + stars + freshness + novelty);
}

export function compareRecommendationStats(a: RecommendationStats, b: RecommendationStats) {
  return computeRecommendationScore(b) - computeRecommendationScore(a);
}
