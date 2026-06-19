import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";

const crons = cronJobs();

if (process.env.CLAWHUB_DISABLE_CRONS !== "1") {
  crons.interval(
    "github-skill-source-sync",
    { minutes: 15 },
    internal.githubSkillSyncNode.syncGitHubSkillSourcesInternal,
    {},
  );

  crons.interval(
    "trending-leaderboard",
    { minutes: 60 },
    internal.leaderboards.rebuildTrendingLeaderboardAction,
    { limit: 200 },
  );

  crons.interval(
    "skill-stats-backfill",
    { hours: 6 },
    internal.statsMaintenance.runSkillStatBackfillInternal,
    { batchSize: 200, maxBatches: 5 },
  );

  // Runs frequently to keep dailyStats/trending accurate,
  // but does NOT patch skill documents (only writes to skillDailyStats).
  crons.interval(
    "skill-stat-events",
    { minutes: 15 },
    internal.skillStatEvents.processSkillStatEventsAction,
    {},
  );

  crons.interval(
    "package-stat-events",
    { minutes: 15 },
    internal.packages.processPackageStatEventsInternal,
    { batchSize: 500 },
  );

  // Syncs accumulated stat deltas to skill documents every 6 hours.
  // Runs infrequently to avoid thundering-herd reactive query invalidation.
  // Uses processedAt field to track progress (independent of the action cursor).
  crons.interval(
    "skill-doc-stat-sync",
    { hours: 6 },
    internal.skillStatEvents.processSkillStatEventsInternal,
    { batchSize: 100 },
  );

  crons.interval(
    "skill-stat-events-prune",
    { hours: 24 },
    internal.skillStatEvents.pruneProcessedSkillStatEventsInternal,
    {
      retentionDays: 7,
      batchSize: 1000,
      maxBatches: 20,
      confirmationToken: "PRUNE_PROCESSED_SKILL_STAT_EVENTS",
    },
  );

  crons.interval(
    "global-stats-update",
    { hours: 24 },
    internal.statsMaintenance.updateGlobalStatsAction,
    {},
  );

  crons.interval(
    "publisher-abuse-score-refresh",
    { hours: 24 },
    internal.publisherAbuse.runPublisherAbuseScoreRunInternal,
    { batchSize: 250, maxPages: 5, trigger: "cron" },
  );

  crons.interval(
    "publisher-temporal-abuse-scan",
    { hours: 24 },
    internal.publisherAbuse.runTemporalPublisherAbuseScanInternal,
    {
      mode: "current",
      dryRun: false,
      candidateLimit: 1000,
      batchSize: 50,
      maxPages: 20,
      trigger: "cron",
    },
  );

  crons.interval("vt-pending-scans", { minutes: 5 }, internal.vt.pollPendingScans, {
    batchSize: 100,
  });

  crons.interval("vt-cache-backfill", { minutes: 30 }, internal.vt.backfillActiveSkillsVTCache, {
    batchSize: 100,
  });

  crons.interval(
    "package-scan-backfill",
    { minutes: 30 },
    internal.packages.backfillPackageReleaseScansInternal,
    { batchSize: 100 },
  );

  crons.interval(
    "skill-scan-request-prune",
    { hours: 6 },
    internal.securityScan.pruneExpiredSkillScanRequestsInternal,
    { batchSize: 10 },
  );

  crons.interval(
    "download-metric-dedupe-prune",
    { hours: 24 },
    internal.downloadMetrics.pruneDownloadMetricDedupesInternal,
    {},
  );

  crons.interval(
    "install-telemetry-dedupe-prune",
    { hours: 24 },
    internal.telemetry.pruneInstallTelemetryDedupesInternal,
    {},
  );

  crons.interval(
    "auth-session-retention-prune",
    { hours: 1 },
    internal.retention.pruneExpiredAuthSessionsInternal,
    { batchSize: RETENTION_STANDARD_BATCH_SIZE },
  );

  crons.interval(
    "auth-refresh-token-retention-prune",
    { hours: 6 },
    internal.retention.pruneExpiredAuthRefreshTokensInternal,
    { batchSize: RETENTION_STANDARD_BATCH_SIZE },
  );

  crons.interval(
    "rate-limit-counters-prune",
    { minutes: 15 },
    internal.rateLimits.pruneRateLimitCountersInternal,
    { batchSize: RETENTION_STANDARD_BATCH_SIZE },
  );
}

export default crons;
