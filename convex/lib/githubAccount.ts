import { ConvexError } from 'convex/values'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'

const GITHUB_API = 'https://api.github.com'
const MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000
const FETCH_TTL_MS = 24 * 60 * 60 * 1000

type GitHubUser = {
  id?: number
  created_at?: string
}

export async function requireGitHubAccountAge(ctx: ActionCtx, userId: Id<'users'>) {
  const user = await ctx.runQuery(internal.users.getByIdInternal, { userId })
  if (!user || user.deletedAt) throw new ConvexError('User not found')

  const handle = user.handle?.trim()
  if (!handle) throw new ConvexError('GitHub handle required')

  const now = Date.now()
  let createdAt = user.githubCreatedAt ?? null
  const fetchedAt = user.githubFetchedAt ?? 0
  const stale = !createdAt || now - fetchedAt > FETCH_TTL_MS

  if (stale) {
    const response = await fetch(`${GITHUB_API}/users/${encodeURIComponent(handle)}`, {
      headers: { 'User-Agent': 'clawhub' },
    })
    if (!response.ok) throw new ConvexError('GitHub account lookup failed')

    const payload = (await response.json()) as GitHubUser
    const parsed = payload.created_at ? Date.parse(payload.created_at) : Number.NaN
    if (!Number.isFinite(parsed)) throw new ConvexError('GitHub account lookup failed')

    // Verify the GitHub user ID matches to prevent username swap attacks
    const storedGithubId = await ctx.runQuery(internal.users.getGithubAccountIdInternal, { userId })
    if (storedGithubId && payload.id !== undefined && String(payload.id) !== storedGithubId) {
      throw new ConvexError('GitHub account mismatch - username may have changed ownership')
    }

    createdAt = parsed
    await ctx.runMutation(internal.users.updateGithubMetaInternal, {
      userId,
      githubCreatedAt: createdAt,
      githubFetchedAt: now,
    })
  }

  if (!createdAt) throw new ConvexError('GitHub account lookup failed')

  const ageMs = now - createdAt
  if (ageMs < MIN_ACCOUNT_AGE_MS) {
    const remainingMs = MIN_ACCOUNT_AGE_MS - ageMs
    const remainingDays = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)))
    throw new ConvexError(
      `GitHub account must be at least 7 days old to upload skills. Try again in ${remainingDays} day${
        remainingDays === 1 ? '' : 's'
      }.`,
    )
  }
}
