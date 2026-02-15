import { ConvexError } from 'convex/values'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { GITHUB_PROFILE_SYNC_WINDOW_MS } from './githubProfileSync'

const GITHUB_API = 'https://api.github.com'
const MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000

type GitHubUser = {
  login?: string
  name?: string
  avatar_url?: string
  created_at?: string
}

function assertGitHubNumericId(providerAccountId: string) {
  if (!/^[0-9]+$/.test(providerAccountId)) {
    throw new ConvexError('GitHub account lookup failed')
  }
}

function buildGitHubHeaders() {
  const headers: Record<string, string> = { 'User-Agent': 'clawhub' }
  const token = process.env.GITHUB_TOKEN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

export async function requireGitHubAccountAge(ctx: ActionCtx, userId: Id<'users'>) {
  const user = await ctx.runQuery(internal.users.getByIdInternal, { userId })
  if (!user || user.deletedAt || user.deactivatedAt) throw new ConvexError('User not found')

  const now = Date.now()
  let createdAt = user.githubCreatedAt ?? null

  if (!createdAt) {
    const providerAccountId = await ctx.runQuery(
      internal.githubIdentity.getGitHubProviderAccountIdInternal,
      { userId },
    )
    if (!providerAccountId) {
      // Invariant: GitHub is our only auth provider, so this should never happen.
      throw new ConvexError('GitHub account required')
    }
    assertGitHubNumericId(providerAccountId)

    // Fetch by immutable GitHub numeric ID to avoid username swap attacks entirely.
    const response = await fetch(`${GITHUB_API}/user/${providerAccountId}`, {
      headers: buildGitHubHeaders(),
    })
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        throw new ConvexError('GitHub API rate limit exceeded — please try again in a few minutes')
      }
      throw new ConvexError('GitHub account lookup failed')
    }

    const payload = (await response.json()) as GitHubUser
    const parsed = payload.created_at ? Date.parse(payload.created_at) : Number.NaN
    if (!Number.isFinite(parsed)) throw new ConvexError('GitHub account lookup failed')

    createdAt = parsed
    await ctx.runMutation(internal.users.setGitHubCreatedAtInternal, {
      userId,
      githubCreatedAt: createdAt,
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

/**
 * Sync the user's GitHub profile (username, avatar) from the GitHub API.
 * This handles the case where a user renames their GitHub account.
 * Uses the immutable GitHub numeric ID to fetch the current profile.
 */
export async function syncGitHubProfile(ctx: ActionCtx, userId: Id<'users'>) {
  const user = await ctx.runQuery(internal.users.getByIdInternal, { userId })
  if (!user || user.deletedAt || user.deactivatedAt) return

  const now = Date.now()
  const lastSyncedAt = user.githubProfileSyncedAt ?? null
  if (lastSyncedAt && now - lastSyncedAt < GITHUB_PROFILE_SYNC_WINDOW_MS) return

  const providerAccountId = await ctx.runQuery(
    internal.githubIdentity.getGitHubProviderAccountIdInternal,
    { userId },
  )
  if (!providerAccountId) return

  assertGitHubNumericId(providerAccountId)

  const response = await fetch(`${GITHUB_API}/user/${providerAccountId}`, {
    headers: buildGitHubHeaders(),
  })
  if (!response.ok) {
    // Silently fail - this is a best-effort sync, not critical path
    console.warn(`[syncGitHubProfile] GitHub API error for user ${userId}: ${response.status}`)
    return
  }

  const payload = (await response.json()) as GitHubUser
  const newLogin = payload.login?.trim()
  const newImage = payload.avatar_url?.trim()
  const profileName = payload.name?.trim()

  if (!newLogin) return

  const args: {
    userId: Id<'users'>
    name: string
    image?: string
    syncedAt: number
    profileName?: string
  } = {
    userId,
    name: newLogin,
    image: newImage,
    syncedAt: now,
  }
  if (profileName && profileName !== newLogin) {
    args.profileName = profileName
  }

  await ctx.runMutation(internal.users.syncGitHubProfileInternal, args)
}
