import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type ReservedSlug = Doc<'reservedSlugs'>

const DEFAULT_ACTIVE_LIMIT = 25

function reservedSlugQuery(ctx: QueryCtx | MutationCtx, slug: string) {
  return ctx.db
    .query('reservedSlugs')
    .withIndex('by_slug_active_deletedAt', (q) => q.eq('slug', slug).eq('releasedAt', undefined))
    .order('desc')
}

export async function listActiveReservedSlugsForSlug(
  ctx: QueryCtx | MutationCtx,
  slug: string,
  limit = DEFAULT_ACTIVE_LIMIT,
) {
  return reservedSlugQuery(ctx, slug).take(limit)
}

export async function getLatestActiveReservedSlug(ctx: QueryCtx | MutationCtx, slug: string) {
  return (await reservedSlugQuery(ctx, slug).take(1))[0] ?? null
}

export async function releaseDuplicateActiveReservations(
  ctx: MutationCtx,
  active: ReservedSlug[],
  keepId: Id<'reservedSlugs'> | null | undefined,
  releasedAt: number,
) {
  for (const stale of active) {
    if (keepId && stale._id === keepId) continue
    await ctx.db.patch(stale._id, { releasedAt })
  }
}

export async function reserveSlugForHardDeleteFinalize(
  ctx: MutationCtx,
  params: {
    slug: string
    originalOwnerUserId: Id<'users'>
    deletedAt: number
    expiresAt: number
  },
) {
  const active = await listActiveReservedSlugsForSlug(ctx, params.slug)
  const latest = active[0] ?? null

  if (latest) {
    // Only extend reservation if it matches the owner being deleted.
    // If it points elsewhere, it likely came from a reclaim flow; do not overwrite.
    if (latest.originalOwnerUserId === params.originalOwnerUserId) {
      await ctx.db.patch(latest._id, {
        deletedAt: params.deletedAt,
        expiresAt: params.expiresAt,
        releasedAt: undefined,
      })
    }
    await releaseDuplicateActiveReservations(ctx, active, latest._id, params.deletedAt)
    return
  }

  const inserted = await ctx.db.insert('reservedSlugs', {
    slug: params.slug,
    originalOwnerUserId: params.originalOwnerUserId,
    deletedAt: params.deletedAt,
    expiresAt: params.expiresAt,
  })
  await releaseDuplicateActiveReservations(ctx, active, inserted, params.deletedAt)
}

export async function upsertReservedSlugForRightfulOwner(
  ctx: MutationCtx,
  params: {
    slug: string
    rightfulOwnerUserId: Id<'users'>
    deletedAt: number
    expiresAt: number
    reason?: string
  },
) {
  const active = await listActiveReservedSlugsForSlug(ctx, params.slug)
  const latest = active[0] ?? null

  let keepId: Id<'reservedSlugs'>
  if (latest) {
    keepId = latest._id
    await ctx.db.patch(latest._id, {
      originalOwnerUserId: params.rightfulOwnerUserId,
      deletedAt: params.deletedAt,
      expiresAt: params.expiresAt,
      reason: params.reason ?? latest.reason,
      releasedAt: undefined,
    })
  } else {
    keepId = await ctx.db.insert('reservedSlugs', {
      slug: params.slug,
      originalOwnerUserId: params.rightfulOwnerUserId,
      deletedAt: params.deletedAt,
      expiresAt: params.expiresAt,
      reason: params.reason,
    })
  }

  await releaseDuplicateActiveReservations(ctx, active, keepId, params.deletedAt)
}

export async function enforceReservedSlugCooldownForNewSkill(
  ctx: MutationCtx,
  params: { slug: string; userId: Id<'users'>; now: number },
) {
  const active = await listActiveReservedSlugsForSlug(ctx, params.slug)
  const latest = active[0] ?? null
  if (!latest) return

  if (latest.expiresAt > params.now && latest.originalOwnerUserId !== params.userId) {
    throw new Error(
      `Slug "${params.slug}" is reserved for its previous owner until ${new Date(latest.expiresAt).toISOString()}. ` +
        'Please choose a different slug.',
    )
  }

  await ctx.db.patch(latest._id, { releasedAt: params.now })
  await releaseDuplicateActiveReservations(ctx, active, latest._id, params.now)
}

