import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.interval(
  'github-backup-sync',
  { minutes: 30 },
  internal.githubBackupsNode.syncGitHubBackupsInternal,
  {},
)

export default crons
