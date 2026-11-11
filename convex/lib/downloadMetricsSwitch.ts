/**
 * Emergency switch (`CLAWHUB_DOWNLOAD_METRICS_PAUSED=1`): downloads keep working
 * but no download metric is scheduled or written. Already-queued metric jobs
 * become no-ops. Download counts for the paused window are not recorded.
 */
export function areDownloadMetricsPaused(): boolean {
  return process.env.CLAWHUB_DOWNLOAD_METRICS_PAUSED?.trim() === "1";
}
