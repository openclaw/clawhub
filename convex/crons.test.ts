/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const interval = vi.fn();
  const githubSkillSyncRef = Symbol("github-skill-source-sync");
  const installTelemetryDedupePruneRef = Symbol("install-telemetry-dedupe-prune");
  const publisherAbuseAutobanRef = Symbol("publisher-abuse-autobans");
  const publisherAbuseSignalNotificationsRef = Symbol("publisher-abuse-signal-notifications");
  const publisherAbuseScoreRefreshRef = Symbol("publisher-abuse-score-refresh");
  const publisherTemporalAbuseScanRef = Symbol("publisher-temporal-abuse-scan");
  const httpRateLimitKeysPruneRef = Symbol("http-rate-limit-keys-prune");
  const skillStatEventPruneRef = Symbol("skill-stat-event-prune");
  const packageStatEventPruneRef = Symbol("package-stat-event-prune");
  const authSessionsPruneRef = Symbol("auth-sessions-prune");
  const authRefreshTokensPruneRef = Symbol("auth-refresh-tokens-prune");
  const publisherInvitesPruneRef = Symbol("publisher-invites-prune");
  const promotionsFeedPublishRef = Symbol("promotions-feed-publish");
  return {
    interval,
    githubSkillSyncRef,
    installTelemetryDedupePruneRef,
    publisherAbuseAutobanRef,
    publisherAbuseSignalNotificationsRef,
    publisherAbuseScoreRefreshRef,
    publisherTemporalAbuseScanRef,
    httpRateLimitKeysPruneRef,
    skillStatEventPruneRef,
    packageStatEventPruneRef,
    authSessionsPruneRef,
    authRefreshTokensPruneRef,
    publisherInvitesPruneRef,
    promotionsFeedPublishRef,
  };
});

vi.mock("convex/server", () => ({
  cronJobs: () => ({
    interval: mocks.interval,
  }),
}));

vi.mock("./_generated/api", () => ({
  internal: {
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
    packages: {
      processPackageStatEventsInternal: Symbol("package-stat-events"),
      pruneProcessedPackageStatEventsInternal: mocks.packageStatEventPruneRef,
      backfillPackageReleaseScansInternal: Symbol("package-scan-backfill"),
    },
    publisherAbuse: {
      runPublisherAbuseScoreRunInternal: mocks.publisherAbuseScoreRefreshRef,
      runTemporalPublisherAbuseScanInternal: mocks.publisherTemporalAbuseScanRef,
      notifyPublisherAbuseSignalChangesInternal: mocks.publisherAbuseSignalNotificationsRef,
      processPublisherAbuseAutobansInternal: mocks.publisherAbuseAutobanRef,
    },
    promotionsFeed: {
      publishInternal: mocks.promotionsFeedPublishRef,
    },
    vt: {
      pollPendingScans: Symbol("vt-pending-scans"),
      backfillActiveSkillsVTCache: Symbol("vt-cache-backfill"),
    },
    securityScan: {
      pruneExpiredSkillScanRequestsInternal: Symbol("skill-scan-request-prune"),
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
    delete process.env.CLAWHUB_DISABLE_CRONS;
    delete process.env.CLAWHUB_PREVIEW;
  });

  afterEach(() => {
    delete process.env.CLAWHUB_DISABLE_CRONS;
    delete process.env.CLAWHUB_PREVIEW;
  });

  it("does not register production cron work when explicitly disabled", async () => {
    process.env.CLAWHUB_DISABLE_CRONS = "1";

    await import("./crons");

    expect(mocks.interval).not.toHaveBeenCalled();
  });

  it("does not register side-effecting cron work in disposable previews", async () => {
    process.env.CLAWHUB_PREVIEW = "1";

    await import("./crons");

    expect(mocks.interval).not.toHaveBeenCalled();
  });

  it("runs GitHub skill source sync every 15 minutes", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "github-skill-source-sync",
      { minutes: 15 },
      mocks.githubSkillSyncRef,
      {},
    );
  });

  it("refreshes the promotions feed before its publication expires", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "promotions-feed-refresh",
      { hours: 6 },
      mocks.promotionsFeedPublishRef,
      {},
    );
  });

  it("prunes expired skill scan requests in bounded continuation batches", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "skill-scan-request-prune",
      { hours: 6 },
      expect.anything(),
      { batchSize: 10 },
    );
  });

  it("prunes install telemetry dedupe rows daily", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "install-telemetry-dedupe-prune",
      { hours: 24 },
      mocks.installTelemetryDedupePruneRef,
      {},
    );
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
      {
        mode: "current",
        dryRun: true,
        archiveDryRunSignals: true,
        candidateLimit: 1_000,
        batchSize: 50,
        maxPages: 20,
        trigger: "cron",
      },
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
    expect(mocks.interval).toHaveBeenCalledWith(
      "publisher-abuse-signal-notifications",
      { hours: 1 },
      mocks.publisherAbuseSignalNotificationsRef,
      {},
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
