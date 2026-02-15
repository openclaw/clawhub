import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type ReservedSlug = Doc<'reservedSlugs'>

export function pickLatestActiveReservation(reservations: ReservedSlug[]) {
  const active = reservations.filter((r) => !r.releasedAt)
  const latest = active.sort((a, b) => b.deletedAt - a.deletedAt)[0] ?? null
  return { active, latest }
}

export async function listReservedSlugsForSlug(
  ctx: QueryCtx | MutationCtx,
  slug: string,
  limit = 10,
) {
  return ctx.db
    .query('reservedSlugs')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .take(limit)
}

export async function getLatestActiveReservedSlug(ctx: QueryCtx | MutationCtx, slug: string) {
  const reservations = await listReservedSlugsForSlug(ctx, slug)
  return pickLatestActiveReservation(reservations).latest
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
  const reservations = await listReservedSlugsForSlug(ctx, params.slug)
  const { active, latest } = pickLatestActiveReservation(reservations)

  if (latest) {
    // Only extend the reservation if it matches the owner being deleted. If it points
    // to someone else, it was likely created by reclaim and must not be overwritten.
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
  const reservations = await listReservedSlugsForSlug(ctx, params.slug)
  const { active, latest } = pickLatestActiveReservation(reservations)

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
  const reservations = await listReservedSlugsForSlug(ctx, params.slug)
  const { active, latest } = pickLatestActiveReservation(reservations)
  if (!latest) return

  if (latest.expiresAt > params.now && latest.originalOwnerUserId !== params.userId) {
    throw new Error(
      `Slug "${params.slug}" is reserved for its previous owner until ${new Date(latest.expiresAt).toISOString()}. ` +
        'Please choose a different slug.',
    )
  }

  // Original owner reclaiming, or reservation expired.
  await ctx.db.patch(latest._id, { releasedAt: params.now })

  await releaseDuplicateActiveReservations(ctx, active, latest._id, params.now)
}

