export type RecommendationStats = {
  downloads: number;
  installs: number;
  stars: number;
};

const DOWNLOAD_WEIGHT = 100;
const INSTALL_WEIGHT = 160;
const STAR_WEIGHT = 120;

// Bump this when changing weights, then run statsMaintenance:runRecommendationScoreBackfillInternal.
export const RECOMMENDATION_SCORE_VERSION = 2;

function safeCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

export function computeRecommendationScore(stats: RecommendationStats) {
  const downloads = Math.log1p(safeCount(stats.downloads)) * DOWNLOAD_WEIGHT;
  const installs = Math.log1p(safeCount(stats.installs)) * INSTALL_WEIGHT;
  const stars = Math.log1p(safeCount(stats.stars)) * STAR_WEIGHT;
  return Math.round(downloads + installs + stars);
}

export function compareRecommendationStats(a: RecommendationStats, b: RecommendationStats) {
  return computeRecommendationScore(b) - computeRecommendationScore(a);
}
