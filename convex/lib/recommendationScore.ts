export type RecommendationStats = {
  downloads: number;
  installs: number;
  stars: number;
};

const DOWNLOAD_WEIGHT = 100;
const INSTALL_WEIGHT = 160;
const STAR_WEIGHT = 120;

// Bump this when changing weights, then run statsMaintenance:runRecommendationScoreBackfillInternal.
export const RECOMMENDATION_SCORE_VERSION = 3;

function safeCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

export function computeRecommendationScore(stats: RecommendationStats) {
  const downloads = Math.sqrt(safeCount(stats.downloads)) * DOWNLOAD_WEIGHT;
  const installs = Math.sqrt(safeCount(stats.installs)) * INSTALL_WEIGHT;
  const stars = Math.sqrt(safeCount(stats.stars)) * STAR_WEIGHT;
  return Math.round(downloads + installs + stars);
}

export function compareRecommendationStats(a: RecommendationStats, b: RecommendationStats) {
  return computeRecommendationScore(b) - computeRecommendationScore(a);
}
