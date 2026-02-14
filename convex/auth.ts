import GitHub from '@auth/core/providers/github'
import { convexAuth } from '@convex-dev/auth/server'
import type { GenericMutationCtx } from 'convex/server'
import { ConvexError } from 'convex/values'
import type { DataModel, Id } from './_generated/dataModel'

export const BANNED_REAUTH_MESSAGE =
  'Your account has been banned for uploading malicious skills. If you believe this is a mistake, please contact security@openclaw.ai and we will work with you to restore access.'

const REAUTH_BLOCKING_BAN_ACTIONS = new Set(['user.ban', 'user.autoban.malware'])

export async function handleSoftDeletedUserReauth(
  ctx: GenericMutationCtx<DataModel>,
  args: { userId: Id<'users'>; existingUserId: Id<'users'> | null },
) {
  const user = await ctx.db.get(args.userId)
  if (!user?.deletedAt) return

  // Verify that the incoming identity matches the soft-deleted user to prevent bypass.
  if (args.existingUserId && args.existingUserId !== args.userId) {
    return
  }

  const userId = args.userId
  const banRecords = await ctx.db
    .query('auditLogs')
    .withIndex('by_target', (q) => q.eq('targetType', 'user').eq('targetId', userId.toString()))
    .collect()

  const hasBlockingBan = banRecords.some((record) => REAUTH_BLOCKING_BAN_ACTIONS.has(record.action))

  if (hasBlockingBan) {
    throw new ConvexError(BANNED_REAUTH_MESSAGE)
  }

  await ctx.db.patch(userId, {
    deletedAt: undefined,
    updatedAt: Date.now(),
  })
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
     * Handle re-authentication of soft-deleted users.
     *
     * Performance note: This callback runs on every OAuth sign-in, but the
     * audit log query ONLY executes when a soft-deleted user attempts to
     * sign in (user.deletedAt is set). For normal active users, this is
     * just a single `if` check on an already-loaded field - no extra queries.
     */
    async afterUserCreatedOrUpdated(ctx, args) {
      await handleSoftDeletedUserReauth(ctx, args)
    },
  },
})
