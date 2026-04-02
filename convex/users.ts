import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./functions";
import {
  assertAdmin,
  assertModerator,
  getOptionalActiveAuthUserId,
  requireUser,
} from "./lib/access";
import { syncGitHubProfile } from "./lib/githubAccount";
import { toPublicUser } from "./lib/public";
import {
  ensurePersonalPublisherForUser,
  getActiveUserByHandleOrPersonalPublisher,
  getPublisherByHandle,
  getUserByHandleOrPersonalPublisher,
} from "./lib/publishers";
import {
  getLatestActiveReservedHandle,
  isHandleReservedForAnotherUser,
  normalizeReservedHandle,
  upsertReservedHandleForRightfulOwner,
} from "./lib/reservedHandles";
import { buildUserSearchResults } from "./lib/userSearch";
import { insertStatEvent } from "./skillStatEvents";

const DEFAULT_ROLE = "user";
const ADMIN_HANDLE = "steipete";
const MAX_USER_LIST_LIMIT = 200;
const MAX_USER_SEARCH_SCAN = 5_000;
const MIN_USER_SEARCH_SCAN = 500;

export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => toPublicUser(await ctx.db.get(args.userId)),
});

export const getByIdInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => ctx.db.get(args.userId),
});

export const getByHandleInternal = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    return await getUserByHandleOrPersonalPublisher(ctx, args.handle);
  },
});

export const searchInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("Unauthorized");
    assertAdmin(actor);

    const limit = clampInt(args.limit ?? 20, 1, MAX_USER_LIST_LIMIT);
    const exactHandleUser = args.query
      ? await getUserByHandleOrPersonalPublisher(ctx, args.query)
      : null;
    const result = await queryUsersForAdminList(ctx, {
      limit,
      search: args.query,
      exactUserId: exactHandleUser?._id,
    });
    const dedupedUsers = exactHandleUser
      ? [exactHandleUser, ...result.items.filter((user) => user._id !== exactHandleUser._id)]
      : result.items;
    const total = exactHandleUser
      ? result.total + (result.containsExactUser ? 0 : 1)
      : result.total;
    const items = dedupedUsers.slice(0, limit).map((user) => ({
      userId: user._id,
      handle: user.handle ?? null,
      displayName: user.displayName ?? null,
      name: user.name ?? null,
      role: user.role ?? null,
    }));
    return { items, total };
  },
});

export const setGitHubCreatedAtInternal = internalMutation({
  args: {
    userId: v.id("users"),
    githubCreatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      githubCreatedAt: args.githubCreatedAt,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Sync the user's GitHub profile (username, avatar) when it changes.
 * This handles the case where a user renames their GitHub account.
 */
export const syncGitHubProfileInternal = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    image: v.optional(v.string()),
    profileName: v.optional(v.string()),
    syncedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.deletedAt || user.deactivatedAt) return;
    const canClaimNewHandle = await canUserClaimHandle(ctx, args.name, args.userId);

    const updates: Partial<Doc<"users">> = { githubProfileSyncedAt: args.syncedAt };
    let didChangeProfile = false;

    if (user.name !== args.name) {
      updates.name = args.name;
      didChangeProfile = true;
    }

    // Update handle if it was derived from the old username
    if (user.handle === user.name && user.name !== args.name && canClaimNewHandle) {
      updates.handle = args.name;
      didChangeProfile = true;
    }

    // Update displayName if it was derived from the old username
    if (
      (user.displayName === user.name || user.displayName === user.handle) &&
      user.name !== args.name &&
      canClaimNewHandle
    ) {
      updates.displayName = args.name;
      didChangeProfile = true;
    }

    // If displayName is derived/missing, prefer the GitHub profile "name" (full name).
    const profileName = args.profileName?.trim();
    if (profileName && profileName !== args.name) {
      const currentDisplay = user.displayName?.trim();
      const currentHandle = user.handle?.trim();
      const currentLogin = user.name?.trim();
      const isDerivedOrMissing =
        !currentDisplay || currentDisplay === currentHandle || currentDisplay === currentLogin;
      if (isDerivedOrMissing && currentDisplay !== profileName) {
        updates.displayName = profileName;
        didChangeProfile = true;
      }
    }

    // Update avatar if provided
    if (args.image && args.image !== user.image) {
      updates.image = args.image;
      didChangeProfile = true;
    }

    if (didChangeProfile) {
      updates.updatedAt = Date.now();
    }
    await ctx.db.patch(args.userId, updates);
    const nextUser = didChangeProfile ? ({ ...user, ...updates } as Doc<"users">) : user;
    await ensurePersonalPublisherForUser(ctx, nextUser);
  },
});

/**
 * Internal action to sync GitHub profile from the GitHub API.
 * This is called after login to ensure the username is up-to-date.
 */
export const syncGitHubProfileAction = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx: ActionCtx, args) => {
    await syncGitHubProfile(ctx, args.userId);
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalActiveAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

export const ensure = mutation({
  args: {},
  handler: ensureHandler,
});

function normalizeHandle(handle: string | undefined) {
  const normalized = handle?.trim();
  return normalized ? normalized : undefined;
}

function deriveHandle(args: { existingHandle?: string; githubLogin?: string; email?: string }) {
  // Prefer the GitHub login; only fall back to email-derived handle when we don't already have one.
  if (args.githubLogin) return args.githubLogin;
  if (!args.existingHandle && args.email) return args.email.split("@")[0]?.trim() || undefined;
  return undefined;
}

function appendHandleSuffix(base: string, suffix: number) {
  const suffixText = suffix <= 1 ? "" : `-${suffix}`;
  const maxBaseLength = Math.max(2, 40 - suffixText.length);
  return `${base.slice(0, maxBaseLength)}${suffixText}`;
}

async function resolveAvailableHandle(
  ctx: MutationCtx,
  preferredHandle: string | undefined,
  userId: Id<"users">,
) {
  const normalizedHandle = normalizeReservedHandle(preferredHandle);
  if (!normalizedHandle) return undefined;
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const candidate = appendHandleSuffix(normalizedHandle, suffix);
    if (await canUserClaimHandle(ctx, candidate, userId)) return candidate;
  }
  return undefined;
}

async function canUserClaimHandle(
  ctx: MutationCtx,
  handle: string | undefined,
  userId: Id<"users">,
) {
  const normalizedHandle = normalizeReservedHandle(handle);
  if (!normalizedHandle) return false;
  if (await isHandleReservedForAnotherUser(ctx, normalizedHandle, userId)) return false;

  const publisher = await getPublisherByHandle(ctx, normalizedHandle);
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return true;
  return publisher.kind === "user" && publisher.linkedUserId === userId;
}

async function computeEnsureUpdates(ctx: MutationCtx, user: Doc<"users">) {
  const updates: Record<string, unknown> = {};

  const existingHandle = normalizeHandle(user.handle);
  const existingHandleClaimable = existingHandle
    ? await canUserClaimHandle(ctx, existingHandle, user._id)
    : false;
  const githubLogin = normalizeHandle(user.name);
  const requestedHandle = deriveHandle({
    existingHandle,
    githubLogin,
    email: user.email,
  });
  let derivedHandle =
    requestedHandle && (await canUserClaimHandle(ctx, requestedHandle, user._id))
      ? requestedHandle
      : undefined;
  if (!derivedHandle && (!existingHandle || !existingHandleClaimable)) {
    const emailFallback = normalizeHandle(user.email?.split("@")[0]);
    const emailFallbackHandle =
      emailFallback && emailFallback !== requestedHandle
        ? await resolveAvailableHandle(ctx, emailFallback, user._id)
        : undefined;
    derivedHandle =
      (await resolveAvailableHandle(
        ctx,
        requestedHandle ?? existingHandle ?? githubLogin ?? emailFallback,
        user._id,
      )) ?? emailFallbackHandle;
  }
  const baseHandle = derivedHandle ?? (existingHandleClaimable ? existingHandle : undefined);

  if (derivedHandle && existingHandle !== derivedHandle) {
    updates.handle = derivedHandle;
  }

  const displayName = normalizeHandle(user.displayName);
  if (!displayName && baseHandle) {
    updates.displayName = baseHandle;
  } else if (derivedHandle && displayName === existingHandle) {
    updates.displayName = derivedHandle;
  }

  if (!user.role) {
    updates.role = baseHandle === ADMIN_HANDLE ? "admin" : DEFAULT_ROLE;
  }

  if (!user.createdAt) updates.createdAt = user._creationTime;

  return updates;
}

export async function ensureHandler(ctx: MutationCtx) {
  const { userId, user } = await requireUser(ctx);
  const updates = await computeEnsureUpdates(ctx, user);

  const hasUpdates = Object.keys(updates).length > 0;
  if (Object.keys(updates).length > 0) {
    updates.updatedAt = Date.now();
    await ctx.db.patch(userId, updates);
  }
  const ensuredUser = hasUpdates
    ? ({ ...user, ...updates } as Doc<"users">)
    : ((await ctx.db.get(userId)) ?? user);
  await ensurePersonalPublisherForUser(ctx, ensuredUser);
  return await ctx.db.get(userId);
}

export const updateProfile = mutation({
  args: {
    displayName: v.string(),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    await ctx.db.patch(userId, {
      displayName: args.displayName.trim(),
      bio: args.bio?.trim(),
      updatedAt: Date.now(),
    });
    const user = await ctx.db.get(userId);
    if (user) {
      await ensurePersonalPublisherForUser(ctx, user);
    }
  },
});

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx);
    const now = Date.now();

    const tokens = await ctx.db
      .query("apiTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const token of tokens) {
      if (!token.revokedAt) {
        await ctx.db.patch(token._id, { revokedAt: now });
      }
    }

    await ctx.db.patch(userId, {
      deactivatedAt: now,
      purgedAt: now,
      deletedAt: undefined,
      banReason: undefined,
      role: "user",
      handle: undefined,
      displayName: undefined,
      name: undefined,
      image: undefined,
      email: undefined,
      emailVerificationTime: undefined,
      phone: undefined,
      phoneVerificationTime: undefined,
      isAnonymous: undefined,
      bio: undefined,
      githubCreatedAt: undefined,
      updatedAt: now,
    });
    await ctx.runMutation(internal.telemetry.clearUserTelemetryInternal, { userId });
  },
});

export const list = query({
  args: { limit: v.optional(v.number()), search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);
    const limit = clampInt(args.limit ?? 50, 1, MAX_USER_LIST_LIMIT);
    const exactHandleUser = args.search
      ? await getUserByHandleOrPersonalPublisher(ctx, args.search)
      : null;
    const result = await queryUsersForAdminList(ctx, {
      limit,
      search: args.search,
      exactUserId: exactHandleUser?._id,
    });
    const dedupedUsers = exactHandleUser
      ? [exactHandleUser, ...result.items.filter((entry) => entry._id !== exactHandleUser._id)]
      : result.items;
    const total = exactHandleUser
      ? result.total + (result.containsExactUser ? 0 : 1)
      : result.total;
    return {
      items: dedupedUsers.slice(0, limit),
      total,
    };
  },
});

function normalizeSearchQuery(search?: string) {
  const trimmed = search?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

function computeUserSearchScanLimit(limit: number) {
  return clampInt(limit * 10, MIN_USER_SEARCH_SCAN, MAX_USER_SEARCH_SCAN);
}

async function queryUsersForAdminList(
  ctx: Pick<QueryCtx, "db">,
  args: { limit: number; search?: string; exactUserId?: Id<"users"> },
) {
  const normalizedSearch = normalizeSearchQuery(args.search);
  const orderedUsers = ctx.db.query("users").order("desc");

  if (!normalizedSearch) {
    const items = await orderedUsers.take(args.limit);
    return { items, total: items.length, containsExactUser: false };
  }

  const scannedUsers = await orderedUsers.take(computeUserSearchScanLimit(args.limit));
  const result = buildUserSearchResults(scannedUsers, normalizedSearch);
  return {
    items: result.items.slice(0, args.limit),
    total: result.total,
    containsExactUser: args.exactUserId
      ? result.items.some((user) => user._id === args.exactUserId)
      : false,
  };
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

export const getByHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    return toPublicUser(await getActiveUserByHandleOrPersonalPublisher(ctx, args.handle));
  },
});

export const getReservedHandleInternal = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    return await getLatestActiveReservedHandle(ctx, args.handle);
  },
});

export const setRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("moderator"), v.literal("user")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return setRoleWithActor(ctx, user, args.userId, args.role);
  },
});

export const reserveHandleInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    rightfulOwnerUserId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    assertAdmin(actor);

    const rightfulOwner = await ctx.db.get(args.rightfulOwnerUserId);
    if (!rightfulOwner || rightfulOwner.deletedAt || rightfulOwner.deactivatedAt) {
      throw new Error("Rightful owner not found");
    }

    const normalizedHandle = normalizeReservedHandle(args.handle);
    if (!normalizedHandle) throw new Error("Handle required");

    const existingUser = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", normalizedHandle))
      .unique();
    if (existingUser && existingUser._id !== args.rightfulOwnerUserId) {
      throw new Error("Handle already claimed by another user");
    }

    const now = Date.now();
    await upsertReservedHandleForRightfulOwner(ctx, {
      handle: normalizedHandle,
      rightfulOwnerUserId: args.rightfulOwnerUserId,
      reason: args.reason,
      now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "handle.reserve",
      targetType: "handle",
      targetId: normalizedHandle,
      metadata: {
        handle: normalizedHandle,
        rightfulOwnerUserId: args.rightfulOwnerUserId,
        reason: args.reason || undefined,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      handle: normalizedHandle,
      rightfulOwnerUserId: args.rightfulOwnerUserId,
    };
  },
});

export const setRoleInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("moderator"), v.literal("user")),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    return setRoleWithActor(ctx, actor, args.targetUserId, args.role);
  },
});

async function setRoleWithActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  targetUserId: Id<"users">,
  role: "admin" | "moderator" | "user",
) {
  assertAdmin(actor);
  const target = await ctx.db.get(targetUserId);
  if (!target) throw new Error("User not found");
  const now = Date.now();
  await ctx.db.patch(targetUserId, { role, updatedAt: now });
  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "role.change",
    targetType: "user",
    targetId: targetUserId,
    metadata: { role },
    createdAt: now,
  });
  return { ok: true as const, role };
}

export const banUser = mutation({
  args: { userId: v.id("users"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return banUserWithActor(ctx, user, args.userId, args.reason);
  },
});

export const banUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    return banUserWithActor(ctx, actor, args.targetUserId, args.reason);
  },
});

export const unbanUser = mutation({
  args: { userId: v.id("users"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return unbanUserWithActor(ctx, user, args.userId, args.reason);
  },
});

export const unbanUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    return unbanUserWithActor(ctx, actor, args.targetUserId, args.reason);
  },
});

async function banUserWithActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  targetUserId: Id<"users">,
  reasonRaw?: string,
) {
  assertModerator(actor);

  if (targetUserId === actor._id) throw new Error("Cannot ban yourself");

  const target = await ctx.db.get(targetUserId);
  if (!target) throw new Error("User not found");
  if (target.role === "admin" && actor.role !== "admin") {
    throw new Error("Forbidden");
  }

  const now = Date.now();
  const reason = reasonRaw?.trim();
  if (reason && reason.length > 500) {
    throw new Error("Reason too long (max 500 chars)");
  }
  if (target.deactivatedAt) {
    return {
      ok: true as const,
      alreadyBanned: true,
      deletedSkills: 0,
      deletedComments: { skillComments: 0, soulComments: 0 },
    };
  }
  if (target.deletedAt) {
    const deletedComments = await softDeleteUserCommentsForBan(ctx, {
      userId: targetUserId,
      deletedBy: actor._id,
      deletedAt: target.deletedAt,
    });
    return { ok: true as const, alreadyBanned: true, deletedSkills: 0, deletedComments };
  }

  const banSkillsResult = (await ctx.runMutation(
    internal.skills.applyBanToOwnedSkillsBatchInternal,
    {
      ownerUserId: targetUserId,
      bannedAt: now,
      hiddenBy: actor._id,
      cursor: undefined,
    },
  )) as { hiddenCount?: number; scheduled?: boolean };
  const hiddenCount = banSkillsResult.hiddenCount ?? 0;
  const scheduledSkills = banSkillsResult.scheduled ?? false;

  const tokens = await ctx.db
    .query("apiTokens")
    .withIndex("by_user", (q) => q.eq("userId", targetUserId))
    .collect();
  for (const token of tokens) {
    if (!token.revokedAt) {
      await ctx.db.patch(token._id, { revokedAt: now });
    }
  }

  const deletedComments = await softDeleteUserCommentsForBan(ctx, {
    userId: targetUserId,
    deletedBy: actor._id,
    deletedAt: now,
  });

  await ctx.db.patch(targetUserId, {
    deletedAt: now,
    role: "user",
    updatedAt: now,
    banReason: reason || undefined,
  });

  await ctx.runMutation(internal.telemetry.clearUserTelemetryInternal, { userId: targetUserId });

  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "user.ban",
    targetType: "user",
    targetId: targetUserId,
    metadata: {
      hiddenSkills: hiddenCount,
      deletedSkillComments: deletedComments.skillComments,
      deletedSoulComments: deletedComments.soulComments,
      reason: reason || undefined,
    },
    createdAt: now,
  });

  return {
    ok: true as const,
    alreadyBanned: false,
    deletedSkills: hiddenCount,
    deletedComments,
    scheduledSkills,
  };
}

async function unbanUserWithActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  targetUserId: Id<"users">,
  reasonRaw?: string,
) {
  assertAdmin(actor);
  if (targetUserId === actor._id) throw new Error("Cannot unban yourself");

  const target = await ctx.db.get(targetUserId);
  if (!target) throw new Error("User not found");
  if (target.deactivatedAt) {
    throw new Error("Cannot unban a permanently deleted account");
  }
  if (!target.deletedAt) {
    return { ok: true as const, alreadyUnbanned: true };
  }

  const reason = reasonRaw?.trim();
  if (reason && reason.length > 500) {
    throw new Error("Reason too long (max 500 chars)");
  }

  const now = Date.now();
  const bannedAt = target.deletedAt;
  await ctx.db.patch(targetUserId, {
    deletedAt: undefined,
    banReason: undefined,
    role: "user",
    updatedAt: now,
  });

  const restoreSkillsResult = (await ctx.runMutation(
    internal.skills.restoreOwnedSkillsForUnbanBatchInternal,
    {
      ownerUserId: targetUserId,
      bannedAt,
      cursor: undefined,
    },
  )) as { restoredCount?: number; scheduled?: boolean };
  const restoredCount = restoreSkillsResult.restoredCount ?? 0;
  const scheduledSkills = restoreSkillsResult.scheduled ?? false;

  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "user.unban",
    targetType: "user",
    targetId: targetUserId,
    metadata: { reason: reason || undefined, restoredSkills: restoredCount },
    createdAt: now,
  });

  return {
    ok: true as const,
    alreadyUnbanned: false,
    restoredSkills: restoredCount,
    scheduledSkills,
  };
}

/**
 * Admin-only: set or unset the trustedPublisher flag for a user.
 * Trusted publishers bypass the pending.scan auto-hide for new skill publishes.
 */
export const setTrustedPublisher = mutation({
  args: {
    userId: v.id("users"),
    trusted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertAdmin(user);

    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");

    const now = Date.now();
    await ctx.db.patch(args.userId, {
      trustedPublisher: args.trusted || undefined,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: args.trusted ? "user.trusted.set" : "user.trusted.unset",
      targetType: "user",
      targetId: args.userId,
      metadata: { trusted: args.trusted },
      createdAt: now,
    });

    return { ok: true as const, trusted: args.trusted };
  },
});

export const setTrustedPublisherInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    trusted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    assertAdmin(actor);

    const target = await ctx.db.get(args.targetUserId);
    if (!target) throw new Error("User not found");

    const now = Date.now();
    await ctx.db.patch(args.targetUserId, {
      trustedPublisher: args.trusted || undefined,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: args.trusted ? "user.trusted.set" : "user.trusted.unset",
      targetType: "user",
      targetId: args.targetUserId,
      metadata: { trusted: args.trusted },
      createdAt: now,
    });

    return { ok: true as const, trusted: args.trusted };
  },
});

async function ensurePublisherHandleWithActor(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"users">;
    handle: string;
    displayName?: string;
    trusted?: boolean;
  },
) {
  const actor = await ctx.db.get(args.actorUserId);
  if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
  assertAdmin(actor);

  const normalizedHandle = normalizeReservedHandle(args.handle);
  if (!normalizedHandle) throw new Error("Handle required");

  const existing = await ctx.db
    .query("users")
    .withIndex("handle", (q) => q.eq("handle", normalizedHandle))
    .unique();
  if (existing?.deletedAt || existing?.deactivatedAt) {
    throw new Error("Handle belongs to a deleted or deactivated user");
  }

  const now = Date.now();
  const displayName = args.displayName?.trim() || normalizedHandle;
  const trusted = args.trusted === false ? undefined : true;
  const userId =
    existing?._id ??
    (await ctx.db.insert("users", {
      handle: normalizedHandle,
      displayName,
      role: "user",
      trustedPublisher: trusted,
      createdAt: now,
      updatedAt: now,
    }));

  if (existing) {
    const nextDisplayName =
      args.displayName?.trim() &&
      (!existing.displayName || existing.displayName === existing.handle)
        ? displayName
        : existing.displayName;
    await ctx.db.patch(existing._id, {
      displayName: nextDisplayName,
      trustedPublisher: trusted,
      updatedAt: now,
    });
  }

  await upsertReservedHandleForRightfulOwner(ctx, {
    handle: normalizedHandle,
    rightfulOwnerUserId: userId,
    reason: "shared publisher",
    now,
  });

  await ctx.db.insert("auditLogs", {
    actorUserId: args.actorUserId,
    action: "user.publisher.ensure",
    targetType: "user",
    targetId: userId,
    metadata: {
      handle: normalizedHandle,
      trusted: trusted === true,
    },
    createdAt: now,
  });

  return {
    ok: true as const,
    userId,
    handle: normalizedHandle,
    created: !existing,
    trusted: trusted === true,
  };
}

export const ensurePublisherHandle = mutation({
  args: {
    handle: v.string(),
    displayName: v.optional(v.string()),
    trusted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return await ensurePublisherHandleWithActor(ctx, {
      actorUserId: user._id,
      handle: args.handle,
      displayName: args.displayName,
      trusted: args.trusted,
    });
  },
});

export const ensurePublisherHandleInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    displayName: v.optional(v.string()),
    trusted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => await ensurePublisherHandleWithActor(ctx, args),
});

/**
 * Auto-ban a user whose skill was flagged malicious by VT.
 * Skips moderators/admins. No actor required — this is a system-level action.
 */
export const autobanMalwareAuthorInternal = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    sha256hash: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.ownerUserId);
    if (!target) return { ok: false, reason: "user_not_found" };
    if (target.deletedAt || target.deactivatedAt) return { ok: true, alreadyBanned: true };

    // Never auto-ban moderators or admins
    if (target.role === "admin" || target.role === "moderator") {
      console.log(`[autoban] Skipping ${target.handle ?? args.ownerUserId}: role=${target.role}`);
      return { ok: false, reason: "protected_role" };
    }

    const now = Date.now();

    const banSkillsResult = (await ctx.runMutation(
      internal.skills.applyBanToOwnedSkillsBatchInternal,
      {
        ownerUserId: args.ownerUserId,
        bannedAt: now,
        cursor: undefined,
      },
    )) as { hiddenCount?: number; scheduled?: boolean };
    const hiddenCount = banSkillsResult.hiddenCount ?? 0;
    const scheduledSkills = banSkillsResult.scheduled ?? false;

    // Revoke all API tokens
    const tokens = await ctx.db
      .query("apiTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.ownerUserId))
      .collect();
    for (const token of tokens) {
      if (!token.revokedAt) {
        await ctx.db.patch(token._id, { revokedAt: now });
      }
    }

    const deletedComments = await softDeleteUserCommentsForBan(ctx, {
      userId: args.ownerUserId,
      deletedBy: args.ownerUserId,
      deletedAt: now,
    });

    // Ban the user
    await ctx.db.patch(args.ownerUserId, {
      deletedAt: now,
      role: "user",
      updatedAt: now,
      banReason: "malware auto-ban",
    });

    await ctx.runMutation(internal.telemetry.clearUserTelemetryInternal, {
      userId: args.ownerUserId,
    });

    // Audit log -- use the target as actor since there's no human actor
    await ctx.db.insert("auditLogs", {
      actorUserId: args.ownerUserId,
      action: "user.autoban.malware",
      targetType: "user",
      targetId: args.ownerUserId,
      metadata: {
        trigger: "vt.malicious",
        sha256hash: args.sha256hash,
        slug: args.slug,
        hiddenSkills: hiddenCount,
        deletedSkillComments: deletedComments.skillComments,
        deletedSoulComments: deletedComments.soulComments,
      },
      createdAt: now,
    });

    console.warn(
      `[autoban] Banned ${target.handle ?? args.ownerUserId} — malicious skill: ${args.slug}`,
    );

    return {
      ok: true,
      alreadyBanned: false,
      deletedSkills: hiddenCount,
      deletedComments,
      scheduledSkills,
    };
  },
});

export const placeUserUnderModerationInternal = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    slug: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.ownerUserId);
    if (!target) return { ok: false, reason: "user_not_found" as const };
    if (target.deletedAt || target.deactivatedAt) {
      return { ok: true, alreadyModerated: true as const, hiddenSkills: 0 };
    }
    if (target.role === "admin" || target.role === "moderator") {
      console.log(
        `[moderation] Skipping ${target.handle ?? args.ownerUserId}: role=${target.role}`,
      );
      return { ok: false, reason: "protected_role" as const };
    }

    const now = Date.now();
    const alreadyModerated = Boolean(target.requiresModerationAt);
    const moderationReason = `Auto-held for moderation after malicious upload (${args.reason})`;

    if (!alreadyModerated) {
      await ctx.db.patch(args.ownerUserId, {
        requiresModerationAt: now,
        requiresModerationReason: moderationReason,
        updatedAt: now,
      });
    }

    const hideSkillsResult = (await ctx.runMutation(
      internal.skills.applyUserModerationToOwnedSkillsBatchInternal,
      {
        ownerUserId: args.ownerUserId,
        hiddenAt: now,
        cursor: undefined,
      },
    )) as { hiddenCount?: number; scheduled?: boolean };

    await ctx.db.insert("auditLogs", {
      actorUserId: args.ownerUserId,
      action: "user.moderation.auto",
      targetType: "user",
      targetId: args.ownerUserId,
      metadata: {
        trigger: "static.malicious",
        slug: args.slug,
        reason: args.reason,
        hiddenSkills: hideSkillsResult.hiddenCount ?? 0,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      alreadyModerated,
      hiddenSkills: hideSkillsResult.hiddenCount ?? 0,
      scheduledSkills: hideSkillsResult.scheduled ?? false,
    };
  },
});

async function softDeleteUserCommentsForBan(
  ctx: MutationCtx,
  args: { userId: Id<"users">; deletedBy: Id<"users">; deletedAt: number },
) {
  let skillComments = 0;
  let soulComments = 0;

  const comments = await ctx.db
    .query("comments")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .collect();
  for (const comment of comments) {
    if (comment.softDeletedAt) continue;
    await ctx.db.patch(comment._id, {
      softDeletedAt: args.deletedAt,
      deletedBy: args.deletedBy,
    });
    await insertStatEvent(ctx, { skillId: comment.skillId, kind: "uncomment" });
    skillComments += 1;
  }

  const soulCommentDocs = await ctx.db
    .query("soulComments")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .collect();
  const soulCommentCounts = new Map<Id<"souls">, number>();
  for (const comment of soulCommentDocs) {
    if (comment.softDeletedAt) continue;
    await ctx.db.patch(comment._id, {
      softDeletedAt: args.deletedAt,
      deletedBy: args.deletedBy,
    });
    soulCommentCounts.set(comment.soulId, (soulCommentCounts.get(comment.soulId) ?? 0) + 1);
    soulComments += 1;
  }

  for (const [soulId, count] of soulCommentCounts.entries()) {
    const soul = await ctx.db.get(soulId);
    if (!soul) continue;
    await ctx.db.patch(soulId, {
      stats: { ...soul.stats, comments: Math.max(0, soul.stats.comments - count) },
      updatedAt: args.deletedAt,
    });
  }

  return { skillComments, soulComments };
}
