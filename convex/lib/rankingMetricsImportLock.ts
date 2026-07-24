export const RANKING_METRICS_IMPORT_LOCK_ENV = "CLAWHUB_RANKING_METRICS_IMPORT_LOCK";

export function assertRankingMetricWritesAllowed(now = Date.now()) {
  const lock = process.env[RANKING_METRICS_IMPORT_LOCK_ENV];
  if (!lock) return;
  const expiresAt = Number(lock.split(":").at(-1));
  if (Number.isSafeInteger(expiresAt) && expiresAt <= now) return;
  throw new Error("Ranking import source writes are temporarily paused for a Test dataset import");
}
