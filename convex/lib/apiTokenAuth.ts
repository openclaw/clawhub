import { ConvexError } from 'convex/values'
import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { hashToken } from './tokens'

type TokenAuthResult = { user: Doc<'users'>; userId: Doc<'users'>['_id'] }

export async function requireApiTokenUser(
  ctx: ActionCtx,
  request: Request,
): Promise<TokenAuthResult> {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization')
  const token = parseBearerToken(header)
  if (!token) throw new ConvexError('Unauthorized')

  const tokenHash = await hashToken(token)
  const apiToken = await ctx.runQuery(internal.tokens.getByHashInternal, { tokenHash })
  if (!apiToken || apiToken.revokedAt) throw new ConvexError('Unauthorized')

  const user = await ctx.runQuery(internal.tokens.getUserForTokenInternal, {
    tokenId: apiToken._id,
  })
  if (!user || user.deletedAt || user.deactivatedAt) throw new ConvexError('Unauthorized')

  await ctx.runMutation(internal.tokens.touchInternal, { tokenId: apiToken._id })
  return { user, userId: user._id }
}

export async function getOptionalApiTokenUserId(
  ctx: ActionCtx,
  request: Request,
): Promise<Doc<'users'>['_id'] | null> {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization')
  const token = parseBearerToken(header)
  if (!token) return null

  const tokenHash = await hashToken(token)
  const apiToken = await ctx.runQuery(internal.tokens.getByHashInternal, { tokenHash })
  if (!apiToken || apiToken.revokedAt) return null

  const user = await ctx.runQuery(internal.tokens.getUserForTokenInternal, {
    tokenId: apiToken._id,
  })
  if (!user || user.deletedAt || user.deactivatedAt) return null

  return user._id
}

function parseBearerToken(header: string | null) {
  if (!header) return null
  const trimmed = header.trim()
  if (!trimmed.toLowerCase().startsWith('bearer ')) return null
  const token = trimmed.slice(7).trim()
  return token || null
}
