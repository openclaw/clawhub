import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";

const crons = cronJobs();

if (process.env.CLAWHUB_DISABLE_CRONS !== "1" && process.env.CLAWHUB_PREVIEW !== "1") {
  crons.interval(
    "github-skill-source-sync",
    { minutes: 15 },
    internal.githubSkillSyncNode.syncGitHubSkillSourcesInternal,
    {},
  );

  crons.interval(
    "promotions-feed-refresh",
    { hours: 6 },
    internal.promotionsFeed.publishInternal,
    {},
  );

  crons.interval(
    "catalog-feed-history-prune",
    { hours: 24 },
    internal.catalogFeed.pruneCatalogFeedHistoryInternal,
    { batchSize: RETENTION_STANDARD_BATCH_SIZE },
  );

  crons.interval(
    "catalog-feed-shard-prune",
    { hours: 24 },
    internal.catalogFeedShards.pruneCatalogFeedShardsInternal,
    { batchSize: RETENTION_STANDARD_BATCH_SIZE },
  );

  crons.interval(
    "trending-leaderboard",
    { minutes: 60 },
    internal.leaderboards.rebuildTrendingLeaderboardAction,
    { limit: 200 },
  );

  crons.interval(
    "package-trending-leaderboard",
    { minutes: 60 },
    internal.packageLeaderboards.rebuildTrendingLeaderboardAction,
    { limit: 200 },
  );

  crons.interval(
    "recommendation-score-refresh",
    { hours: 6 },
    internal.statsMaintenance.runRecommendationScoreBackfillInternal,
    { batchSize: 500, maxBatches: 50 },
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
    { batchSize: 100 },
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
    "package-stat-events-prune",
    { hours: 24 },
    internal.packages.pruneProcessedPackageStatEventsInternal,
    {
      retentionDays: 7,
      batchSize: 1000,
      maxBatches: 20,
      confirmationToken: "PRUNE_PROCESSED_PACKAGE_STAT_EVENTS",
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
    { batchSize: 250, maxPages: 20, trigger: "cron" },
  );

  crons.interval(
    "publisher-temporal-abuse-scan",
    { hours: 24 },
    internal.publisherAbuseTemporalScan.runScheduledTemporalPublisherAbuseScanInternal,
    {},
  );

  crons.interval(
    "publisher-temporal-abuse-scan-row-prune",
    { hours: 24 },
    internal.publisherAbuseTemporalScan.pruneExpiredTemporalScanRowsInternal,
    { batchSize: 500 },
  );

  crons.interval(
    "publisher-abuse-signal-notifications",
    { hours: 1 },
    internal.publisherAbuse.notifyPublisherAbuseSignalChangesInternal,
    {},
  );

  crons.interval(
    "publisher-abuse-autobans",
    { hours: 24 },
    internal.publisherAbuse.processPublisherAbuseAutobansInternal,
    { batchSize: 1, maxPages: 50 },
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
    "codex-scan-queue-health",
    { minutes: 5 },
    internal.securityScan.logCodexScanQueueHealthInternal,
    {},
  );

  crons.interval(
    "prepublication-queue-health",
    { minutes: 5 },
    internal.prepublicationObservability.logPrePublicationQueueHealthInternal,
    {},
  );

  crons.interval(
    "codex-scan-expired-lease-recovery",
    { minutes: 5 },
    internal.securityScan.requeueExpiredCodexScanJobsInternal,
    {},
  );

  crons.interval(
    "codex-scan-dispatch-watchdog",
    { minutes: 5 },
    internal.securityScanDispatch.requestSecurityScanDispatchInternal,
    {},
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
    "publisher-invite-retention-prune",
    { hours: 6 },
    internal.retention.pruneExpiredPublisherInvitesInternal,
    { batchSize: RETENTION_STANDARD_BATCH_SIZE },
  );

  crons.interval(
    "http-rate-limit-keys-prune",
    { hours: 1 },
    internal.rateLimits.pruneHttpRateLimitKeysInternal,
    { batchSize: RETENTION_STANDARD_BATCH_SIZE },
  );
}

export default crons;
