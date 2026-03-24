import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./functions";
const TRANSFER_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

type TransferDoc = Doc<"skillOwnershipTransfers">;

function normalizeHandle(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function isExpired(transfer: TransferDoc, now: number) {
  return transfer.expiresAt < now;
}

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
    if (isExpired(transfer, now)) {
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

  if (params.role === "recipient" && transfer.toUserId !== params.actorUserId) {
    throw new Error("No pending transfer found");
  }
  if (params.role === "sender" && transfer.fromUserId !== params.actorUserId) {
    throw new Error("No pending transfer found");
  }
  if (transfer.status !== "pending") throw new Error("No pending transfer found");
  if (isExpired(transfer, params.now)) {
    await db.patch(transfer._id, { status: "expired", respondedAt: params.now });
    throw new Error("Transfer has expired");
  }
  return transfer;
}

export const requestTransferInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    skillId: v.id("skills"),
    toUserHandle: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await requireActiveUserById(ctx, args.actorUserId);

    const skill = await ctx.db.get(args.skillId);
    if (!skill || skill.softDeletedAt) throw new Error("Skill not found");
    if (skill.ownerUserId !== args.actorUserId) throw new Error("Forbidden");

    const toHandle = normalizeHandle(args.toUserHandle);
    if (!toHandle) throw new Error("toUserHandle required");

    const toUser = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", toHandle))
      .first();
    if (!toUser || toUser.deletedAt || toUser.deactivatedAt) throw new Error("User not found");
    if (toUser._id === args.actorUserId) throw new Error("Cannot transfer to yourself");

    const activePending = await getActivePendingTransferForSkill(ctx, args.skillId, now);
    if (activePending) throw new Error("A transfer is already pending for this skill");

    const message = args.message?.trim();
    const expiresAt = now + TRANSFER_EXPIRY_MS;
    const transferId = await ctx.db.insert("skillOwnershipTransfers", {
      skillId: skill._id,
      fromUserId: args.actorUserId,
      toUserId: toUser._id,
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

    const skill = await ctx.db.get(transfer.skillId);
    if (!skill || skill.softDeletedAt) throw new Error("Skill not found");
    if (skill.ownerUserId !== transfer.fromUserId) {
      await ctx.db.patch(transfer._id, { status: "cancelled", respondedAt: now });
      throw new Error("Transfer is no longer valid");
    }

    await ctx.db.patch(skill._id, {
      ownerUserId: args.actorUserId,
      updatedAt: now,
    });
    await ctx.db.patch(transfer._id, { status: "accepted", respondedAt: now });

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "skill.transfer.accept",
      targetType: "skill",
      targetId: skill._id,
      metadata: {
        transferId: transfer._id,
        fromUserId: transfer.fromUserId,
      },
      createdAt: now,
    });

    return { ok: true as const, skillSlug: skill.slug };
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

    const transfers = await ctx.db
      .query("skillOwnershipTransfers")
      .withIndex("by_to_user_status", (q) => q.eq("toUserId", args.userId).eq("status", "pending"))
      .collect();

    const results: Array<{
      _id: Id<"skillOwnershipTransfers">;
      skill: { _id: Id<"skills">; slug: string; displayName: string };
      fromUser: { _id: Id<"users">; handle: string | null; displayName: string | null };
      message: string | undefined;
      requestedAt: number;
      expiresAt: number;
    }> = [];

    for (const transfer of transfers) {
      if (isExpired(transfer, now)) continue;
      const skill = await ctx.db.get(transfer.skillId);
      if (!skill || skill.softDeletedAt) continue;
      const fromUser = await ctx.db.get(transfer.fromUserId);
      if (!fromUser || fromUser.deletedAt || fromUser.deactivatedAt) continue;

      results.push({
        _id: transfer._id,
        skill: { _id: skill._id, slug: skill.slug, displayName: skill.displayName },
        fromUser: {
          _id: fromUser._id,
          handle: fromUser.handle ?? null,
          displayName: fromUser.displayName ?? null,
        },
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
      .query("skillOwnershipTransfers")
      .withIndex("by_from_user_status", (q) =>
        q.eq("fromUserId", args.userId).eq("status", "pending"),
      )
      .collect();

    const results: Array<{
      _id: Id<"skillOwnershipTransfers">;
      skill: { _id: Id<"skills">; slug: string; displayName: string };
      toUser: { _id: Id<"users">; handle: string | null; displayName: string | null };
      message: string | undefined;
      requestedAt: number;
      expiresAt: number;
    }> = [];

    for (const transfer of transfers) {
      if (isExpired(transfer, now)) continue;
      const skill = await ctx.db.get(transfer.skillId);
      if (!skill || skill.softDeletedAt) continue;
      const toUser = await ctx.db.get(transfer.toUserId);
      if (!toUser || toUser.deletedAt || toUser.deactivatedAt) continue;

      results.push({
        _id: transfer._id,
        skill: { _id: skill._id, slug: skill.slug, displayName: skill.displayName },
        toUser: {
          _id: toUser._id,
          handle: toUser.handle ?? null,
          displayName: toUser.displayName ?? null,
        },
        message: transfer.message,
        requestedAt: transfer.requestedAt,
        expiresAt: transfer.expiresAt,
      });
    }

    return results;
  },
});

export const getPendingTransferBySkillAndUserInternal = internalQuery({
  args: {
    skillId: v.id("skills"),
    toUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const transfer = await ctx.db
      .query("skillOwnershipTransfers")
      .withIndex("by_skill_status", (q) => q.eq("skillId", args.skillId).eq("status", "pending"))
      .filter((q) => q.eq(q.field("toUserId"), args.toUserId))
      .first();

    if (!transfer || isExpired(transfer, now)) return null;
    return transfer;
  },
});

export const getPendingTransferBySkillAndFromUserInternal = internalQuery({
  args: {
    skillId: v.id("skills"),
    fromUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const transfer = await ctx.db
      .query("skillOwnershipTransfers")
      .withIndex("by_skill_status", (q) => q.eq("skillId", args.skillId).eq("status", "pending"))
      .filter((q) => q.eq(q.field("fromUserId"), args.fromUserId))
      .first();

    if (!transfer || isExpired(transfer, now)) return null;
    return transfer;
  },
});
