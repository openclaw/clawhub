import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { assertModerator, requireUser } from "./lib/access";
import {
  ensurePersonalPublisherForUser,
  getActiveUserByHandleOrPersonalPublisher,
  isPublisherActive,
} from "./lib/publishers";
import {
  TRANSFER_EXPIRY_MS,
  isTransferExpired,
  normalizeTransferHandle,
  validateTransferOwnership,
  validateTransferAcceptPermission,
} from "./lib/transfers";

type TransferDoc = Doc<"packageOwnershipTransfers">;

type PendingApprovalTransferDoc = TransferDoc & { status: "pending_admin_approval" };

async function requireActiveUserById(ctx: unknown, userId: Id<"users">) {
  const db = (ctx as { db: { get: (id: Id<"users">) => Promise<Doc<"users"> | null> } }).db;
  const user = await db.get(userId);
  if (!user || user.deletedAt || user.deactivatedAt) throw new Error("Unauthorized");
  return user;
}

async function getActivePendingTransferForPackage(
  ctx: unknown,
  packageId: Id<"packages">,
  now: number,
) {
  const db = (
    ctx as {
      db: {
        patch: (
          id: Id<"packageOwnershipTransfers">,
          value: Partial<TransferDoc>,
        ) => Promise<unknown>;
        query: (table: "packageOwnershipTransfers") => {
          withIndex: (
            indexName: "by_package_status",
            cb: (q: {
              eq: (
                field: "packageId",
                value: Id<"packages">,
              ) => {
                eq: (field: "status", value: "pending" | "pending_admin_approval") => unknown;
              };
            }) => unknown,
          ) => { collect: () => Promise<TransferDoc[]> };
        };
      };
    }
  ).db;

  const pendingTransfers = await db
    .query("packageOwnershipTransfers")
    .withIndex("by_package_status", (q) => q.eq("packageId", packageId).eq("status", "pending"))
    .collect();
  const pendingApprovalTransfers = await db
    .query("packageOwnershipTransfers")
    .withIndex("by_package_status", (q) =>
      q.eq("packageId", packageId).eq("status", "pending_admin_approval"),
    )
    .collect();
  const transfers = [...pendingTransfers, ...pendingApprovalTransfers];

  let active: TransferDoc | null = null;
  for (const transfer of transfers) {
    if (isTransferExpired(transfer, now)) {
      await db.patch(transfer._id, { status: "expired", respondedAt: now });
      continue;
    }
    if (!active || transfer.requestedAt > active.requestedAt) active = transfer;
  }
  return active;
}

async function validatePendingTransferForActor(
  ctx: unknown,
  params: {
    transferId: Id<"packageOwnershipTransfers">;
    actorUserId: Id<"users">;
    role: "sender" | "recipient";
    now: number;
  },
) {
  const db = (
    ctx as {
      db: {
        get: (id: Id<"packageOwnershipTransfers">) => Promise<TransferDoc | null>;
        patch: (
          id: Id<"packageOwnershipTransfers">,
          value: Partial<TransferDoc>,
        ) => Promise<unknown>;
      };
    }
  ).db;

  const transfer = await db.get(params.transferId);
  if (!transfer) throw new Error("Transfer not found");

  if (
    params.role === "recipient" &&
    transfer.toUserId &&
    transfer.toUserId !== params.actorUserId &&
    !transfer.toPublisherId
  ) {
    // For org-targeted transfers (toPublisherId is set), skip this check —
    // validateTransferAcceptPermission handles org membership validation separately
    throw new Error("No pending transfer found");
  }
  if (
    params.role === "sender" &&
    transfer.fromUserId !== params.actorUserId &&
    !transfer.fromPublisherId
  ) {
    // For org-owned items (fromPublisherId is set), skip this check —
    // the cancel handler validates org membership separately
    throw new Error("No pending transfer found");
  }
  if (transfer.status !== "pending") throw new Error("No pending transfer found");
  if (isTransferExpired(transfer, params.now)) {
    await db.patch(transfer._id, { status: "expired", respondedAt: params.now });
    throw new Error("Transfer has expired");
  }
  return transfer;
}

async function getPendingAdminApprovalTransfer(
  ctx: unknown,
  transferId: Id<"packageOwnershipTransfers">,
) {
  const db = (
    ctx as {
      db: {
        get: (id: Id<"packageOwnershipTransfers">) => Promise<TransferDoc | null>;
      };
    }
  ).db;

  const transfer = await db.get(transferId);
  if (!transfer || transfer.status !== "pending_admin_approval") {
    throw new Error("No transfer pending management approval");
  }
  return transfer as PendingApprovalTransferDoc;
}

export const requestTransferInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    packageId: v.id("packages"),
    toUserHandle: v.string(),
    toPublisherId: v.optional(v.id("publishers")),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await requireActiveUserById(ctx, args.actorUserId);

    const pkg = await ctx.db.get(args.packageId);
    if (!pkg || (pkg as Record<string, unknown>).softDeletedAt) throw new Error("Package not found");

    await validateTransferOwnership(ctx, {
      actorUserId: args.actorUserId,
      ownerUserId: pkg.ownerUserId,
      ownerPublisherId: pkg.ownerPublisherId,
    });

    const toHandle = normalizeTransferHandle(args.toUserHandle);
    if (!toHandle) throw new Error("toUserHandle required");

    const toUser = await getActiveUserByHandleOrPersonalPublisher(ctx, toHandle);
    if (!toUser) throw new Error("User not found");
    if (toUser._id === args.actorUserId && !args.toPublisherId) {
      throw new Error("Cannot transfer to yourself");
    }

    if (args.toPublisherId) {
      const toPublisher = await ctx.db.get(args.toPublisherId);
      if (!toPublisher || (toPublisher as Record<string, unknown>).deletedAt || (toPublisher as Record<string, unknown>).deactivatedAt) {
        throw new Error("Target publisher not found");
      }
      if ((toPublisher as Record<string, unknown>).kind === "user") {
        throw new Error("Cannot transfer to a personal publisher");
      }
    }

    const activePending = await getActivePendingTransferForPackage(ctx, args.packageId, now);
    if (activePending) throw new Error("A transfer is already pending for this package");

    const message = args.message?.trim();
    const expiresAt = now + TRANSFER_EXPIRY_MS;
    const transferId = await ctx.db.insert("packageOwnershipTransfers", {
      packageId: pkg._id,
      fromUserId: args.actorUserId,
      toUserId: toUser._id,
      fromPublisherId: pkg.ownerPublisherId,
      toPublisherId: args.toPublisherId,
      status: "pending",
      message: message || undefined,
      requestedAt: now,
      expiresAt,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "package.transfer.request",
      targetType: "package",
      targetId: pkg._id,
      metadata: {
        transferId,
        toUserId: toUser._id,
        toUserHandle: toUser.handle ?? toHandle,
      },
      createdAt: now,
    });

    return { ok: true as const, transferId, toUserHandle: toUser.handle ?? toHandle, expiresAt };
  },
});

export const acceptTransferInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    transferId: v.id("packageOwnershipTransfers"),
    publisherId: v.optional(v.id("publishers")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const newOwner = await requireActiveUserById(ctx, args.actorUserId);

    const transfer = await validatePendingTransferForActor(ctx, {
      transferId: args.transferId,
      actorUserId: args.actorUserId,
      role: "recipient",
      now,
    });

    await validateTransferAcceptPermission(ctx, {
      toUserId: transfer.toUserId,
      toPublisherId: transfer.toPublisherId,
      actorUserId: args.actorUserId,
    });

    const pkg = await ctx.db.get(transfer.packageId);
    if (!pkg || (pkg as Record<string, unknown>).softDeletedAt)
      throw new Error("Package not found");
    const ownerChanged = transfer.fromPublisherId
      ? pkg.ownerPublisherId !== transfer.fromPublisherId
      : pkg.ownerUserId !== transfer.fromUserId;
    if (ownerChanged) {
      await ctx.db.patch(transfer._id, { status: "cancelled", respondedAt: now });
      throw new Error("Transfer is no longer valid");
    }

    // Determine target publisher: sender's choice > recipient override > personal
    // When the sender specified a target publisher, honor it unconditionally
    let targetPublisher: Doc<"publishers"> | null = null;
    if (transfer.toPublisherId) {
      targetPublisher = await ctx.db.get(transfer.toPublisherId);
    } else if (args.publisherId) {
      await validateTransferAcceptPermission(ctx, {
        actorUserId: args.actorUserId,
        toPublisherId: args.publisherId,
      });
      targetPublisher = await ctx.db.get(args.publisherId);
    }
    if (!targetPublisher) {
      targetPublisher = await ensurePersonalPublisherForUser(ctx, newOwner);
    }
    if (!targetPublisher) throw new Error("Failed to resolve publisher for new owner");

    await ctx.db.patch(transfer._id, {
      status: "pending_admin_approval",
      toUserId: args.actorUserId,
      toPublisherId: targetPublisher._id,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "package.transfer.accept_pending_approval",
      targetType: "package",
      targetId: pkg._id,
      metadata: {
        transferId: transfer._id,
        fromUserId: transfer.fromUserId,
        toPublisherId: targetPublisher._id,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      status: "pending_admin_approval" as const,
      packageName: pkg.name,
    };
  },
});

export const rejectTransferInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    transferId: v.id("packageOwnershipTransfers"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await requireActiveUserById(ctx, args.actorUserId);

    const transfer = await validatePendingTransferForActor(ctx, {
      transferId: args.transferId,
      actorUserId: args.actorUserId,
      role: "recipient",
      now,
    });

    await validateTransferAcceptPermission(ctx, {
      toUserId: transfer.toUserId,
      toPublisherId: transfer.toPublisherId,
      actorUserId: args.actorUserId,
    });

    await ctx.db.patch(transfer._id, { status: "rejected", respondedAt: now });
    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "package.transfer.reject",
      targetType: "package",
      targetId: transfer.packageId,
      metadata: { transferId: transfer._id },
      createdAt: now,
    });

    return { ok: true as const };
  },
});

export const cancelTransferInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    transferId: v.id("packageOwnershipTransfers"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await requireActiveUserById(ctx, args.actorUserId);

    const transfer = await validatePendingTransferForActor(ctx, {
      transferId: args.transferId,
      actorUserId: args.actorUserId,
      role: "sender",
      now,
    });

    // For org-owned transfers, always verify actor still has admin/owner role
    if (transfer.fromPublisherId) {
      await validateTransferOwnership(ctx, {
        ownerUserId: transfer.fromUserId,
        ownerPublisherId: transfer.fromPublisherId,
        actorUserId: args.actorUserId,
      });
    }

    await ctx.db.patch(transfer._id, { status: "cancelled", respondedAt: now });
    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "package.transfer.cancel",
      targetType: "package",
      targetId: transfer.packageId,
      metadata: { transferId: transfer._id },
      createdAt: now,
    });

    return { ok: true as const };
  },
});

export const listIncomingInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = Date.now();
    await requireActiveUserById(ctx, args.userId);

    const userTransfers = await ctx.db
      .query("packageOwnershipTransfers")
      .withIndex("by_to_user_status", (q) => q.eq("toUserId", args.userId).eq("status", "pending"))
      .collect();
    const memberships = await ctx.db
      .query("publisherMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const adminPublisherIds = memberships
      .filter((m) => m.role === "owner" || m.role === "admin")
      .map((m) => m.publisherId);
    const orgTransferArrays = await Promise.all(
      adminPublisherIds.map((publisherId) =>
        ctx.db
          .query("packageOwnershipTransfers")
          .withIndex("by_to_publisher_status", (q) =>
            q.eq("toPublisherId", publisherId).eq("status", "pending"),
          )
          .collect(),
      ),
    );
    const orgTransfers = orgTransferArrays.flat();
    const seen = new Set<string>();
    const transfers: TransferDoc[] = [];
    for (const transfer of [...userTransfers, ...orgTransfers]) {
      if (seen.has(transfer._id)) continue;
      seen.add(transfer._id);
      transfers.push(transfer);
    }

    const results: Array<{
      _id: Id<"packageOwnershipTransfers">;
      type: "package";
      package: { _id: Id<"packages">; name: string; displayName: string };
      fromUser: { _id: Id<"users">; handle: string | null; displayName: string | null };
      toUser?: { _id: Id<"users">; handle: string | null; displayName: string | null };
      toPublisherId?: Id<"publishers">;
      message: string | undefined;
      requestedAt: number;
      expiresAt: number;
    }> = [];

    for (const transfer of transfers) {
      if (isTransferExpired(transfer, now)) continue;
      const pkg = await ctx.db.get(transfer.packageId);
      if (!pkg || (pkg as Record<string, unknown>).softDeletedAt) continue;
      const fromUser = await ctx.db.get(transfer.fromUserId);
      if (!fromUser || fromUser.deletedAt || fromUser.deactivatedAt) continue;

      let toUser:
        | { _id: Id<"users">; handle: string | null; displayName: string | null }
        | undefined;
      if (transfer.toUserId) {
        const tu = await ctx.db.get(transfer.toUserId);
        if (tu && !tu.deletedAt && !tu.deactivatedAt) {
          toUser = {
            _id: tu._id,
            handle: tu.handle ?? null,
            displayName: tu.displayName ?? null,
          };
        }
      }

      results.push({
        _id: transfer._id,
        type: "package",
        package: { _id: pkg._id, name: pkg.name, displayName: pkg.displayName },
        fromUser: {
          _id: fromUser._id,
          handle: fromUser.handle ?? null,
          displayName: fromUser.displayName ?? null,
        },
        toUser,
        toPublisherId: transfer.toPublisherId ?? undefined,
        message: transfer.message,
        requestedAt: transfer.requestedAt,
        expiresAt: transfer.expiresAt,
      });
    }

    return results;
  },
});

export const listPendingApprovals = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    const limit = Math.max(1, Math.min(args.limit ?? 25, 100));
    const transfers = await ctx.db
      .query("packageOwnershipTransfers")
      .withIndex("by_status", (q) => q.eq("status", "pending_admin_approval"))
      .collect();
    const pendingTransfers = transfers
      .sort((a, b) => b.requestedAt - a.requestedAt)
      .slice(0, limit);

    const results: Array<{
      _id: Id<"packageOwnershipTransfers">;
      type: "package";
      package: { _id: Id<"packages">; name: string; displayName: string };
      fromUser: { _id: Id<"users">; handle: string | null; displayName: string | null };
      toUser: { _id: Id<"users">; handle: string | null; displayName: string | null } | null;
      toPublisher:
        | { _id: Id<"publishers">; handle: string; displayName: string | null; kind: "user" | "org" }
        | null;
      message: string | undefined;
      requestedAt: number;
      expiresAt: number;
    }> = [];

    for (const transfer of pendingTransfers) {
      const pkg = await ctx.db.get(transfer.packageId);
      if (!pkg || (pkg as Record<string, unknown>).softDeletedAt) continue;
      const fromUser = await ctx.db.get(transfer.fromUserId);
      if (!fromUser || fromUser.deletedAt || fromUser.deactivatedAt) continue;
      const toUser = transfer.toUserId ? await ctx.db.get(transfer.toUserId) : null;
      const toPublisher = transfer.toPublisherId ? await ctx.db.get(transfer.toPublisherId) : null;
      results.push({
        _id: transfer._id,
        type: "package",
        package: { _id: pkg._id, name: pkg.name, displayName: pkg.displayName },
        fromUser: {
          _id: fromUser._id,
          handle: fromUser.handle ?? null,
          displayName: fromUser.displayName ?? null,
        },
        toUser:
          toUser && !toUser.deletedAt && !toUser.deactivatedAt
            ? {
                _id: toUser._id,
                handle: toUser.handle ?? null,
                displayName: toUser.displayName ?? null,
              }
            : null,
        toPublisher:
          toPublisher &&
          !(toPublisher as Record<string, unknown>).deletedAt &&
          !(toPublisher as Record<string, unknown>).deactivatedAt
            ? {
                _id: toPublisher._id,
                handle: String((toPublisher as Record<string, unknown>).handle),
                displayName:
                  (toPublisher as Record<string, unknown>).displayName === undefined
                    ? null
                    : ((toPublisher as Record<string, unknown>).displayName as string | null),
                kind: (toPublisher as Record<string, unknown>).kind as "user" | "org",
              }
            : null,
        message: transfer.message,
        requestedAt: transfer.requestedAt,
        expiresAt: transfer.expiresAt,
      });
    }

    return results;
  },
});

export async function approvePendingApprovalAsModerator(
  ctx: Pick<MutationCtx, "db">,
  actorUserId: Id<"users">,
  transferId: Id<"packageOwnershipTransfers">,
) {
  const now = Date.now();
  const transfer = await getPendingAdminApprovalTransfer(ctx, transferId);
  const pkg = await ctx.db.get(transfer.packageId);
  if (!pkg || (pkg as Record<string, unknown>).softDeletedAt) {
    throw new Error("Package not found");
  }
  const ownerChanged = transfer.fromPublisherId
    ? (pkg as Doc<"packages">).ownerPublisherId !== transfer.fromPublisherId
    : (pkg as Doc<"packages">).ownerUserId !== transfer.fromUserId;
  if (ownerChanged) {
    await ctx.db.patch(transfer._id, { status: "cancelled", respondedAt: now });
    throw new Error("Transfer is no longer valid");
  }
  if (!transfer.toUserId || !transfer.toPublisherId) {
    throw new Error("Transfer is missing approval target");
  }
  const nextOwner = await ctx.db.get(transfer.toUserId);
  if (!nextOwner || (nextOwner as Doc<"users">).deletedAt || (nextOwner as Doc<"users">).deactivatedAt) {
    await ctx.db.patch(transfer._id, { status: "cancelled", respondedAt: now });
    throw new Error("Transfer recipient is no longer active");
  }
  const nextPublisher = await ctx.db.get(transfer.toPublisherId);
  if (!isPublisherActive(nextPublisher as Doc<"publishers"> | null)) {
    await ctx.db.patch(transfer._id, { status: "cancelled", respondedAt: now });
    throw new Error("Transfer target publisher is no longer active");
  }

  await ctx.db.patch((pkg as Doc<"packages">)._id, {
    ownerUserId: transfer.toUserId,
    ownerPublisherId: transfer.toPublisherId,
  });
  await ctx.db.patch(transfer._id, {
    status: "accepted",
    respondedAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId,
    action: "package.transfer.approve",
    targetType: "package",
    targetId: (pkg as Doc<"packages">)._id,
    metadata: { transferId: transfer._id, toUserId: transfer.toUserId, toPublisherId: transfer.toPublisherId },
    createdAt: now,
  });
  return { ok: true as const, status: "accepted" as const, packageName: (pkg as Doc<"packages">).name };
}

export const approvePendingApproval = mutation({
  args: { transferId: v.id("packageOwnershipTransfers") },
  handler: async (ctx, args) => {
    const { user, userId } = await requireUser(ctx);
    assertModerator(user);
    return approvePendingApprovalAsModerator(ctx, userId, args.transferId);
  },
});

export const rejectPendingApproval = mutation({
  args: { transferId: v.id("packageOwnershipTransfers") },
  handler: async (ctx, args) => {
    const { user, userId } = await requireUser(ctx);
    assertModerator(user);

    const now = Date.now();
    const transfer = await getPendingAdminApprovalTransfer(ctx, args.transferId);
    await ctx.db.patch(transfer._id, {
      status: "rejected",
      respondedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "package.transfer.reject_approval",
      targetType: "package",
      targetId: transfer.packageId,
      metadata: { transferId: transfer._id },
      createdAt: now,
    });
    return { ok: true as const, status: "rejected" as const };
  },
});

export const listOutgoingInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = Date.now();
    await requireActiveUserById(ctx, args.userId);

    const transfers = await ctx.db
      .query("packageOwnershipTransfers")
      .withIndex("by_from_user_status", (q) =>
        q.eq("fromUserId", args.userId).eq("status", "pending"),
      )
      .collect();

    const results: Array<{
      _id: Id<"packageOwnershipTransfers">;
      type: "package";
      package: { _id: Id<"packages">; name: string; displayName: string };
      toUser?: { _id: Id<"users">; handle: string | null; displayName: string | null };
      message: string | undefined;
      requestedAt: number;
      expiresAt: number;
    }> = [];

    for (const transfer of transfers) {
      if (isTransferExpired(transfer, now)) continue;
      const pkg = await ctx.db.get(transfer.packageId);
      if (!pkg || (pkg as Record<string, unknown>).softDeletedAt) continue;

      let toUser:
        | { _id: Id<"users">; handle: string | null; displayName: string | null }
        | undefined;
      if (transfer.toUserId) {
        const tu = await ctx.db.get(transfer.toUserId);
        if (tu && !tu.deletedAt && !tu.deactivatedAt) {
          toUser = {
            _id: tu._id,
            handle: tu.handle ?? null,
            displayName: tu.displayName ?? null,
          };
        }
      }

      results.push({
        _id: transfer._id,
        type: "package",
        package: { _id: pkg._id, name: pkg.name, displayName: pkg.displayName },
        toUser,
        message: transfer.message,
        requestedAt: transfer.requestedAt,
        expiresAt: transfer.expiresAt,
      });
    }

    return results;
  },
});

export const getPendingTransferByPackageInternal = internalQuery({
  args: {
    packageId: v.id("packages"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const transfer = await ctx.db
      .query("packageOwnershipTransfers")
      .withIndex("by_package_status", (q) =>
        q.eq("packageId", args.packageId).eq("status", "pending"),
      )
      .first();

    if (!transfer || isTransferExpired(transfer, now)) return null;
    return transfer;
  },
});
