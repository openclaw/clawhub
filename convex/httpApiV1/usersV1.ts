import { api, internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { requireApiTokenUser } from '../lib/apiTokenAuth'
import { applyRateLimit } from '../lib/httpRateLimit'
import {
  getPathSegments,
  json,
  parseJsonPayload,
  requireAdminOrResponse,
  requireApiTokenUserOrResponse,
  text,
  toOptionalNumber,
} from './shared'

export async function usersPostRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'write')
  if (!rate.ok) return rate.response

  const segments = getPathSegments(request, '/api/v1/users/')
  if (segments.length !== 1) {
    return text('Not found', 404, rate.headers)
  }
  const action = segments[0]
  if (action !== 'ban' && action !== 'role' && action !== 'restore' && action !== 'reclaim') {
    return text('Not found', 404, rate.headers)
  }

  const payloadResult = await parseJsonPayload(request, rate.headers)
  if (!payloadResult.ok) return payloadResult.response
  const payload = payloadResult.payload

  const authResult = await requireApiTokenUserOrResponse(ctx, request, rate.headers)
  if (!authResult.ok) return authResult.response
  const actorUserId = authResult.userId
  const actorUser = authResult.user

  // Restore and reclaim have different parameter shapes, handle them separately
  if (action === 'restore') {
    const admin = requireAdminOrResponse(actorUser, rate.headers)
    if (!admin.ok) return admin.response
    return handleAdminRestore(ctx, request, payload, actorUserId, rate.headers)
  }

  if (action === 'reclaim') {
    const admin = requireAdminOrResponse(actorUser, rate.headers)
    if (!admin.ok) return admin.response
    return handleAdminReclaim(ctx, request, payload, actorUserId, rate.headers)
  }

  const handleRaw = typeof payload.handle === 'string' ? payload.handle.trim() : ''
  const userIdRaw = typeof payload.userId === 'string' ? payload.userId.trim() : ''
  const reasonRaw = typeof payload.reason === 'string' ? payload.reason.trim() : ''
  if (!handleRaw && !userIdRaw) {
    return text('Missing userId or handle', 400, rate.headers)
  }

  const roleRaw = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : ''
  if (action === 'role' && !roleRaw) {
    return text('Missing role', 400, rate.headers)
  }
  const role = roleRaw === 'user' || roleRaw === 'moderator' || roleRaw === 'admin' ? roleRaw : null
  if (action === 'role' && !role) {
    return text('Invalid role', 400, rate.headers)
  }

  let targetUserId: Id<'users'> | null = userIdRaw ? (userIdRaw as Id<'users'>) : null
  if (!targetUserId) {
    const handle = handleRaw.toLowerCase()
    const user = await ctx.runQuery(api.users.getByHandle, { handle })
    if (!user?._id) return text('User not found', 404, rate.headers)
    targetUserId = user._id
  }

  if (action === 'ban') {
    const reason = reasonRaw.length > 0 ? reasonRaw : undefined
    if (reason && reason.length > 500) {
      return text('Reason too long (max 500 chars)', 400, rate.headers)
    }
    try {
      const result = await ctx.runMutation(internal.users.banUserInternal, {
        actorUserId,
        targetUserId,
        reason,
      })
      return json(result, 200, rate.headers)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ban failed'
      if (message.toLowerCase().includes('forbidden')) {
        return text('Forbidden', 403, rate.headers)
      }
      if (message.toLowerCase().includes('not found')) {
        return text(message, 404, rate.headers)
      }
      return text(message, 400, rate.headers)
    }
  }

  if (!role) {
    return text('Invalid role', 400, rate.headers)
  }

  try {
    const result = await ctx.runMutation(internal.users.setRoleInternal, {
      actorUserId,
      targetUserId,
      role,
    })
    return json({ ok: true, role: result.role ?? role }, 200, rate.headers)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Role change failed'
    if (message.toLowerCase().includes('forbidden')) {
      return text('Forbidden', 403, rate.headers)
    }
    if (message.toLowerCase().includes('not found')) {
      return text(message, 404, rate.headers)
    }
    return text(message, 400, rate.headers)
  }
}

/**
 * POST /api/v1/users/restore
 * Admin-only: restore skills from GitHub backup for a user.
 * Body: { handle: string, slugs: string[], forceOverwriteSquatter?: boolean }
 */
async function handleAdminRestore(
  ctx: ActionCtx,
  _request: Request,
  payload: Record<string, unknown>,
  actorUserId: Id<'users'>,
  headers: HeadersInit,
) {
  const handle = typeof payload.handle === 'string' ? payload.handle.trim().toLowerCase() : ''
  if (!handle) return text('Missing handle', 400, headers)

  const slugs = Array.isArray(payload.slugs) ? payload.slugs.filter((s): s is string => typeof s === 'string') : []
  if (slugs.length === 0) return text('Missing slugs array', 400, headers)
  if (slugs.length > 100) return text('Too many slugs (max 100)', 400, headers)

  const forceOverwriteSquatter = Boolean(payload.forceOverwriteSquatter)

  const targetUser = await ctx.runQuery(api.users.getByHandle, { handle })
  if (!targetUser?._id) return text('User not found', 404, headers)

  try {
    const result = await ctx.runAction(internal.githubRestore.restoreUserSkillsFromBackup, {
      actorUserId,
      ownerHandle: handle,
      ownerUserId: targetUser._id,
      slugs,
      forceOverwriteSquatter,
    })
    return json(result, 200, headers)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Restore failed'
    if (message.toLowerCase().includes('forbidden')) {
      return text('Forbidden', 403, headers)
    }
    return text(message, 400, headers)
  }
}

/**
 * POST /api/v1/users/reclaim
 * Admin-only: reclaim squatted slugs and reserve them for the rightful owner.
 * Body: { handle: string, slugs: string[], reason?: string }
 */
async function handleAdminReclaim(
  ctx: ActionCtx,
  _request: Request,
  payload: Record<string, unknown>,
  actorUserId: Id<'users'>,
  headers: HeadersInit,
) {
  const handle = typeof payload.handle === 'string' ? payload.handle.trim().toLowerCase() : ''
  if (!handle) return text('Missing handle', 400, headers)

  const slugs = Array.isArray(payload.slugs) ? payload.slugs.filter((s): s is string => typeof s === 'string') : []
  if (slugs.length === 0) return text('Missing slugs array', 400, headers)
  if (slugs.length > 200) return text('Too many slugs (max 200)', 400, headers)

  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : undefined

  const targetUser = await ctx.runQuery(api.users.getByHandle, { handle })
  if (!targetUser?._id) return text('User not found', 404, headers)

  const results: Array<{ slug: string; ok: boolean; error?: string }> = []
  for (const slug of slugs) {
    try {
      await ctx.runMutation(internal.skills.reclaimSlugInternal, {
        actorUserId,
        slug: slug.trim().toLowerCase(),
        rightfulOwnerUserId: targetUser._id,
        reason,
      })
      results.push({ slug, ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reclaim failed'
      results.push({ slug, ok: false, error: message })
    }
  }

  const succeeded = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length

  return json({ ok: true, results, succeeded, failed }, 200, headers)
}

export async function usersListV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'read')
  if (!rate.ok) return rate.response

  const url = new URL(request.url)
  const limitRaw = toOptionalNumber(url.searchParams.get('limit'))
  const query = url.searchParams.get('q') ?? url.searchParams.get('query') ?? ''

  let actorUserId: Id<'users'>
  try {
    const auth = await requireApiTokenUser(ctx, request)
    actorUserId = auth.userId
  } catch {
    return text('Unauthorized', 401, rate.headers)
  }

  const limit = Math.min(Math.max(limitRaw ?? 20, 1), 200)
  try {
    const result = await ctx.runQuery(internal.users.searchInternal, {
      actorUserId,
      query,
      limit,
    })
    return json(result, 200, rate.headers)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'User search failed'
    if (message.toLowerCase().includes('forbidden')) {
      return text('Forbidden', 403, rate.headers)
    }
    if (message.toLowerCase().includes('unauthorized')) {
      return text('Unauthorized', 401, rate.headers)
    }
    return text(message, 400, rate.headers)
  }
}
