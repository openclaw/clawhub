import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type ReservedSlug = Doc<"reservedSlugs">;
type PublisherScope = Pick<Doc<"publishers">, "_id" | "kind" | "linkedUserId">;
type ReservedSlugQueryResult = {
  take: (limit: number) => Promise<ReservedSlug[]>;
  [Symbol.asyncIterator]?: () => AsyncIterator<ReservedSlug>;
};

const DEFAULT_ACTIVE_LIMIT = 25;

export function formatReservedSlugCooldownMessage(slug: string, expiresAt: number) {
  return (
    `Slug "${slug}" is reserved for its previous owner until ${new Date(expiresAt).toISOString()}. ` +
    "Please choose a different slug."
  );
}

function reservedSlugQuery(ctx: QueryCtx | MutationCtx, slug: string) {
  return ctx.db
    .query("reservedSlugs")
    .withIndex("by_slug_active_deletedAt", (q) => q.eq("slug", slug).eq("releasedAt", undefined))
    .order("desc");
}

async function listAllActiveReservedSlugsForSlug(ctx: QueryCtx | MutationCtx, slug: string) {
  const query = reservedSlugQuery(ctx, slug) as ReservedSlugQueryResult;
  const iterator = query[Symbol.asyncIterator]?.bind(query);
  if (iterator) {
    const reservations: ReservedSlug[] = [];
    for await (const reservation of { [Symbol.asyncIterator]: iterator }) {
      reservations.push(reservation);
    }
    return reservations;
  }
  return await query.take(10_000);
}

export async function listActiveReservedSlugsForSlug(
  ctx: QueryCtx | MutationCtx,
  slug: string,
  limit = DEFAULT_ACTIVE_LIMIT,
) {
  return reservedSlugQuery(ctx, slug).take(limit);
}

export async function getLatestActiveReservedSlug(ctx: QueryCtx | MutationCtx, slug: string) {
  return (await reservedSlugQuery(ctx, slug).take(1))[0] ?? null;
}

export async function releaseDuplicateActiveReservations(
  ctx: MutationCtx,
  active: ReservedSlug[],
  keepId: Id<"reservedSlugs"> | null | undefined,
  releasedAt: number,
  matchesScope: (reservation: ReservedSlug) => boolean = () => true,
) {
  for (const stale of active) {
    if (keepId && stale._id === keepId) continue;
    if (!matchesScope(stale)) continue;
    await ctx.db.patch(stale._id, { releasedAt });
  }
}

function reservationMatchesOwnerScope(
  reservation: ReservedSlug,
  scope: {
    originalOwnerUserId: Id<"users">;
    originalOwnerPublisherId?: Id<"publishers"> | null;
  },
) {
  if (reservation.originalOwnerPublisherId || scope.originalOwnerPublisherId) {
    return reservation.originalOwnerPublisherId === scope.originalOwnerPublisherId;
  }
  return reservation.originalOwnerUserId === scope.originalOwnerUserId;
}

function reservationMatchesPublisherScope(reservation: ReservedSlug, publisher: PublisherScope) {
  if (reservation.originalOwnerPublisherId) {
    return reservation.originalOwnerPublisherId === publisher._id;
  }
  return publisher.kind === "user" && publisher.linkedUserId === reservation.originalOwnerUserId;
}

export function canReleaseReservedSlugForPublisher(
  reservation: ReservedSlug,
  publisher: PublisherScope,
  userId: Id<"users"> | null | undefined,
) {
  if (!userId) return false;
  if (!reservationMatchesPublisherScope(reservation, publisher)) return false;
  if (publisher.kind === "org") return true;
  if (publisher.linkedUserId) return publisher.linkedUserId === userId;
  return reservation.originalOwnerUserId === userId;
}

export async function getLatestActiveReservedSlugForPublisher(
  ctx: QueryCtx | MutationCtx,
  slug: string,
  publisher: PublisherScope,
) {
  const active = await listAllActiveReservedSlugsForSlug(ctx, slug);
  return (
    active.find((reservation) => reservationMatchesPublisherScope(reservation, publisher)) ?? null
  );
}

export async function releaseActiveReservedSlugsForPublisher(
  ctx: MutationCtx,
  slug: string,
  publisher: PublisherScope,
  releasedAt: number,
) {
  const active = await listAllActiveReservedSlugsForSlug(ctx, slug);
  for (const reservation of active) {
    if (!reservationMatchesPublisherScope(reservation, publisher)) continue;
    await ctx.db.patch(reservation._id, { releasedAt });
  }
}

export async function reserveSlugForHardDeleteFinalize(
  ctx: MutationCtx,
  params: {
    slug: string;
    originalOwnerUserId: Id<"users">;
    originalOwnerPublisherId?: Id<"publishers"> | null;
    deletedAt: number;
    expiresAt: number;
  },
) {
  const active = await listActiveReservedSlugsForSlug(ctx, params.slug);
  const matchesScope = (reservation: ReservedSlug) =>
    reservationMatchesOwnerScope(reservation, params);
  const latest = active.find(matchesScope) ?? null;

  if (latest) {
    await ctx.db.patch(latest._id, {
      originalOwnerPublisherId: params.originalOwnerPublisherId ?? undefined,
      deletedAt: params.deletedAt,
      expiresAt: params.expiresAt,
      releasedAt: undefined,
    });
    await releaseDuplicateActiveReservations(
      ctx,
      active,
      latest._id,
      params.deletedAt,
      matchesScope,
    );
    return;
  }

  const inserted = await ctx.db.insert("reservedSlugs", {
    slug: params.slug,
    originalOwnerUserId: params.originalOwnerUserId,
    originalOwnerPublisherId: params.originalOwnerPublisherId ?? undefined,
    deletedAt: params.deletedAt,
    expiresAt: params.expiresAt,
  });
  await releaseDuplicateActiveReservations(ctx, active, inserted, params.deletedAt, matchesScope);
}

export async function upsertReservedSlugForRightfulOwner(
  ctx: MutationCtx,
  params: {
    slug: string;
    rightfulOwnerUserId: Id<"users">;
    deletedAt: number;
    expiresAt: number;
    reason?: string;
  },
) {
  const active = await listActiveReservedSlugsForSlug(ctx, params.slug);
  const latest = active[0] ?? null;

  let keepId: Id<"reservedSlugs">;
  if (latest) {
    keepId = latest._id;
    await ctx.db.patch(latest._id, {
      originalOwnerUserId: params.rightfulOwnerUserId,
      deletedAt: params.deletedAt,
      expiresAt: params.expiresAt,
      reason: params.reason ?? latest.reason,
      releasedAt: undefined,
    });
  } else {
    keepId = await ctx.db.insert("reservedSlugs", {
      slug: params.slug,
      originalOwnerUserId: params.rightfulOwnerUserId,
      deletedAt: params.deletedAt,
      expiresAt: params.expiresAt,
      reason: params.reason,
    });
  }

  await releaseDuplicateActiveReservations(ctx, active, keepId, params.deletedAt);
}

export async function enforceReservedSlugCooldownForNewSkill(
  ctx: MutationCtx,
  params: { slug: string; userId: Id<"users">; ownerPublisher: PublisherScope; now: number },
) {
  const active = await listAllActiveReservedSlugsForSlug(ctx, params.slug);
  const matchesScope = (reservation: ReservedSlug) =>
    reservationMatchesPublisherScope(reservation, params.ownerPublisher);
  const latest = active.find(matchesScope) ?? null;
  if (!latest) return;

  if (
    latest.expiresAt > params.now &&
    !canReleaseReservedSlugForPublisher(latest, params.ownerPublisher, params.userId)
  ) {
    throw new ConvexError(formatReservedSlugCooldownMessage(params.slug, latest.expiresAt));
  }

  await ctx.db.patch(latest._id, { releasedAt: params.now });
  await releaseDuplicateActiveReservations(ctx, active, latest._id, params.now, matchesScope);
}
