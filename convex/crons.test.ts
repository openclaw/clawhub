/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const interval = vi.fn();
  const githubSkillSyncRef = Symbol("github-skill-source-sync");
  const installTelemetryDedupePruneRef = Symbol("install-telemetry-dedupe-prune");
  const publisherAbuseAutobanRef = Symbol("publisher-abuse-autobans");
  const publisherAbuseScoreRefreshRef = Symbol("publisher-abuse-score-refresh");
  const publisherTemporalAbuseScanRef = Symbol("publisher-temporal-abuse-scan");
  const publisherTemporalAbuseScanPruneRef = Symbol("publisher-temporal-abuse-scan-prune");
  const httpRateLimitKeysPruneRef = Symbol("http-rate-limit-keys-prune");
  const skillStatEventPruneRef = Symbol("skill-stat-event-prune");
  const skillHourlyStatsPruneRef = Symbol("skill-hourly-stats-prune");
  const packageStatEventPruneRef = Symbol("package-stat-event-prune");
  const pluginSearchObservationPruneRef = Symbol("plugin-search-observation-prune");
  const authSessionsPruneRef = Symbol("auth-sessions-prune");
  const authRefreshTokensPruneRef = Symbol("auth-refresh-tokens-prune");
  const publisherInvitesPruneRef = Symbol("publisher-invites-prune");
  const promotionsFeedPublishRef = Symbol("promotions-feed-publish");
  const canonicalTrendingMaterializeRef = Symbol("canonical-trending-materialize");
  const canonicalTrendingPruneRef = Symbol("canonical-trending-prune");
  const prepublicationQueueHealthRef = Symbol("prepublication-queue-health");
  const securityScanExpiredLeaseRecoveryRef = Symbol("security-scan-expired-lease-recovery");
  const securityScanDispatchWatchdogRef = Symbol("security-scan-dispatch-watchdog");
  const skillEvaluationExpiredLeaseRecoveryRef = Symbol("skill-evaluation-expired-lease-recovery");
  const skillEvaluationDispatchWatchdogRef = Symbol("skill-evaluation-dispatch-watchdog");
  return {
    interval,
    cron: vi.fn(),
    searchWeeklyTick: Symbol("search-weekly-tick"),
    searchWeeklyPrune: Symbol("search-weekly-prune"),
    searchReportsPrune: Symbol("search-reports-prune"),
    downloadAnalyticsRef: Symbol("template-download-analytics"),
    githubSkillSyncRef,
    installTelemetryDedupePruneRef,
    publisherAbuseAutobanRef,
    publisherAbuseScoreRefreshRef,
    publisherTemporalAbuseScanRef,
    publisherTemporalAbuseScanPruneRef,
    httpRateLimitKeysPruneRef,
    skillStatEventPruneRef,
    skillHourlyStatsPruneRef,
    packageStatEventPruneRef,
    pluginSearchObservationPruneRef,
    authSessionsPruneRef,
    authRefreshTokensPruneRef,
    publisherInvitesPruneRef,
    promotionsFeedPublishRef,
    canonicalTrendingMaterializeRef,
    canonicalTrendingPruneRef,
    prepublicationQueueHealthRef,
    securityScanExpiredLeaseRecoveryRef,
    securityScanDispatchWatchdogRef,
    skillEvaluationExpiredLeaseRecoveryRef,
    skillEvaluationDispatchWatchdogRef,
  };
});

vi.mock("convex/server", () => ({
  cronJobs: () => ({
    interval: mocks.interval,
    cron: mocks.cron,
  }),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    searchWeeklyDigest: {
      tickInternal: mocks.searchWeeklyTick,
      pruneExpiredInternal: mocks.searchWeeklyPrune,
    },
    searchReports: {
      pruneExpiredInternal: mocks.searchReportsPrune,
    },
    downloadAnalytics: { refreshInternal: mocks.downloadAnalyticsRef },
    searchInsights: {
      aggregateInternal: Symbol("search-insights-aggregate"),
      pruneExpiredInternal: Symbol("search-insights-retention"),
    },
    canonicalTrending: {
      materializeInternal: mocks.canonicalTrendingMaterializeRef,
      pruneExpiredActionInternal: mocks.canonicalTrendingPruneRef,
    },
    githubSkillSyncNode: { syncGitHubSkillSourcesInternal: mocks.githubSkillSyncRef },
    leaderboards: { rebuildTrendingLeaderboardAction: Symbol("trending-leaderboard") },
    packageLeaderboards: {
      rebuildTrendingLeaderboardAction: Symbol("package-trending-leaderboard"),
    },
    statsMaintenance: {
      runSkillStatBackfillInternal: Symbol("skill-stats-backfill"),
      runRecommendationScoreBackfillInternal: Symbol("recommendation-score-refresh"),
      updateGlobalStatsAction: Symbol("global-stats-update"),
    },
    skillStatEvents: {
      processSkillStatEventsAction: Symbol("skill-stat-events"),
      processSkillStatEventsInternal: Symbol("skill-doc-stat-sync"),
      pruneProcessedSkillStatEventsInternal: mocks.skillStatEventPruneRef,
    },
    skillHourlyStats: {
      pruneExpiredInternal: mocks.skillHourlyStatsPruneRef,
    },
    packages: {
      processPackageStatEventsInternal: Symbol("package-stat-events"),
      pruneProcessedPackageStatEventsInternal: mocks.packageStatEventPruneRef,
      backfillPackageReleaseScansInternal: Symbol("package-scan-backfill"),
    },
    pluginSearchObservations: {
      pruneExpiredInternal: mocks.pluginSearchObservationPruneRef,
    },
    publisherAbuse: {
      runPublisherAbuseScoreRunInternal: mocks.publisherAbuseScoreRefreshRef,
      processPublisherAbuseAutobansInternal: mocks.publisherAbuseAutobanRef,
    },
    publisherAbuseTemporalScan: {
      runScheduledTemporalPublisherAbuseScanInternal: mocks.publisherTemporalAbuseScanRef,
      pruneExpiredTemporalScanRowsInternal: mocks.publisherTemporalAbuseScanPruneRef,
    },
    promotionsFeed: {
      publishInternal: mocks.promotionsFeedPublishRef,
    },
    prepublicationObservability: {
      logPrePublicationQueueHealthInternal: mocks.prepublicationQueueHealthRef,
    },
    securityScan: {
      pruneExpiredSkillScanRequestsInternal: Symbol("skill-scan-request-prune"),
      requeueExpiredCodexScanJobsInternal: mocks.securityScanExpiredLeaseRecoveryRef,
    },
    securityScanDispatch: {
      requestSecurityScanDispatchInternal: mocks.securityScanDispatchWatchdogRef,
    },
    skillEvaluationDispatch: {
      requestSkillEvaluationDispatchInternal: mocks.skillEvaluationDispatchWatchdogRef,
    },
    skillEvaluations: {
      requeueExpiredSkillEvaluationLeasesInternal: mocks.skillEvaluationExpiredLeaseRecoveryRef,
    },
    downloadMetrics: {
      pruneDownloadMetricDedupesInternal: Symbol("download-metric-dedupe-prune"),
    },
    telemetry: {
      pruneInstallTelemetryDedupesInternal: mocks.installTelemetryDedupePruneRef,
    },
    rateLimits: {
      pruneHttpRateLimitKeysInternal: mocks.httpRateLimitKeysPruneRef,
    },
    retention: {
      pruneExpiredAuthSessionsInternal: mocks.authSessionsPruneRef,
      pruneExpiredAuthRefreshTokensInternal: mocks.authRefreshTokensPruneRef,
      pruneExpiredPublisherInvitesInternal: mocks.publisherInvitesPruneRef,
    },
  },
}));

describe("crons", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.interval.mockReset();
    mocks.cron.mockReset();
    delete process.env.CLAWHUB_DISABLE_CRONS;
    delete process.env.CLAWHUB_PREVIEW;
  });

  afterEach(() => {
    delete process.env.CLAWHUB_DISABLE_CRONS;
    delete process.env.CLAWHUB_PREVIEW;
    vi.unstubAllEnvs();
  });

  it("does not register production cron work when explicitly disabled", async () => {
    process.env.CLAWHUB_DISABLE_CRONS = "1";
    vi.stubEnv("CLAWHUB_ENV", "production");

    await import("./crons");

    expect(mocks.interval).not.toHaveBeenCalled();
    expect(mocks.cron).not.toHaveBeenCalled();
  });

  it("retains only security scan recovery when Test catalog schedules are disabled", async () => {
    vi.stubEnv("CLAWHUB_ENV", "test");
    vi.stubEnv("CLAWHUB_DISABLE_CRONS", "1");

    await import("./crons");

    expect(mocks.interval.mock.calls.map(([, , ref]) => ref)).toEqual([
      mocks.securityScanExpiredLeaseRecoveryRef,
      mocks.securityScanDispatchWatchdogRef,
    ]);
    expect(mocks.cron).not.toHaveBeenCalled();
  });

  it("does not register side-effecting cron work in disposable previews", async () => {
    process.env.CLAWHUB_PREVIEW = "1";
    vi.stubEnv("CLAWHUB_ENV", "test");
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");

    await import("./crons");

    expect(mocks.interval).not.toHaveBeenCalled();
    expect(mocks.cron).not.toHaveBeenCalled();
  });

  it("checks the Pacific weekly release at the top of each hour and retains bounded delivery history", async () => {
    await import("./crons");
    expect(mocks.cron).toHaveBeenCalledWith(
      "search-weekly-digest",
      "0 * * * *",
      mocks.searchWeeklyTick,
      {},
    );
    expect(mocks.interval).toHaveBeenCalledWith(
      "search-report-retention-prune",
      { hours: 1 },
      mocks.searchReportsPrune,
      {},
    );
    expect(mocks.interval).toHaveBeenCalledWith(
      "search-weekly-digest-retention",
      { hours: 24 },
      mocks.searchWeeklyPrune,
      {},
    );
  });

  it.each([
    {
      title: "runs GitHub skill source sync once per day",
      name: "github-skill-source-sync",
      interval: { hours: 24 },
      ref: mocks.githubSkillSyncRef,
      args: {},
    },
    {
      title: "refreshes the promotions feed before its publication expires",
      name: "promotions-feed-refresh",
      interval: { hours: 6 },
      ref: mocks.promotionsFeedPublishRef,
      args: {},
    },
    {
      title: "materializes the canonical Trending snapshot hourly",
      name: "canonical-trending-snapshot",
      interval: { hours: 1 },
      ref: mocks.canonicalTrendingMaterializeRef,
      args: {},
    },
    {
      title: "prunes canonical Trending snapshots independently each hour",
      name: "canonical-trending-prune",
      interval: { hours: 1 },
      ref: mocks.canonicalTrendingPruneRef,
      args: {},
    },
    {
      title: "prunes expired hourly skill stats independently each hour",
      name: "skill-hourly-stats-prune",
      interval: { hours: 1 },
      ref: mocks.skillHourlyStatsPruneRef,
      args: { batchSize: 500 },
    },
    {
      title: "prunes expired skill scan requests in bounded continuation batches",
      name: "skill-scan-request-prune",
      interval: { hours: 6 },
      ref: expect.anything(),
      args: { batchSize: 10 },
    },
    {
      title: "runs the security scan dispatch recovery watchdog every five minutes",
      name: "codex-scan-dispatch-watchdog",
      interval: { minutes: 5 },
      ref: mocks.securityScanDispatchWatchdogRef,
      args: {},
    },
    {
      title: "logs pre-publication queue health every five minutes",
      name: "prepublication-queue-health",
      interval: { minutes: 5 },
      ref: mocks.prepublicationQueueHealthRef,
      args: {},
    },
    {
      title: "recovers expired security scan leases outside the claim hot path",
      name: "codex-scan-expired-lease-recovery",
      interval: { minutes: 5 },
      ref: mocks.securityScanExpiredLeaseRecoveryRef,
      args: {},
    },
    {
      title: "runs the skill evaluation dispatch watchdog every five minutes",
      name: "skill-evaluation-dispatch-watchdog",
      interval: { minutes: 5 },
      ref: mocks.skillEvaluationDispatchWatchdogRef,
      args: {},
    },
    {
      title: "recovers expired skill evaluation leases outside the claim hot path",
      name: "skill-evaluation-expired-lease-recovery",
      interval: { minutes: 5 },
      ref: mocks.skillEvaluationExpiredLeaseRecoveryRef,
      args: {},
    },
    {
      title: "prunes install telemetry dedupe rows daily",
      name: "install-telemetry-dedupe-prune",
      interval: { hours: 24 },
      ref: mocks.installTelemetryDedupePruneRef,
      args: {},
    },
  ])("$title", async ({ name, interval, ref, args }) => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(name, interval, ref, args);
  });

  it("registers publisher abuse cron jobs", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "publisher-abuse-score-refresh",
      { hours: 24 },
      mocks.publisherAbuseScoreRefreshRef,
      {
        batchSize: 250,
        maxPages: 20,
        trigger: "cron",
      },
    );
    expect(mocks.interval).toHaveBeenCalledWith(
      "publisher-temporal-abuse-scan",
      { hours: 24 },
      mocks.publisherTemporalAbuseScanRef,
      {},
    );
    expect(mocks.interval).toHaveBeenCalledWith(
      "publisher-temporal-abuse-scan-row-prune",
      { hours: 24 },
      mocks.publisherTemporalAbuseScanPruneRef,
      { batchSize: 500 },
    );
    expect(mocks.interval).toHaveBeenCalledWith(
      "publisher-abuse-autobans",
      { hours: 24 },
      mocks.publisherAbuseAutobanRef,
      {
        batchSize: 1,
        maxPages: 50,
      },
    );
  });

  it("prunes stale component HTTP rate limit keys hourly", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "http-rate-limit-keys-prune",
      { hours: 1 },
      mocks.httpRateLimitKeysPruneRef,
      { batchSize: 500 },
    );
  });

  it("prunes expired auth sessions and refresh tokens with the standard batch size", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "auth-session-retention-prune",
      { hours: 1 },
      mocks.authSessionsPruneRef,
      { batchSize: 500 },
    );
    expect(mocks.interval).toHaveBeenCalledWith(
      "auth-refresh-token-retention-prune",
      { hours: 6 },
      mocks.authRefreshTokensPruneRef,
      { batchSize: 500 },
    );
  });

  it("prunes expired publisher invites with the standard batch size", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "publisher-invite-retention-prune",
      { hours: 6 },
      mocks.publisherInvitesPruneRef,
      { batchSize: 500 },
    );
  });

  it("prunes plugin search observations daily with the standard batch size", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "plugin-search-observations-prune",
      { hours: 24 },
      mocks.pluginSearchObservationPruneRef,
      { batchSize: 500 },
    );
  });

  it("prunes processed skill stat events daily with a seven-day retention window", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "skill-stat-events-prune",
      { hours: 24 },
      mocks.skillStatEventPruneRef,
      {
        retentionDays: 7,
        batchSize: 1000,
        maxBatches: 20,
        confirmationToken: "PRUNE_PROCESSED_SKILL_STAT_EVENTS",
      },
    );
  });

  it("prunes processed package stat events daily with a seven-day retention window", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "package-stat-events-prune",
      { hours: 24 },
      mocks.packageStatEventPruneRef,
      {
        retentionDays: 7,
        batchSize: 1000,
        maxBatches: 20,
        confirmationToken: "PRUNE_PROCESSED_PACKAGE_STAT_EVENTS",
      },
    );
  });
});
