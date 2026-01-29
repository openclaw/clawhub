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
  { minutes: 10 },
  internal.statsMaintenance.runSkillStatBackfillInternal,
  { batchSize: 200, maxBatches: 5 },
)

crons.interval(
  'skill-stat-events',
  { minutes: 15 },
  internal.skillStatEvents.processSkillStatEventsAction,
  {},
)

export default crons
