import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export function normalizeReservedHandle(handle: string | undefined | null) {
  const normalized = handle?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function reservedHandleQuery(ctx: QueryCtx | MutationCtx, handle: string) {
  return ctx.db
    .query("reservedHandles")
    .withIndex("by_handle_active_updatedAt", (q) =>
      q.eq("handle", handle).eq("releasedAt", undefined),
    )
    .order("desc");
}

export async function getLatestActiveReservedHandle(
  ctx: QueryCtx | MutationCtx,
  handle: string | undefined | null,
) {
  const normalized = normalizeReservedHandle(handle);
  if (!normalized) return null;
  return (await reservedHandleQuery(ctx, normalized).take(1))[0] ?? null;
}

export async function isHandleReservedForAnotherUser(
  ctx: QueryCtx | MutationCtx,
  handle: string | undefined | null,
  userId: Id<"users">,
) {
  const reservation = await getLatestActiveReservedHandle(ctx, handle);
  return Boolean(reservation && reservation.rightfulOwnerUserId !== userId);
}

export async function upsertReservedHandleForRightfulOwner(
  ctx: MutationCtx,
  params: {
    handle: string;
    rightfulOwnerUserId: Id<"users">;
    reason?: string;
    now: number;
  },
) {
  const normalizedHandle = normalizeReservedHandle(params.handle);
  if (!normalizedHandle) throw new Error("Handle required");

  const existing = await getLatestActiveReservedHandle(ctx, normalizedHandle);
  if (existing) {
    await ctx.db.patch(existing._id, {
      rightfulOwnerUserId: params.rightfulOwnerUserId,
      reason: params.reason ?? existing.reason,
      releasedAt: undefined,
      updatedAt: params.now,
    });
    return existing._id;
  }

  return await ctx.db.insert("reservedHandles", {
    handle: normalizedHandle,
    rightfulOwnerUserId: params.rightfulOwnerUserId,
    reason: params.reason,
    createdAt: params.now,
    updatedAt: params.now,
  });
}
