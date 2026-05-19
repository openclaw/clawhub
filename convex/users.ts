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
import { isLocalDevAuthEnabled } from "./lib/devAuth";
import { syncGitHubProfile } from "./lib/githubAccount";
import { resolvePackageReleaseScanStatus } from "./lib/packageSecurity";
import { toPublicUser } from "./lib/public";
import { isReservedPublicOwnerHandle } from "./lib/publicRouteReservations";
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
const DEV_PERSONA_GITHUB_CREATED_AT = Date.UTC(2020, 0, 1);
const MALWARE_AUTOBAN_REASON = "malware auto-ban";
const DEFAULT_AUTOBAN_REMEDIATION_REASON =
  "Autoban remediation: current scanner verdict is non-malicious";
const MAX_AUTOBAN_REMEDIATION_LIMIT = 100;
const AUTOBAN_AUDIT_MATCH_WINDOW_MS = 5_000;
const AUTOBAN_REMEDIATION_COUNT_PAGE_SIZE = 100;
const autobanRemediationInternalRefs = internal as unknown as {
  users: {
    countRestorableAutobanSkillsPageInternal: unknown;
    listRestorableAutobanPackageCandidatesPageInternal: unknown;
    hasRestorableAutobanPackageReleasePageInternal: unknown;
  };
  skills: {
    previewLatestSkillModerationInternal: unknown;
    recomputeLatestSkillModerationInternal: unknown;
    restoreOwnedSkillsForAutobanRemediationBatchInternal: unknown;
  };
  packages: {
    restoreOwnedPackagesForAutobanRemediationBatchInternal: unknown;
  };
};

async function runAutobanRemediationQueryRef<T>(
  ctx: Pick<MutationCtx, "runQuery">,
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

async function runAutobanRemediationMutationRef<T>(
  ctx: Pick<MutationCtx, "runMutation">,
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

const DEV_PERSONAS = {
  owner: {
    handle: "local",
    displayName: "Local Owner",
    role: "user",
  },
  user: {
    handle: "local-user",
    displayName: "Local User",
    role: "user",
  },
  admin: {
    handle: "local-admin",
    displayName: "Local Admin",
    role: "admin",
  },
} as const;

type DevPersona = keyof typeof DEV_PERSONAS;

export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => toPublicUser(await ctx.db.get(args.userId)),
});

export const getByIdInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => ctx.db.get(args.userId),
});

export const upsertDevPersonaInternal = internalMutation({
  args: { persona: v.union(v.literal("owner"), v.literal("user"), v.literal("admin")) },
  handler: async (ctx, args): Promise<Id<"users">> => {
    if (!isLocalDevAuthEnabled()) throw new Error("Dev auth is disabled");

    const persona = DEV_PERSONAS[args.persona as DevPersona];
    const now = Date.now();
    const existing = await getUserByHandleOrPersonalPublisher(ctx, persona.handle);
    const patch = {
      handle: persona.handle,
      displayName: persona.displayName,
      name: persona.displayName,
      role: persona.role,
      githubCreatedAt: DEV_PERSONA_GITHUB_CREATED_AT,
      deletedAt: undefined,
      deactivatedAt: undefined,
      purgedAt: undefined,
      banReason: undefined,
      updatedAt: now,
    };
    const userId =
      existing?._id ??
      (await ctx.db.insert("users", {
        ...patch,
        createdAt: now,
      }));
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    }
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Dev persona was not created");
    await ensurePersonalPublisherForUser(ctx, user, {
      actorUserId: user._id,
      source: "dev_persona.upsert",
    });
    return userId;
  },
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
    if (didChangeProfile) {
      await ctx.db.insert("auditLogs", {
        actorUserId: args.userId,
        action: "user.profile.sync",
        targetType: "user",
        targetId: args.userId,
        metadata: {
          source: "github",
          previous: {
            name: user.name ?? null,
            handle: user.handle ?? null,
            displayName: user.displayName ?? null,
            image: user.image ?? null,
          },
          next: {
            name: updates.name ?? user.name ?? null,
            handle: updates.handle ?? user.handle ?? null,
            displayName: updates.displayName ?? user.displayName ?? null,
            image: updates.image ?? user.image ?? null,
          },
        },
        createdAt: updates.updatedAt ?? args.syncedAt,
      });
    }
    const nextUser = didChangeProfile ? ({ ...user, ...updates } as Doc<"users">) : user;
    await ensurePersonalPublisherForUser(ctx, nextUser, {
      actorUserId: args.userId,
      source: "user.profile.sync",
    });
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
  if (isReservedPublicOwnerHandle(normalizedHandle)) return false;
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
  await ensurePersonalPublisherForUser(
    ctx,
    ensuredUser,
    {
      actorUserId: userId,
      source: "user.ensure",
    },
    { handleConflict: "skip" },
  );
  if (hasUpdates) {
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "user.profile.ensure",
      targetType: "user",
      targetId: userId,
      metadata: {
        changedFields: Object.keys(updates).filter((field) => field !== "updatedAt"),
      },
      createdAt: updates.updatedAt as number,
    });
  }
  return await ctx.db.get(userId);
}

export const updateProfile = mutation({
  args: {
    displayName: v.string(),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const user = await ctx.db.get(userId);
    const now = Date.now();
    const displayName = args.displayName.trim();
    const bio = args.bio?.trim();
    await ctx.db.patch(userId, {
      displayName,
      bio,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "user.profile.update",
      targetType: "user",
      targetId: userId,
      metadata: {
        previous: {
          displayName: user?.displayName ?? null,
          bio: user?.bio ?? null,
        },
        next: {
          displayName,
          bio: bio ?? null,
        },
      },
      createdAt: now,
    });
    const nextUser = await ctx.db.get(userId);
    if (nextUser) {
      await ensurePersonalPublisherForUser(
        ctx,
        nextUser,
        {
          actorUserId: userId,
          source: "user.profile.update",
        },
        { handleConflict: "skip" },
      );
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

    const user = await ctx.db.get(userId);
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
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "user.delete",
      targetType: "user",
      targetId: userId,
      metadata: {
        previous: {
          handle: user?.handle ?? null,
          displayName: user?.displayName ?? null,
          name: user?.name ?? null,
          image: user?.image ?? null,
          emailPresent: Boolean(user?.email),
          personalPublisherId: user?.personalPublisherId ?? null,
        },
      },
      createdAt: now,
    });
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

export const listPublic = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 40, 1, 100);
    const result = await queryUsersForPublicList(ctx, {
      limit,
    });
    return {
      items: result.items
        .map((user) => toPublicUser(user))
        .filter((user): user is NonNullable<ReturnType<typeof toPublicUser>> => Boolean(user)),
      total: result.total,
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

async function queryUsersForPublicList(
  ctx: Pick<QueryCtx, "db">,
  args: { limit: number; search?: string },
) {
  const normalizedSearch = normalizeSearchQuery(args.search);
  const scanLimit = normalizedSearch
    ? computeUserSearchScanLimit(args.limit)
    : clampInt(args.limit * 6, args.limit, MAX_USER_SEARCH_SCAN);
  const scannedUsers = await ctx.db
    .query("users")
    .withIndex("by_active_handle", (q) =>
      q.eq("deletedAt", undefined).eq("deactivatedAt", undefined),
    )
    .order("desc")
    .take(scanLimit);
  const activeUsers = scannedUsers.filter((user) => Boolean(user.handle));
  const result = buildUserSearchResults(activeUsers, normalizedSearch);
  return {
    items: result.items.slice(0, args.limit),
    total: result.total,
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

/** Lightweight stats for user hover tooltips. Uses the skills by_owner index. */
export const getHoverStats = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);

    return {
      publishedSkills: user?.publishedSkills ?? 0,
      totalStars: user?.totalStars ?? 0,
      totalDownloads: user?.totalDownloads ?? 0,
    };
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

export const reclassifyBanInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    reason: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    assertAdmin(actor);

    const target = await ctx.db.get(args.targetUserId);
    if (!target) throw new Error("User not found");
    if (target.deactivatedAt || target.purgedAt) {
      throw new Error("Cannot reclassify a deactivated account");
    }
    if (!target.deletedAt) {
      throw new Error("User is not currently banned");
    }

    const nextReason = args.reason.trim();
    if (!nextReason) throw new Error("Reason required");
    if (nextReason.length > 500) throw new Error("Reason too long (max 500 chars)");

    const previousReason = target.banReason ?? null;
    const changed = previousReason !== nextReason;
    const dryRun = args.dryRun !== false;

    if (!dryRun && changed) {
      const now = Date.now();
      await ctx.db.patch(args.targetUserId, {
        banReason: nextReason,
        updatedAt: now,
      });
      await ctx.db.insert("auditLogs", {
        actorUserId: actor._id,
        action: "user.ban.reclassify",
        targetType: "user",
        targetId: args.targetUserId,
        metadata: {
          previousReason,
          nextReason,
        },
        createdAt: now,
      });
    }

    return {
      ok: true as const,
      dryRun,
      userId: args.targetUserId,
      handle: target.handle ?? null,
      previousReason,
      nextReason,
      changed,
    };
  },
});

export const remediateAutobansInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetUserId: v.optional(v.id("users")),
    handle: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    since: v.optional(v.string()),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    assertAdmin(actor);

    const dryRun = args.dryRun !== false;
    const limit = normalizeAutobanRemediationLimit(args.limit);
    const sinceMs = parseAutobanRemediationSince(args.since);
    const reason = normalizeAutobanRemediationReason(args.reason);
    const candidates = await listAutobanRemediationCandidates(ctx, {
      targetUserId: args.targetUserId,
      handle: args.handle,
      sinceMs,
      cursor: args.cursor,
      limit,
    });

    const items = [];
    let wouldUnban = 0;
    let unbanned = 0;
    let skipped = 0;
    let restoredSkills = 0;
    let restoredPackages = 0;

    for (const candidate of candidates.items) {
      const item = await evaluateAutobanRemediationCandidate(ctx, {
        actor,
        target: candidate,
        dryRun,
        reason,
      });
      items.push(item);
      if (item.decision === "would_unban") wouldUnban += 1;
      if (item.decision === "unbanned") unbanned += 1;
      if (item.decision !== "would_unban" && item.decision !== "unbanned") skipped += 1;
      restoredSkills += item.restoredSkills ?? 0;
      restoredPackages += item.restoredPackages ?? 0;
    }

    return {
      ok: true as const,
      dryRun,
      scanned: candidates.items.length,
      wouldUnban,
      unbanned,
      skipped,
      restoredSkills,
      restoredPackages,
      items,
      nextCursor: candidates.nextCursor,
      done: candidates.done,
    };
  },
});

type AutobanRemediationTrigger = {
  slug: string | null;
  sha256hash: string | null;
  trigger: string | null;
  artifactKind: "skill" | "package" | "unknown";
  artifactId: string | null;
  verdict: string | null;
  reason: string | null;
  reasonCodes: string[];
};

type AutobanRemediationCountPage = {
  count: number;
  isDone: boolean;
  continueCursor: string | null;
};

type AutobanRemediationPackageCandidatePage = {
  packageIds: Array<Id<"packages">>;
  isDone: boolean;
  continueCursor: string | null;
};

type AutobanRemediationPackageReleasePage = {
  hasRestorable: boolean;
  isDone: boolean;
  continueCursor: string | null;
};

function normalizeAutobanRemediationLimit(limit: number | undefined) {
  if (!Number.isFinite(limit ?? 25)) return 25;
  return Math.max(1, Math.min(Math.floor(limit ?? 25), MAX_AUTOBAN_REMEDIATION_LIMIT));
}

function parseAutobanRemediationSince(since: string | undefined) {
  const trimmed = since?.trim();
  if (!trimmed) return 0;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) throw new Error("Invalid since date");
  return parsed;
}

function normalizeAutobanRemediationReason(reasonRaw: string | undefined) {
  const reason = reasonRaw?.trim() || DEFAULT_AUTOBAN_REMEDIATION_REASON;
  if (reason.length > 500) throw new Error("Reason too long (max 500 chars)");
  return reason;
}

async function listAutobanRemediationCandidates(
  ctx: MutationCtx,
  args: {
    targetUserId?: Id<"users">;
    handle?: string;
    sinceMs: number;
    cursor?: string;
    limit: number;
  },
) {
  if (args.targetUserId) {
    const user = await ctx.db.get(args.targetUserId);
    return {
      items: user
        ? [user].filter((candidate) => isAutobanRemediationCandidate(candidate, args.sinceMs))
        : [],
      nextCursor: null,
      done: true,
    };
  }

  const handle = args.handle?.trim().toLowerCase();
  if (handle) {
    const user = await getUserByHandleOrPersonalPublisher(ctx, handle);
    return {
      items: user && isAutobanRemediationCandidate(user, args.sinceMs) ? [user] : [],
      nextCursor: null,
      done: true,
    };
  }

  const page = await ctx.db
    .query("users")
    .withIndex("by_ban_reason_deleted_at", (q) =>
      q.eq("banReason", MALWARE_AUTOBAN_REASON).gte("deletedAt", args.sinceMs),
    )
    .paginate({
      cursor: args.cursor ?? null,
      numItems: args.limit,
    });
  return {
    items: page.page.filter((candidate) => isAutobanRemediationCandidate(candidate, args.sinceMs)),
    nextCursor: page.continueCursor || null,
    done: page.isDone,
  };
}

function isAutobanRemediationCandidate(user: Doc<"users">, sinceMs = 0) {
  return Boolean(
    user.deletedAt &&
    user.deletedAt >= sinceMs &&
    user.banReason === MALWARE_AUTOBAN_REASON &&
    !user.deactivatedAt &&
    !user.purgedAt,
  );
}

async function evaluateAutobanRemediationCandidate(
  ctx: MutationCtx,
  args: {
    actor: Doc<"users">;
    target: Doc<"users">;
    dryRun: boolean;
    reason: string;
  },
) {
  const bannedAt = args.target.deletedAt;
  if (!bannedAt || args.target.banReason !== MALWARE_AUTOBAN_REASON) {
    return buildAutobanRemediationItem(args.target, {
      decision: "skipped",
      skipReason: "not_current_malware_autoban",
      triggers: [],
    });
  }

  const triggerLogs = await ctx.db
    .query("auditLogs")
    .withIndex("by_target_createdAt", (q) =>
      q
        .eq("targetType", "user")
        .eq("targetId", args.target._id)
        .gte("createdAt", bannedAt - AUTOBAN_AUDIT_MATCH_WINDOW_MS)
        .lte("createdAt", bannedAt + AUTOBAN_AUDIT_MATCH_WINDOW_MS),
    )
    .collect();
  const autobanLogs = triggerLogs.filter((log) => log.action === "user.autoban.malware");
  if (autobanLogs.length === 0) {
    return buildAutobanRemediationItem(args.target, {
      decision: "blocked",
      skipReason: "missing_trigger_audit",
      triggers: [],
    });
  }

  const triggers: AutobanRemediationTrigger[] = [];
  for (const log of autobanLogs) {
    triggers.push(await evaluateAutobanTrigger(ctx, args.target, log.metadata, args.dryRun));
  }
  const missingTrigger = triggers.find((trigger) => !trigger.artifactId);
  if (missingTrigger) {
    return buildAutobanRemediationItem(args.target, {
      decision: "blocked",
      skipReason: "missing_trigger_artifact",
      triggers,
    });
  }
  const maliciousTrigger = triggers.find((trigger) => trigger.verdict === "malicious");
  if (maliciousTrigger) {
    return buildAutobanRemediationItem(args.target, {
      decision: "kept_banned",
      skipReason: "trigger_still_malicious",
      triggers,
    });
  }
  const unknownTrigger = triggers.find((trigger) => !isResolvedNonMaliciousTrigger(trigger));
  if (unknownTrigger) {
    return buildAutobanRemediationItem(args.target, {
      decision: "blocked",
      skipReason: "trigger_not_non_malicious",
      triggers,
    });
  }

  if (args.dryRun) {
    const counts = await countAutobanRemediationRestores(ctx, args.target._id, bannedAt, triggers);
    return buildAutobanRemediationItem(args.target, {
      decision: "would_unban",
      triggers,
      restoredSkills: counts.skills,
      restoredPackages: counts.packages,
    });
  }

  const now = Date.now();
  await ctx.db.patch(args.target._id, {
    deletedAt: undefined,
    banReason: undefined,
    role: "user",
    updatedAt: now,
  });
  const restoreSkillsResult = await runAutobanRemediationMutationRef<{
    restoredCount?: number;
    scheduled?: boolean;
  }>(
    ctx,
    autobanRemediationInternalRefs.skills.restoreOwnedSkillsForAutobanRemediationBatchInternal,
    {
      actorUserId: args.actor._id,
      ownerUserId: args.target._id,
      bannedAt,
      cursor: undefined,
    },
  );
  const restorePackagesResult = await runAutobanRemediationMutationRef<{
    restoredCount?: number;
    scheduled?: boolean;
  }>(
    ctx,
    autobanRemediationInternalRefs.packages.restoreOwnedPackagesForAutobanRemediationBatchInternal,
    {
      actorUserId: args.actor._id,
      ownerUserId: args.target._id,
      bannedAt,
      cursor: undefined,
    },
  );
  const restoredSkills = restoreSkillsResult.restoredCount ?? 0;
  const restoredPackages = restorePackagesResult.restoredCount ?? 0;
  await ctx.db.insert("auditLogs", {
    actorUserId: args.actor._id,
    action: "user.autoban_remediation",
    targetType: "user",
    targetId: args.target._id,
    metadata: {
      reason: args.reason,
      bannedAt,
      triggers,
      decision: "unbanned",
      restoredSkills,
      restoredPackages,
    },
    createdAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: args.actor._id,
    action: "user.unban",
    targetType: "user",
    targetId: args.target._id,
    metadata: {
      reason: args.reason,
      source: "autoban.remediation",
      restoredSkills,
      restoredPackages,
    },
    createdAt: now,
  });

  return buildAutobanRemediationItem(args.target, {
    decision: "unbanned",
    triggers,
    restoredSkills,
    restoredPackages,
    scheduledSkills: Boolean(restoreSkillsResult.scheduled),
    scheduledPackages: Boolean(restorePackagesResult.scheduled),
  });
}

async function evaluateAutobanTrigger(
  ctx: MutationCtx,
  target: Doc<"users">,
  metadata: unknown,
  dryRun: boolean,
): Promise<AutobanRemediationTrigger> {
  const record =
    metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const slug = typeof record.slug === "string" ? record.slug.trim() : "";
  const packageName =
    typeof record.packageName === "string"
      ? record.packageName.trim()
      : typeof record.name === "string"
        ? record.name.trim()
        : "";
  const sha256hash = typeof record.sha256hash === "string" ? record.sha256hash.trim() : "";
  const trigger = typeof record.trigger === "string" ? record.trigger.trim() : "";
  const artifactName = slug || packageName;
  if (!artifactName) {
    return {
      slug: null,
      sha256hash: sha256hash || null,
      trigger: trigger || null,
      artifactKind: "unknown",
      artifactId: null,
      verdict: null,
      reason: null,
      reasonCodes: [],
    };
  }

  const skill = await ctx.db
    .query("skills")
    .withIndex("by_slug", (q) => q.eq("slug", artifactName))
    .unique();
  if (!skill || skill.ownerUserId !== target._id) {
    const pkg = await ctx.db
      .query("packages")
      .withIndex("by_name", (q) => q.eq("normalizedName", artifactName.toLowerCase()))
      .unique();
    if (pkg && pkg.ownerUserId === target._id) {
      return {
        slug: pkg.name,
        sha256hash: sha256hash || null,
        trigger: trigger || null,
        artifactKind: "package",
        artifactId: pkg._id,
        verdict: pkg.scanStatus ?? null,
        reason: "package.scanStatus",
        reasonCodes: [`package.${pkg.scanStatus}`],
      };
    }

    return {
      slug: artifactName,
      sha256hash: sha256hash || null,
      trigger: trigger || null,
      artifactKind: "unknown",
      artifactId: null,
      verdict: null,
      reason: null,
      reasonCodes: [],
    };
  }

  const preview = await runAutobanRemediationQueryRef<{
    verdict?: string;
    reason?: string;
    reasonCodes?: string[];
    skipped?: string;
  }>(ctx, autobanRemediationInternalRefs.skills.previewLatestSkillModerationInternal, {
    skillId: skill._id,
  });
  if (preview.skipped) {
    return {
      slug: artifactName,
      sha256hash: sha256hash || null,
      trigger: trigger || null,
      artifactKind: "skill",
      artifactId: skill._id,
      verdict: null,
      reason: preview.skipped,
      reasonCodes: [],
    };
  }
  if (!dryRun && preview.verdict !== "malicious") {
    await runAutobanRemediationMutationRef(
      ctx,
      autobanRemediationInternalRefs.skills.recomputeLatestSkillModerationInternal,
      {
        skillId: skill._id,
      },
    );
  }

  return {
    slug: artifactName,
    sha256hash: sha256hash || null,
    trigger: trigger || null,
    artifactKind: "skill",
    artifactId: skill._id,
    verdict: preview.verdict ?? "clean",
    reason: preview.reason ?? null,
    reasonCodes: preview.reasonCodes ?? [],
  };
}

async function countAutobanRemediationRestores(
  ctx: MutationCtx,
  ownerUserId: Id<"users">,
  bannedAt: number,
  triggers: AutobanRemediationTrigger[] = [],
) {
  const previewRestorableSkillIds = triggers
    .filter(
      (trigger) =>
        trigger.artifactKind === "skill" &&
        trigger.artifactId &&
        isResolvedNonMaliciousTrigger(trigger),
    )
    .map((trigger) => trigger.artifactId as Id<"skills">);
  const [skills, packages] = await Promise.all([
    countRestorableAutobanSkills(ctx, ownerUserId, bannedAt, previewRestorableSkillIds),
    countRestorableAutobanPackages(ctx, ownerUserId, bannedAt),
  ]);

  return { skills, packages };
}

async function countRestorableAutobanSkills(
  ctx: MutationCtx,
  ownerUserId: Id<"users">,
  bannedAt: number,
  previewRestorableSkillIds: Array<Id<"skills">>,
) {
  let count = 0;
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const result: AutobanRemediationCountPage = await runAutobanRemediationQueryRef(
      ctx,
      autobanRemediationInternalRefs.users.countRestorableAutobanSkillsPageInternal,
      {
        ownerUserId,
        bannedAt,
        previewRestorableSkillIds,
        cursor: cursor ?? undefined,
      },
    );
    count += result.count;
    isDone = result.isDone;
    cursor = result.continueCursor;
  }

  return count;
}

async function countRestorableAutobanPackages(
  ctx: MutationCtx,
  ownerUserId: Id<"users">,
  bannedAt: number,
) {
  let count = 0;
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const result: AutobanRemediationPackageCandidatePage = await runAutobanRemediationQueryRef(
      ctx,
      autobanRemediationInternalRefs.users.listRestorableAutobanPackageCandidatesPageInternal,
      {
        ownerUserId,
        bannedAt,
        cursor: cursor ?? undefined,
      },
    );
    for (const packageId of result.packageIds) {
      if (await hasRestorableAutobanPackageRelease(ctx, packageId, bannedAt)) count += 1;
    }
    isDone = result.isDone;
    cursor = result.continueCursor;
  }

  return count;
}

async function hasRestorableAutobanPackageRelease(
  ctx: Pick<MutationCtx, "runQuery">,
  packageId: Id<"packages">,
  bannedAt: number,
) {
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const result: AutobanRemediationPackageReleasePage = await runAutobanRemediationQueryRef(
      ctx,
      autobanRemediationInternalRefs.users.hasRestorableAutobanPackageReleasePageInternal,
      {
        packageId,
        bannedAt,
        cursor: cursor ?? undefined,
      },
    );
    if (result.hasRestorable) return true;
    isDone = result.isDone;
    cursor = result.continueCursor;
  }

  return false;
}

export const countRestorableAutobanSkillsPageInternal = internalQuery({
  args: {
    ownerUserId: v.id("users"),
    bannedAt: v.number(),
    previewRestorableSkillIds: v.array(v.id("skills")),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const previewRestorableSkillIds = new Set(args.previewRestorableSkillIds);
    const result = await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.ownerUserId))
      .order("desc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: AUTOBAN_REMEDIATION_COUNT_PAGE_SIZE,
      });

    return {
      count: result.page.filter(
        (skill) =>
          isRestorableAutobanSkill(skill, args.bannedAt) ||
          (skill.softDeletedAt === args.bannedAt && previewRestorableSkillIds.has(skill._id)),
      ).length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listRestorableAutobanPackageCandidatesPageInternal = internalQuery({
  args: {
    ownerUserId: v.id("users"),
    bannedAt: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("packages")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.ownerUserId))
      .order("desc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: AUTOBAN_REMEDIATION_COUNT_PAGE_SIZE,
      });

    return {
      packageIds: result.page
        .filter((pkg) => pkg.softDeletedAt === args.bannedAt && pkg.scanStatus !== "malicious")
        .map((pkg) => pkg._id),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const hasRestorableAutobanPackageReleasePageInternal = internalQuery({
  args: {
    packageId: v.id("packages"),
    bannedAt: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("packageReleases")
      .withIndex("by_package", (q) => q.eq("packageId", args.packageId))
      .paginate({
        cursor: args.cursor ?? null,
        numItems: AUTOBAN_REMEDIATION_COUNT_PAGE_SIZE,
      });

    return {
      hasRestorable: result.page.some((release) => {
        const wouldBeActive = !release.softDeletedAt || release.softDeletedAt === args.bannedAt;
        return wouldBeActive && resolvePackageReleaseScanStatus(release) !== "malicious";
      }),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

function isRestorableAutobanSkill(skill: Doc<"skills">, bannedAt: number) {
  if (skill.softDeletedAt !== bannedAt) return false;
  const existingFlags = skill.moderationFlags ?? [];
  const reasonCodes = skill.moderationReasonCodes ?? [];
  const isStillMalicious =
    skill.moderationVerdict === "malicious" || existingFlags.includes("blocked.malware");
  const hasFreshCleanVerdict =
    skill.moderationVerdict === "clean" && (skill.moderationEvaluatedAt ?? 0) >= bannedAt;
  const hasStaleVtMalwareFlag = existingFlags.includes("blocked.malware") && reasonCodes.length > 0;
  return !isStillMalicious || (hasStaleVtMalwareFlag && hasFreshCleanVerdict);
}

function isNonMaliciousTriggerVerdict(verdict: string | null) {
  return verdict === "clean" || verdict === "suspicious" || verdict === "review";
}

function isPendingTriggerReason(reason: string | null) {
  const normalized = reason?.trim().toLowerCase();
  return (
    normalized === "pending.scan" ||
    normalized === "pending.scan.stale" ||
    normalized === "scanner.vt.pending" ||
    normalized === "scanner.llm.pending"
  );
}

function isResolvedNonMaliciousTrigger(
  trigger: Pick<AutobanRemediationTrigger, "verdict" | "reason">,
) {
  return isNonMaliciousTriggerVerdict(trigger.verdict) && !isPendingTriggerReason(trigger.reason);
}

function buildAutobanRemediationItem(
  user: Doc<"users">,
  fields: {
    decision: string;
    skipReason?: string;
    triggers: AutobanRemediationTrigger[];
    restoredSkills?: number;
    restoredPackages?: number;
    scheduledSkills?: boolean;
    scheduledPackages?: boolean;
  },
) {
  return {
    userId: user._id,
    handle: user.handle ?? null,
    bannedAt: user.deletedAt ?? null,
    decision: fields.decision,
    skipReason: fields.skipReason,
    triggers: fields.triggers,
    restoredSkills: fields.restoredSkills ?? 0,
    restoredPackages: fields.restoredPackages ?? 0,
    scheduledSkills: fields.scheduledSkills,
    scheduledPackages: fields.scheduledPackages,
  };
}

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

// ---------------------------------------------------------------------------
// Moderation hold management
// ---------------------------------------------------------------------------

/**
 * Admin-only: lift the moderation hold placed on a user after a false-positive
 * malicious upload detection.
 *
 * When the static scanner flags a skill as malicious, the publisher is placed
 * under a moderation hold (`requiresModerationAt` set). This hides all their
 * skills and causes all future publishes to start hidden. The hold has no
 * self-service release path -- only an admin can lift it.
 *
 * This mutation:
 * 1. Clears `requiresModerationAt` and `requiresModerationReason` on the user
 * 2. Restores skills that were hidden due to the moderation hold
 * 3. Creates an audit log entry
 */
export const liftModerationHold = mutation({
  args: {
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return liftModerationHoldWithActor(ctx, user, args.userId, args.reason);
  },
});

export const liftModerationHoldInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("User not found");
    return liftModerationHoldWithActor(ctx, actor, args.targetUserId, args.reason);
  },
});

async function liftModerationHoldWithActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  targetUserId: Id<"users">,
  reasonRaw?: string,
) {
  assertAdmin(actor);

  const target = await ctx.db.get(targetUserId);
  if (!target) throw new Error("User not found");
  if (target.deletedAt || target.deactivatedAt) {
    throw new Error("Cannot lift hold on a deleted or deactivated account");
  }
  if (!target.requiresModerationAt) {
    return { ok: true as const, alreadyCleared: true, restoredSkills: 0, scheduledSkills: false };
  }

  const reason = reasonRaw?.trim();
  if (reason && reason.length > 500) {
    throw new Error("Reason too long (max 500 chars)");
  }

  const holdPlacedAt = target.requiresModerationAt;
  const now = Date.now();

  // Clear the moderation hold on the user
  await ctx.db.patch(targetUserId, {
    requiresModerationAt: undefined,
    requiresModerationReason: undefined,
    updatedAt: now,
  });

  // Restore skills that were hidden due to the moderation hold.
  // The batch handler checks if the user has been re-held between pages
  // and aborts if so (race condition safety).
  const restoreResult = (await ctx.runMutation(
    internal.skills.restoreOwnedSkillsForModerationLiftBatchInternal,
    {
      ownerUserId: targetUserId,
      holdPlacedAt,
      cursor: undefined,
    },
  )) as { restoredCount?: number; scheduled?: boolean };
  const restoredCount = restoreResult.restoredCount ?? 0;
  const scheduledSkills = restoreResult.scheduled ?? false;

  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "user.moderation.lift",
    targetType: "user",
    targetId: targetUserId,
    metadata: {
      reason: reason || undefined,
      holdPlacedAt,
      restoredSkills: restoredCount,
    },
    createdAt: now,
  });

  return {
    ok: true as const,
    alreadyCleared: false,
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
 * Auto-ban a user whose skill was flagged malicious by a scanner.
 * Skips moderators/admins. No actor required — this is a system-level action.
 */
export const autobanMalwareAuthorInternal = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    sha256hash: v.optional(v.string()),
    slug: v.string(),
    trigger: v.optional(v.string()),
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

    const metadata: Record<string, unknown> = {
      trigger: args.trigger?.trim() || "scanner.malicious",
      slug: args.slug,
      hiddenSkills: hiddenCount,
      deletedSkillComments: deletedComments.skillComments,
      deletedSoulComments: deletedComments.soulComments,
    };
    if (args.sha256hash?.trim()) {
      metadata.sha256hash = args.sha256hash.trim();
    }

    // Audit log -- use the target as actor since there's no human actor
    await ctx.db.insert("auditLogs", {
      actorUserId: args.ownerUserId,
      action: "user.autoban.malware",
      targetType: "user",
      targetId: args.ownerUserId,
      metadata,
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
