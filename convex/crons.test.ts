/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const interval = vi.fn();
  const githubSkillSyncRef = Symbol("github-skill-source-sync");
  const registryArtifactBackupRetryRef = Symbol("registry-artifact-backup-retry");
  return { interval, githubSkillSyncRef, registryArtifactBackupRetryRef };
});

vi.mock("convex/server", () => ({
  cronJobs: () => ({
    interval: mocks.interval,
  }),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    registryArtifactBackupsNode: {
      processRegistryArtifactBackupRetriesInternal: mocks.registryArtifactBackupRetryRef,
    },
    githubSkillSyncNode: { syncGitHubSkillSourcesInternal: mocks.githubSkillSyncRef },
    leaderboards: { rebuildTrendingLeaderboardAction: Symbol("trending-leaderboard") },
    statsMaintenance: {
      runSkillStatBackfillInternal: Symbol("skill-stats-backfill"),
      updateGlobalStatsAction: Symbol("global-stats-update"),
    },
    skillStatEvents: { processSkillStatEventsAction: Symbol("skill-stat-events") },
    packages: {
      processPackageStatEventsInternal: Symbol("package-stat-events"),
      backfillPackageReleaseScansInternal: Symbol("package-scan-backfill"),
    },
    publisherAbuse: {
      runPublisherAbuseScoreRunInternal: Symbol("publisher-abuse-score-refresh"),
    },
    vt: {
      pollPendingScans: Symbol("vt-pending-scans"),
      backfillActiveSkillsVTCache: Symbol("vt-cache-backfill"),
    },
    securityScan: {
      pruneExpiredSkillScanRequestsInternal: Symbol("skill-scan-request-prune"),
    },
    downloads: { pruneDownloadDedupesInternal: Symbol("download-dedupe-prune") },
    downloadMetrics: {
      pruneDownloadMetricDedupesInternal: Symbol("download-metric-dedupe-prune"),
    },
  },
}));

describe("crons", () => {
  it("drains registry artifact backup retries frequently enough for publish bursts", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "registry-artifact-backup-retries",
      { minutes: 5 },
      mocks.registryArtifactBackupRetryRef,
      {},
    );
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

  it("prunes expired skill scan requests in bounded continuation batches", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "skill-scan-request-prune",
      { hours: 6 },
      expect.anything(),
      { batchSize: 10 },
    );
  });
});
