import GitHub from '@auth/core/providers/github'
import { convexAuth } from '@convex-dev/auth/server'
import type { GenericMutationCtx } from 'convex/server'
import { ConvexError } from 'convex/values'
import { internal } from './_generated/api'
import type { DataModel, Id } from './_generated/dataModel'
import { shouldScheduleGitHubProfileSync } from './lib/githubProfileSync'

export const BANNED_REAUTH_MESSAGE =
  'Your account has been banned for uploading malicious skills. If you believe this is a mistake, please contact security@openclaw.ai and we will work with you to restore access.'
export const DELETED_ACCOUNT_REAUTH_MESSAGE =
  'This account has been permanently deleted and cannot be restored.'

const REAUTH_BLOCKING_BAN_ACTIONS = new Set(['user.ban', 'user.autoban.malware'])

export async function handleDeletedUserSignIn(
  ctx: GenericMutationCtx<DataModel>,
  args: { userId: Id<'users'>; existingUserId: Id<'users'> | null },
  userOverride?: { deletedAt?: number; deactivatedAt?: number; purgedAt?: number } | null,
) {
  const user = userOverride !== undefined ? userOverride : await ctx.db.get(args.userId)
  if (!user?.deletedAt && !user?.deactivatedAt) return

  // Verify that the incoming identity matches the existing account to prevent bypass.
  if (args.existingUserId && args.existingUserId !== args.userId) {
    return
  }

  if (user.deactivatedAt) {
    throw new ConvexError(DELETED_ACCOUNT_REAUTH_MESSAGE)
  }

  const userId = args.userId
  const deletedAt = user.deletedAt ?? Date.now()
  const banRecords = await ctx.db
    .query('auditLogs')
    .withIndex('by_target', (q) => q.eq('targetType', 'user').eq('targetId', userId.toString()))
    .collect()

  const hasBlockingBan = banRecords.some((record) => REAUTH_BLOCKING_BAN_ACTIONS.has(record.action))

  if (hasBlockingBan) {
    throw new ConvexError(BANNED_REAUTH_MESSAGE)
  }

  // Migrate legacy self-deleted accounts (stored in deletedAt) to the new
  // irreversible state and reject sign-in.
  await ctx.db.patch(userId, {
    deletedAt: undefined,
    deactivatedAt: deletedAt,
    purgedAt: user.purgedAt ?? deletedAt,
    updatedAt: Date.now(),
  })

  throw new ConvexError(DELETED_ACCOUNT_REAUTH_MESSAGE)
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID ?? '',
      clientSecret: process.env.AUTH_GITHUB_SECRET ?? '',
      profile(profile) {
        return {
          id: String(profile.id),
          name: profile.login,
          email: profile.email ?? undefined,
          image: profile.avatar_url,
        }
      },
    }),
  ],
  callbacks: {
    /**
     * Block sign-in for deleted/deactivated users and sync GitHub profile.
     *
     * Performance note: This callback runs on every OAuth sign-in, but the
     * audit log query ONLY executes when a legacy deleted user attempts to sign
     * in (user.deletedAt is set). For active users, this is a single field check.
     *
     * The GitHub profile sync is scheduled as a background action to handle
     * the case where a user renames their GitHub account (fixes #303).
     */
    async afterUserCreatedOrUpdated(ctx, args) {
      await handleDeletedUserSignIn(ctx, args)

      // Schedule GitHub profile sync to handle username renames (fixes #303)
      // This runs as a background action so it doesn't block sign-in
      await ctx.scheduler.runAfter(0, internal.users.syncGitHubProfileAction, {
        userId: args.userId,
      })
      const user = await ctx.db.get(args.userId)
      await handleDeletedUserSignIn(ctx, args, user)

      // Schedule GitHub profile sync to handle username renames (fixes #303)
      // This runs as a background action so it doesn't block sign-in
      const now = Date.now()
      if (shouldScheduleGitHubProfileSync(user, now)) {
        await ctx.scheduler.runAfter(0, internal.users.syncGitHubProfileAction, {
          userId: args.userId,
        })
      }
    },
  },
})
