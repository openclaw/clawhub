import { getAuthUserId } from '@convex-dev/auth/server'
import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server'

export type Role = 'admin' | 'moderator' | 'user'

export async function requireUser(ctx: MutationCtx | QueryCtx) {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error('Unauthorized')
  const user = await ctx.db.get(userId)
  if (!user || user.deletedAt) throw new Error('User not found')
  return { userId, user }
}

export async function requireUserFromAction(ctx: ActionCtx) {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error('Unauthorized')
  const user = await ctx.runQuery(internal.users.getByIdInternal, { userId })
  if (!user || user.deletedAt) throw new Error('User not found')
  return { userId, user: user as Doc<'users'> }
}

export function assertRole(user: Doc<'users'>, allowed: Role[]) {
  if (!user.role || !allowed.includes(user.role as Role)) {
    throw new Error('Forbidden')
  }
}

export function assertAdmin(user: Doc<'users'>) {
  assertRole(user, ['admin'])
}

export function assertModerator(user: Doc<'users'>) {
  assertRole(user, ['admin', 'moderator'])
}
