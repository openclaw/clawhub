import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { getPublisherMembership, isPublisherActive, isPublisherRoleAllowed } from "./publishers";

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

/** 7 days in milliseconds */
export const TRANSFER_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Returns true if the transfer has expired (expiresAt is strictly less than now). */
export function isTransferExpired(transfer: { expiresAt: number }, now: number): boolean {
  return transfer.expiresAt < now;
}

/**
 * Trims whitespace, strips leading `@` characters, and lowercases:
 * `"@Alice"` -> `"alice"`, `"@@Bob"` -> `"bob"`
 */
export function normalizeTransferHandle(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

/**
 * Validates that `actorUserId` has permission to initiate a transfer.
 *
 * - If the item is personally owned (`ownerPublisherId` is null/undefined):
 *   actor must be the `ownerUserId`.
 * - If the item is org-owned: actor must be an admin or owner in that org's
 *   publisherMembers.
 *
 * @throws {Error} "Forbidden" on failure
 */
export async function validateTransferOwnership(
  ctx: DbCtx,
  params: {
    actorUserId: Id<"users">;
    ownerUserId: Id<"users">;
    ownerPublisherId?: Id<"publishers"> | null;
  },
): Promise<void> {
  if (!params.ownerPublisherId) {
    // Personally owned — actor must be the owner
    if (params.actorUserId !== params.ownerUserId) {
      throw new Error("Forbidden");
    }
    return;
  }

  // Org-owned — actor must be admin or owner in the org
  const membership = await getPublisherMembership(ctx, params.ownerPublisherId, params.actorUserId);
  if (!membership || !isPublisherRoleAllowed(membership.role, ["admin"])) {
    throw new Error("Forbidden");
  }
}

/**
 * Validates that `actorUserId` can accept a transfer.
 *
 * - If `toPublisherId` is null (personal target): actor must be `toUserId`.
 * - If `toPublisherId` is set (org target): actor must be admin/owner of that org.
 *
 * @throws {Error} "No pending transfer found" on failure
 */
export async function validateTransferAcceptPermission(
  ctx: DbCtx,
  params: {
    actorUserId: Id<"users">;
    toUserId?: Id<"users"> | null;
    toPublisherId?: Id<"publishers"> | null;
  },
): Promise<void> {
  if (!params.toPublisherId) {
    // Personal target — actor must be the target user
    if (params.actorUserId !== params.toUserId) {
      throw new Error("No pending transfer found");
    }
    return;
  }

  // Org target — publisher must be active and actor must be admin or owner
  const db = (ctx as { db: { get: (id: Id<"publishers">) => Promise<Doc<"publishers"> | null> } })
    .db;
  const publisher = await db.get(params.toPublisherId);
  if (!isPublisherActive(publisher)) {
    throw new Error("Publisher not found");
  }
  const membership = await getPublisherMembership(ctx, params.toPublisherId, params.actorUserId);
  if (!membership || !isPublisherRoleAllowed(membership.role, ["admin"])) {
    throw new Error("No pending transfer found");
  }
}
