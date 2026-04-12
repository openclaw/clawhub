import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
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

type TransferDoc = Doc<"skillOwnershipTransfers">;

type PendingApprovalTransferDoc = TransferDoc & { status: "pending_admin_approval" };

async function requireActiveUserById(ctx: unknown, userId: Id<"users">) {
  const db = (ctx as { db: { get: (id: Id<"users">) => Promise<Doc<"users"> | null> } }).db;
  const user = await db.get(userId);
  if (!user || user.deletedAt || user.deactivatedAt) throw new Error("Unauthorized");
  return user;
}

async function getActivePendingTransferForSkill(ctx: unknown, skillId: Id<"skills">, now: number) {
  const db = (
    ctx as {
      db: {
        patch: (id: Id<"skillOwnershipTransfers">, value: Partial<TransferDoc>) => Promise<unknown>;
        query: (table: "skillOwnershipTransfers") => {
          withIndex: (
            indexName: "by_skill_status",
            cb: (q: {
              eq: (
                field: "skillId",
                value: Id<"skills">,
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
    .query("skillOwnershipTransfers")
    .withIndex("by_skill_status", (q) => q.eq("skillId", skillId).eq("status", "pending"))
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
    transferId: Id<"skillOwnershipTransfers">;
    actorUserId: Id<"users">;
    role: "sender" | "recipient";
    now: number;
  },
) {
  const db = (
    ctx as {
      db: {
        get: (id: Id<"skillOwnershipTransfers">) => Promise<TransferDoc | null>;
        patch: (id: Id<"skillOwnershipTransfers">, value: Partial<TransferDoc>) => Promise<unknown>;
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
  if (params.role === "sender") {
    if (!transfer.fromPublisherId && transfer.fromUserId !== params.actorUserId) {
      // Personal transfer: actor must be the original sender
      throw new Error("No pending transfer found");
    }
    // Org-owned transfer: actor's org membership is verified by the caller
    // (e.g. cancelTransferInternal calls validateTransferOwnership after this)
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
  transferId: Id<"skillOwnershipTransfers">,
) {
  const db = (
    ctx as {
      db: {
        get: (id: Id<"skillOwnershipTransfers">) => Promise<TransferDoc | null>;
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
    skillId: v.id("skills"),
    toUserHandle: v.string(),
    toPublisherId: v.optional(v.id("publishers")),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await requireActiveUserById(ctx, args.actorUserId);

    const skill = await ctx.db.get(args.skillId);
    if (!skill || skill.softDeletedAt) throw new Error("Skill not found");

    await validateTransferOwnership(ctx, {
      ownerUserId: skill.ownerUserId,
      ownerPublisherId: skill.ownerPublisherId,
      actorUserId: args.actorUserId,
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
      if (!toPublisher || toPublisher.deletedAt || toPublisher.deactivatedAt) {
        throw new Error("Target publisher not found");
      }
      if (toPublisher.kind === "user") {
        throw new Error("Cannot transfer to a personal publisher");
      }
    }

    const activePending = await getActivePendingTransferForSkill(ctx, args.skillId, now);
    if (activePending) throw new Error("A transfer is already pending for this skill");

    const message = args.message?.trim();
    const expiresAt = now + TRANSFER_EXPIRY_MS;
    const transferId = await ctx.db.insert("skillOwnershipTransfers", {
      skillId: skill._id,
      fromUserId: args.actorUserId,
      toUserId: toUser._id,
      fromPublisherId: skill.ownerPublisherId,
      toPublisherId: args.toPublisherId,
      status: "pending",
      message: message || undefined,
      requestedAt: now,
      expiresAt,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "skill.transfer.request",
      targetType: "skill",
      targetId: skill._id,
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
    transferId: v.id("skillOwnershipTransfers"),
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
      actorUserId: args.actorUserId,
      toUserId: transfer.toUserId ?? undefined,
      toPublisherId: transfer.toPublisherId,
    });

    const skill = await ctx.db.get(transfer.skillId);
    if (!skill || skill.softDeletedAt) throw new Error("Skill not found");
    const ownerChanged = transfer.fromPublisherId
      ? skill.ownerPublisherId !== transfer.fromPublisherId
      : skill.ownerUserId !== transfer.fromUserId;
    if (ownerChanged) {
      await ctx.db.patch(transfer._id, { status: "cancelled", respondedAt: now });
      throw new Error("Transfer is no longer valid");
    }

    // Determine target publisher: sender's choice > recipient override > personal
    // When the sender specified a target publisher, honor it unconditionally
    let targetPublisherId: Id<"publishers">;
    if (transfer.toPublisherId) {
      targetPublisherId = transfer.toPublisherId;
    } else if (args.publisherId) {
      await validateTransferAcceptPermission(ctx, {
        actorUserId: args.actorUserId,
        toPublisherId: args.publisherId,
      });
      targetPublisherId = args.publisherId;
    } else {
      const newPublisher = await ensurePersonalPublisherForUser(ctx, newOwner);
      if (!newPublisher) throw new Error("Failed to resolve publisher for new owner");
      targetPublisherId = newPublisher._id;
    }

    await ctx.db.patch(transfer._id, {
      status: "pending_admin_approval",
      toUserId: args.actorUserId,
      toPublisherId: targetPublisherId,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "skill.transfer.accept_pending_approval",
      targetType: "skill",
      targetId: skill._id,
      metadata: {
        transferId: transfer._id,
        fromUserId: transfer.fromUserId,
        toPublisherId: targetPublisherId,
      },
      createdAt: now,
    });

    return { ok: true as const, status: "pending_admin_approval" as const, skillSlug: skill.slug };
  },
});

export const rejectTransferInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    transferId: v.id("skillOwnershipTransfers"),
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
      actorUserId: args.actorUserId,
      toUserId: transfer.toUserId ?? undefined,
      toPublisherId: transfer.toPublisherId,
    });

    await ctx.db.patch(transfer._id, { status: "rejected", respondedAt: now });
    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "skill.transfer.reject",
      targetType: "skill",
      targetId: transfer.skillId,
      metadata: { transferId: transfer._id },
      createdAt: now,
    });

    return { ok: true as const };
  },
});

export const cancelTransferInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    transferId: v.id("skillOwnershipTransfers"),
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
      action: "skill.transfer.cancel",
      targetType: "skill",
      targetId: transfer.skillId,
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

    // Query transfers directed at this user personally
    const userTransfers = await ctx.db
      .query("skillOwnershipTransfers")
      .withIndex("by_to_user_status", (q) => q.eq("toUserId", args.userId).eq("status", "pending"))
      .collect();

    // Query transfers directed at orgs where this user is an admin or owner
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
          .query("skillOwnershipTransfers")
          .withIndex("by_to_publisher_status", (q) =>
            q.eq("toPublisherId", publisherId).eq("status", "pending"),
          )
          .collect(),
      ),
    );
    const orgTransfers = orgTransferArrays.flat();

    // Merge and deduplicate by transfer ID
    const seen = new Set<string>();
    const allTransfers: TransferDoc[] = [];
    for (const t of [...userTransfers, ...orgTransfers]) {
      if (!seen.has(t._id)) {
        seen.add(t._id);
        allTransfers.push(t);
      }
    }

    const results: Array<{
      type: "skill";
      _id: Id<"skillOwnershipTransfers">;
      skill: { _id: Id<"skills">; slug: string; displayName: string };
      fromUser: { _id: Id<"users">; handle: string | null; displayName: string | null };
      toPublisherId?: Id<"publishers">;
      message: string | undefined;
      requestedAt: number;
      expiresAt: number;
    }> = [];

    for (const transfer of allTransfers) {
      if (isTransferExpired(transfer, now)) continue;
      const skill = await ctx.db.get(transfer.skillId);
      if (!skill || skill.softDeletedAt) continue;
      const fromUser = await ctx.db.get(transfer.fromUserId);
      if (!fromUser || fromUser.deletedAt || fromUser.deactivatedAt) continue;

      results.push({
        type: "skill" as const,
        _id: transfer._id,
        skill: { _id: skill._id, slug: skill.slug, displayName: skill.displayName },
        fromUser: {
          _id: fromUser._id,
          handle: fromUser.handle ?? null,
          displayName: fromUser.displayName ?? null,
        },
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
      .query("skillOwnershipTransfers")
      .withIndex("by_status", (q) => q.eq("status", "pending_admin_approval"))
      .collect();
    const pendingTransfers = transfers
      .sort((a, b) => b.requestedAt - a.requestedAt)
      .slice(0, limit);

    const results: Array<{
      _id: Id<"skillOwnershipTransfers">;
      type: "skill";
      skill: { _id: Id<"skills">; slug: string; displayName: string };
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
      const skill = await ctx.db.get(transfer.skillId);
      if (!skill || skill.softDeletedAt) continue;
      const fromUser = await ctx.db.get(transfer.fromUserId);
      if (!fromUser || fromUser.deletedAt || fromUser.deactivatedAt) continue;
      const toUser = transfer.toUserId ? await ctx.db.get(transfer.toUserId) : null;
      const toPublisher = transfer.toPublisherId ? await ctx.db.get(transfer.toPublisherId) : null;
      results.push({
        _id: transfer._id,
        type: "skill",
        skill: { _id: skill._id, slug: skill.slug, displayName: skill.displayName },
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
          toPublisher && !toPublisher.deletedAt && !toPublisher.deactivatedAt
            ? {
                _id: toPublisher._id,
                handle: toPublisher.handle,
                displayName: toPublisher.displayName ?? null,
                kind: toPublisher.kind,
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
  ctx: {
    db: {
      get: (id: Id<"users"> | Id<"skills"> | Id<"publishers"> | Id<"skillOwnershipTransfers">) => Promise<unknown>;
      patch: (id: string, value: Record<string, unknown>) => Promise<unknown>;
      insert: (table: "auditLogs", value: Record<string, unknown>) => Promise<unknown>;
      query: (table: "skillSlugAliases") => {
        withIndex: (
          indexName: "by_skill",
          cb: (q: { eq: (field: "skillId", value: Id<"skills">) => unknown }) => unknown,
        ) => { collect: () => Promise<Array<{ _id: string }>> };
      };
    };
  },
  actorUserId: Id<"users">,
  transferId: Id<"skillOwnershipTransfers">,
) {
  const now = Date.now();
  const transfer = await getPendingAdminApprovalTransfer(ctx, transferId);
  const skill = await ctx.db.get(transfer.skillId);
  if (!skill || (skill as Doc<"skills">).softDeletedAt) throw new Error("Skill not found");
  const ownerChanged = transfer.fromPublisherId
    ? (skill as Doc<"skills">).ownerPublisherId !== transfer.fromPublisherId
    : (skill as Doc<"skills">).ownerUserId !== transfer.fromUserId;
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

  await ctx.db.patch((skill as Doc<"skills">)._id, {
    ownerUserId: transfer.toUserId,
    ownerPublisherId: transfer.toPublisherId,
    updatedAt: now,
  });

  const aliases = await ctx.db
    .query("skillSlugAliases")
    .withIndex("by_skill", (q) => q.eq("skillId", (skill as Doc<"skills">)._id))
    .collect();
  for (const alias of aliases) {
    await ctx.db.patch(alias._id, {
      ownerUserId: transfer.toUserId,
      ownerPublisherId: transfer.toPublisherId,
      updatedAt: now,
    });
  }

  await ctx.db.patch(transfer._id, {
    status: "accepted",
    respondedAt: now,
  });

  await ctx.db.insert("auditLogs", {
    actorUserId,
    action: "skill.transfer.approve",
    targetType: "skill",
    targetId: (skill as Doc<"skills">)._id,
    metadata: { transferId: transfer._id, toUserId: transfer.toUserId, toPublisherId: transfer.toPublisherId },
    createdAt: now,
  });

  return { ok: true as const, status: "accepted" as const, skillSlug: (skill as Doc<"skills">).slug };
}

export const approvePendingApproval = mutation({
  args: { transferId: v.id("skillOwnershipTransfers") },
  handler: async (ctx, args) => {
    const { user, userId } = await requireUser(ctx);
    assertModerator(user);
    return approvePendingApprovalAsModerator(ctx, userId, args.transferId);
  },
});

export const rejectPendingApproval = mutation({
  args: { transferId: v.id("skillOwnershipTransfers") },
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
      action: "skill.transfer.reject_approval",
      targetType: "skill",
      targetId: transfer.skillId,
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
      .query("skillOwnershipTransfers")
      .withIndex("by_from_user_status", (q) =>
        q.eq("fromUserId", args.userId).eq("status", "pending"),
      )
      .collect();

    const results: Array<{
      type: "skill";
      _id: Id<"skillOwnershipTransfers">;
      skill: { _id: Id<"skills">; slug: string; displayName: string };
      toUser?: { _id: Id<"users">; handle: string | null; displayName: string | null };
      toPublisherId?: Id<"publishers">;
      message: string | undefined;
      requestedAt: number;
      expiresAt: number;
    }> = [];

    for (const transfer of transfers) {
      if (isTransferExpired(transfer, now)) continue;
      const skill = await ctx.db.get(transfer.skillId);
      if (!skill || skill.softDeletedAt) continue;

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
        type: "skill" as const,
        _id: transfer._id,
        skill: { _id: skill._id, slug: skill.slug, displayName: skill.displayName },
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

export const getPendingTransferBySkillInternal = internalQuery({
  args: {
    skillId: v.id("skills"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const transfer = await ctx.db
      .query("skillOwnershipTransfers")
      .withIndex("by_skill_status", (q) => q.eq("skillId", args.skillId).eq("status", "pending"))
      .first();

    if (!transfer || isTransferExpired(transfer, now)) return null;
    return transfer;
  },
});
