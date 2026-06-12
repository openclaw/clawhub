/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const interval = vi.fn();
  const githubSkillSyncRef = Symbol("github-skill-source-sync");
  return { interval, githubSkillSyncRef };
});

vi.mock("convex/server", () => ({
  cronJobs: () => ({
    interval: mocks.interval,
  }),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    githubBackupsNode: { syncGitHubBackupsInternal: Symbol("github-backup-sync") },
    githubSkillSync: { syncGitHubSkillSourcesInternal: mocks.githubSkillSyncRef },
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
  it("runs GitHub skill source sync every 15 minutes", async () => {
    await import("./crons");

    expect(mocks.interval).toHaveBeenCalledWith(
      "github-skill-source-sync",
      { minutes: 15 },
      mocks.githubSkillSyncRef,
      {},
    );
  });
});
