import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./functions";
import {
  ensurePersonalPublisherForUser,
  getActiveUserByHandleOrPersonalPublisher,
} from "./lib/publishers";
import {
  TRANSFER_EXPIRY_MS,
  isTransferExpired,
  normalizeTransferHandle,
  validateTransferOwnership,
  validateTransferAcceptPermission,
} from "./lib/transfers";

type TransferDoc = Doc<"packageOwnershipTransfers">;

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
                eq: (field: "status", value: "pending") => unknown;
              };
            }) => unknown,
          ) => { collect: () => Promise<TransferDoc[]> };
        };
      };
    }
  ).db;

  const transfers = await db
    .query("packageOwnershipTransfers")
    .withIndex("by_package_status", (q) => q.eq("packageId", packageId).eq("status", "pending"))
    .collect();

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

  if (params.role === "recipient" && transfer.toUserId && transfer.toUserId !== params.actorUserId) {
    // For org-targeted transfers (toUserId is null), skip this check —
    // validateTransferAcceptPermission handles org membership validation separately
    throw new Error("No pending transfer found");
  }
  if (params.role === "sender" && transfer.fromUserId !== params.actorUserId) {
    throw new Error("No pending transfer found");
  }
  if (transfer.status !== "pending") throw new Error("No pending transfer found");
  if (isTransferExpired(transfer, params.now)) {
    await db.patch(transfer._id, { status: "expired", respondedAt: params.now });
    throw new Error("Transfer has expired");
  }
  return transfer;
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
    if (toUser._id === args.actorUserId) throw new Error("Cannot transfer to yourself");

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

    // Determine target publisher: explicit arg > transfer's toPublisherId > personal publisher
    // Validate actor has admin/owner role on explicit publisher override
    let targetPublisher: Doc<"publishers"> | null = null;
    if (args.publisherId) {
      await validateTransferAcceptPermission(ctx, {
        actorUserId: args.actorUserId,
        toPublisherId: args.publisherId,
      });
      targetPublisher = await ctx.db.get(args.publisherId);
    } else if (transfer.toPublisherId) {
      targetPublisher = await ctx.db.get(transfer.toPublisherId);
    }
    if (!targetPublisher) {
      targetPublisher = await ensurePersonalPublisherForUser(ctx, newOwner);
    }
    if (!targetPublisher) throw new Error("Failed to resolve publisher for new owner");

    await ctx.db.patch(pkg._id, {
      ownerUserId: args.actorUserId,
      ownerPublisherId: targetPublisher._id,
    });

    await ctx.db.patch(transfer._id, { status: "accepted", respondedAt: now });

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "package.transfer.accept",
      targetType: "package",
      targetId: pkg._id,
      metadata: {
        transferId: transfer._id,
        fromUserId: transfer.fromUserId,
      },
      createdAt: now,
    });

    return { ok: true as const, packageName: pkg.name };
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

    const transfers = await ctx.db
      .query("packageOwnershipTransfers")
      .withIndex("by_to_user_status", (q) => q.eq("toUserId", args.userId).eq("status", "pending"))
      .collect();

    const results: Array<{
      _id: Id<"packageOwnershipTransfers">;
      type: "package";
      package: { _id: Id<"packages">; name: string; displayName: string };
      fromUser: { _id: Id<"users">; handle: string | null; displayName: string | null };
      toUser?: { _id: Id<"users">; handle: string | null; displayName: string | null };
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
        message: transfer.message,
        requestedAt: transfer.requestedAt,
        expiresAt: transfer.expiresAt,
      });
    }

    return results;
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

export const getPendingTransferByPackageAndUserInternal = internalQuery({
  args: {
    packageId: v.id("packages"),
    toUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const transfer = await ctx.db
      .query("packageOwnershipTransfers")
      .withIndex("by_package_status", (q) =>
        q.eq("packageId", args.packageId).eq("status", "pending"),
      )
      .filter((q) => q.eq(q.field("toUserId"), args.toUserId))
      .first();

    if (!transfer || isTransferExpired(transfer, now)) return null;
    return transfer;
  },
});

export const getPendingTransferByPackageAndFromUserInternal = internalQuery({
  args: {
    packageId: v.id("packages"),
    fromUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const transfer = await ctx.db
      .query("packageOwnershipTransfers")
      .withIndex("by_package_status", (q) =>
        q.eq("packageId", args.packageId).eq("status", "pending"),
      )
      .filter((q) => q.eq(q.field("fromUserId"), args.fromUserId))
      .first();

    if (!transfer || isTransferExpired(transfer, now)) return null;
    return transfer;
  },
});
