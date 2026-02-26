import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.interval(
  'github-backup-sync',
  { minutes: 30 },
  internal.githubBackupsNode.syncGitHubBackupsInternal,
  { batchSize: 50, maxBatches: 5 },
)

crons.interval(
  'trending-leaderboard',
  { minutes: 60 },
  internal.leaderboards.rebuildTrendingLeaderboardInternal,
  { limit: 200 },
)

crons.interval(
  'skill-stats-backfill',
  { hours: 6 },
  internal.statsMaintenance.runSkillStatBackfillInternal,
  { batchSize: 200, maxBatches: 5 },
)

// Runs frequently to keep dailyStats/trending accurate,
// but does NOT patch skill documents (only writes to skillDailyStats).
crons.interval(
  'skill-stat-events',
  { minutes: 15 },
  internal.skillStatEvents.processSkillStatEventsAction,
  {},
)

// Syncs accumulated stat deltas to skill documents every 6 hours.
// Runs infrequently to avoid thundering-herd reactive query invalidation.
// Uses processedAt field to track progress (independent of the action cursor).
crons.interval(
  'skill-doc-stat-sync',
  { hours: 6 },
  internal.skillStatEvents.processSkillStatEventsInternal,
  { batchSize: 500 },
)

crons.interval(
  'global-stats-update',
  { minutes: 60 },
  internal.statsMaintenance.updateGlobalStatsInternal,
  {},
)

crons.interval('vt-pending-scans', { minutes: 5 }, internal.vt.pollPendingScans, { batchSize: 100 })

crons.interval('vt-cache-backfill', { minutes: 30 }, internal.vt.backfillActiveSkillsVTCache, {
  batchSize: 100,
})

// Daily re-scan of all active skills at 3am UTC
crons.daily('vt-daily-rescan', { hourUTC: 3, minuteUTC: 0 }, internal.vt.rescanActiveSkills, {})

crons.interval(
  'download-dedupe-prune',
  { hours: 24 },
  internal.downloads.pruneDownloadDedupesInternal,
  {},
)

export default crons
