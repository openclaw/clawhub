export const GITHUB_PROFILE_SYNC_WINDOW_MS = 6 * 60 * 60 * 1000

export function shouldScheduleGitHubProfileSync(
  user:
    | {
        deletedAt?: number
        deactivatedAt?: number
        githubProfileSyncedAt?: number
      }
    | null
    | undefined,
  now: number,
) {
  if (!user || user.deletedAt || user.deactivatedAt) return false
  const lastSyncedAt = user.githubProfileSyncedAt ?? null
  if (lastSyncedAt && now - lastSyncedAt < GITHUB_PROFILE_SYNC_WINDOW_MS) return false
  return true
}

