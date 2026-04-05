import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { assertAdmin, requireUser } from "./lib/access";
import { toPublicPublisher } from "./lib/public";
import {
  ensurePersonalPublisherForUser,
  getActiveUserByHandleOrPersonalPublisher,
  getPublisherByHandle,
  getPublisherMembership,
  getPersonalPublisherForUserOrFallback,
  getPersonalPublisherForUser,
  isPublisherRoleAllowed,
  normalizePublisherHandle,
} from "./lib/publishers";

const PUBLISHER_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function validateHandle(rawHandle: string) {
  const handle = normalizePublisherHandle(rawHandle);
  if (!handle) throw new ConvexError("Handle is required");
  if (!PUBLISHER_HANDLE_PATTERN.test(handle)) {
    throw new ConvexError("Handle must be lowercase, url-safe, and 2-40 characters");
  }
  return handle;
}

async function getUserByHandle(ctx: Pick<MutationCtx, "db">, handle: string) {
  return await ctx.db
    .query("users")
    .withIndex("handle", (q) => q.eq("handle", handle))
    .unique();
}

function appendHandleSuffix(base: string, suffix: number) {
  const suffixText = suffix <= 1 ? "" : `-${suffix}`;
  const maxBaseLength = Math.max(2, 40 - suffixText.length);
  const trimmedBase = base.slice(0, maxBaseLength);
  return `${trimmedBase}${suffixText}`;
}

async function resolveAvailableUserHandle(
  ctx: Pick<MutationCtx, "db">,
  baseHandle: string,
  excludeUserId?: Id<"users">,
) {
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const candidate = appendHandleSuffix(baseHandle, suffix);
    if (!PUBLISHER_HANDLE_PATTERN.test(candidate)) continue;
    const existingUser = await getUserByHandle(ctx, candidate);
    if (existingUser && existingUser._id !== excludeUserId) continue;
    const existingPublisher = await getPublisherByHandle(ctx, candidate);
    if (
      existingPublisher &&
      !(existingPublisher.kind === "user" && existingPublisher.linkedUserId === excludeUserId)
    ) {
      continue;
    }
    return candidate;
  }
  throw new ConvexError(`Unable to find an available fallback handle for "@${baseHandle}"`);
}

async function migrateLegacyPublisherHandleToOrgWithActor(
  ctx: Pick<MutationCtx, "db">,
  args: {
    actorUserId: Id<"users">;
    handle: string;
    fallbackUserHandle?: string;
    displayName?: string;
  },
) {
  const actor = await ctx.db.get(args.actorUserId);
  if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
  assertAdmin(actor);

  const orgHandle = validateHandle(args.handle);
  const fallbackBase = validateHandle(args.fallbackUserHandle ?? `${orgHandle}-user`);
  const now = Date.now();

  const handlePublisher = await getPublisherByHandle(ctx, orgHandle);
  const legacyUser =
    (handlePublisher?.linkedUserId ? await ctx.db.get(handlePublisher.linkedUserId) : null) ??
    (await getUserByHandle(ctx, orgHandle));
  if (!legacyUser || legacyUser.deletedAt || legacyUser.deactivatedAt) {
    throw new ConvexError(`Legacy user "@${orgHandle}" not found`);
  }

  const personalPublisher = legacyUser.personalPublisherId
    ? await ctx.db.get(legacyUser.personalPublisherId)
    : await getPersonalPublisherForUser(ctx, legacyUser._id);
  const convertiblePublisher =
    handlePublisher?.kind === "user" && handlePublisher.linkedUserId === legacyUser._id
      ? handlePublisher
      : personalPublisher?.kind === "user" &&
          personalPublisher.linkedUserId === legacyUser._id &&
          personalPublisher.handle === orgHandle
        ? personalPublisher
        : null;

  const fallbackHandle = await resolveAvailableUserHandle(ctx, fallbackBase, legacyUser._id);
  let nextLegacyUser: Doc<"users"> = legacyUser;
  const needsDetachedPersonalPublisher = Boolean(
    convertiblePublisher && legacyUser.personalPublisherId === convertiblePublisher._id,
  );
  if (legacyUser.handle === orgHandle || needsDetachedPersonalPublisher) {
    const userPatch: Partial<Doc<"users">> = {
      updatedAt: now,
    };
    if (legacyUser.handle === orgHandle) {
      userPatch.handle = fallbackHandle;
    }
    if (needsDetachedPersonalPublisher) {
      userPatch.personalPublisherId = undefined;
    }
    await ctx.db.patch(legacyUser._id, userPatch);
    nextLegacyUser = {
      ...legacyUser,
      ...userPatch,
    };
  }

  let orgPublisherId: Id<"publishers">;
  let convertedExistingPublisher = false;
  if (handlePublisher?.kind === "org") {
    orgPublisherId = handlePublisher._id;
    if (args.displayName?.trim() && handlePublisher.displayName !== args.displayName.trim()) {
      await ctx.db.patch(handlePublisher._id, {
        displayName: args.displayName.trim(),
        updatedAt: now,
      });
    }
  } else if (convertiblePublisher) {
    orgPublisherId = convertiblePublisher._id;
    convertedExistingPublisher = true;
    await ctx.db.patch(convertiblePublisher._id, {
      kind: "org",
      handle: orgHandle,
      displayName: args.displayName?.trim() || convertiblePublisher.displayName,
      linkedUserId: undefined,
      trustedPublisher: convertiblePublisher.trustedPublisher ?? legacyUser.trustedPublisher,
      updatedAt: now,
    });
  } else {
    orgPublisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle: orgHandle,
      displayName: args.displayName?.trim() || legacyUser.displayName?.trim() || orgHandle,
      bio: undefined,
      image: undefined,
      linkedUserId: undefined,
      trustedPublisher: legacyUser.trustedPublisher,
      createdAt: now,
      updatedAt: now,
    });
  }

  const membership = await getPublisherMembership(ctx, orgPublisherId, legacyUser._id);
  if (membership) {
    if (membership.role !== "owner") {
      await ctx.db.patch(membership._id, { role: "owner", updatedAt: now });
    }
  } else {
    await ctx.db.insert("publisherMembers", {
      publisherId: orgPublisherId,
      userId: legacyUser._id,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });
  }

  const ensuredPersonalPublisher = await ensurePersonalPublisherForUser(ctx, nextLegacyUser);

  const packages = await ctx.db
    .query("packages")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", legacyUser._id))
    .collect();
  let packagesMigrated = 0;
  for (const pkg of packages) {
    if (pkg.ownerPublisherId === orgPublisherId) continue;
    await ctx.db.patch(pkg._id, {
      ownerPublisherId: orgPublisherId,
      updatedAt: now,
    });
    packagesMigrated += 1;
  }

  await ctx.db.insert("auditLogs", {
    actorUserId: args.actorUserId,
    action: "publisher.legacy_handle.migrate",
    targetType: "publisher",
    targetId: orgPublisherId,
    metadata: {
      handle: orgHandle,
      legacyUserId: legacyUser._id,
      fallbackUserHandle: nextLegacyUser.handle ?? fallbackHandle,
      convertedExistingPublisher,
      packagesMigrated,
      personalPublisherId: ensuredPersonalPublisher?._id ?? null,
    },
    createdAt: now,
  });

  return {
    ok: true as const,
    handle: orgHandle,
    orgPublisherId,
    legacyUserId: legacyUser._id,
    fallbackUserHandle: nextLegacyUser.handle ?? fallbackHandle,
    personalPublisherId: ensuredPersonalPublisher?._id ?? null,
    convertedExistingPublisher,
    packagesMigrated,
  };
}

async function ensureOrgPublisherHandleWithActor(
  ctx: Pick<MutationCtx, "db">,
  args: {
    actorUserId: Id<"users">;
    handle: string;
    fallbackUserHandle?: string;
    displayName?: string;
    trusted?: boolean;
  },
) {
  const actor = await ctx.db.get(args.actorUserId);
  if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
  assertAdmin(actor);

  const handle = validateHandle(args.handle);
  const now = Date.now();
  const existingPublisher = await getPublisherByHandle(ctx, handle);
  const existingUser = await getUserByHandle(ctx, handle);

  if (existingPublisher?.kind === "org") {
    await ctx.db.patch(existingPublisher._id, {
      displayName: args.displayName?.trim() || existingPublisher.displayName,
      trustedPublisher: args.trusted ?? existingPublisher.trustedPublisher,
      updatedAt: now,
    });
    const membership = await getPublisherMembership(ctx, existingPublisher._id, args.actorUserId);
    if (!membership) {
      await ctx.db.insert("publisherMembers", {
        publisherId: existingPublisher._id,
        userId: args.actorUserId,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      });
    }
    return {
      ok: true as const,
      publisherId: existingPublisher._id,
      handle,
      created: false,
      migrated: false,
      trusted: args.trusted ?? existingPublisher.trustedPublisher ?? false,
    };
  }

  if (existingPublisher || existingUser) {
    const result = await migrateLegacyPublisherHandleToOrgWithActor(ctx, {
      actorUserId: args.actorUserId,
      handle,
      fallbackUserHandle: args.fallbackUserHandle,
      displayName: args.displayName,
    });
    if (typeof args.trusted === "boolean") {
      await ctx.db.patch(result.orgPublisherId, {
        trustedPublisher: args.trusted,
        updatedAt: now,
      });
    }
    return {
      ok: true as const,
      publisherId: result.orgPublisherId,
      handle,
      created: false,
      migrated: true,
      trusted: args.trusted ?? existingPublisher?.trustedPublisher ?? false,
    };
  }

  const publisherId = await ctx.db.insert("publishers", {
    kind: "org",
    handle,
    displayName: args.displayName?.trim() || handle,
    bio: undefined,
    image: undefined,
    linkedUserId: undefined,
    trustedPublisher: args.trusted || undefined,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("publisherMembers", {
    publisherId,
    userId: args.actorUserId,
    role: "owner",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: args.actorUserId,
    action: "publisher.org.ensure",
    targetType: "publisher",
    targetId: publisherId,
    metadata: {
      handle,
      trusted: args.trusted === true,
    },
    createdAt: now,
  });
  return {
    ok: true as const,
    publisherId,
    handle,
    created: true,
    migrated: false,
    trusted: args.trusted ?? false,
  };
}

export const getByIdInternal = internalQuery({
  args: { publisherId: v.id("publishers") },
  handler: async (ctx, args) => await ctx.db.get(args.publisherId),
});

export const getByHandleInternal = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, args) => await getPublisherByHandle(ctx, args.handle),
});

export const getMemberRoleInternal = internalQuery({
  args: {
    publisherId: v.id("publishers"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) =>
    (await getPublisherMembership(ctx, args.publisherId, args.userId))?.role ?? null,
});

export const ensurePersonalPublisherInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.deletedAt || user.deactivatedAt) return null;
    return await ensurePersonalPublisherForUser(ctx, user);
  },
});

export const resolvePublishTargetForUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    ownerHandle: v.optional(v.string()),
    minimumRole: v.optional(
      v.union(v.literal("owner"), v.literal("admin"), v.literal("publisher")),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    const minimumRole = args.minimumRole ?? "publisher";
    const requestedHandle = normalizePublisherHandle(args.ownerHandle);
    const personal = await ensurePersonalPublisherForUser(ctx, actor);
    if (!personal) throw new ConvexError("Personal publisher not found");
    if (!requestedHandle) {
      return {
        publisherId: personal._id,
        handle: personal.handle,
        kind: personal.kind,
        linkedUserId: personal.linkedUserId,
      };
    }

    if (personal && requestedHandle === personal.handle) {
      return {
        publisherId: personal._id,
        handle: personal.handle,
        kind: personal.kind,
        linkedUserId: personal.linkedUserId,
      };
    }

    const publisher = await getPublisherByHandle(ctx, requestedHandle);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError(`Publisher "@${requestedHandle}" not found`);
    }
    const membership = await getPublisherMembership(ctx, publisher._id, actor._id);
    if (!membership || !isPublisherRoleAllowed(membership.role, [minimumRole])) {
      throw new ConvexError(`Forbidden for "@${requestedHandle}"`);
    }
    return {
      publisherId: publisher._id,
      handle: publisher.handle,
      kind: publisher.kind,
      linkedUserId: publisher.linkedUserId,
    };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const user = await ctx.db.get(userId);
    if (!user || user.deletedAt || user.deactivatedAt) return [];
    const memberships = await ctx.db
      .query("publisherMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const publishers = await Promise.all(
      memberships.map(async (membership) => {
        const publisher = await ctx.db.get(membership.publisherId);
        const publicPublisher = toPublicPublisher(publisher);
        if (!publicPublisher) return null;
        return {
          publisher: publicPublisher,
          role: membership.role,
        };
      }),
    );
    const visiblePublishers = publishers.filter(
      (
        item,
      ): item is {
        publisher: NonNullable<ReturnType<typeof toPublicPublisher>>;
        role: Doc<"publisherMembers">["role"];
      } => Boolean(item),
    );
    const personalPublisher = toPublicPublisher(
      await getPersonalPublisherForUserOrFallback(ctx, user),
    );
    if (
      personalPublisher &&
      !visiblePublishers.some((entry) => entry.publisher._id === personalPublisher._id)
    ) {
      visiblePublishers.unshift({
        publisher: personalPublisher,
        role: "owner",
      });
    }
    return visiblePublishers;
  },
});

export const getByHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => toPublicPublisher(await getPublisherByHandle(ctx, args.handle)),
});

export const listMembers = query({
  args: { publisherHandle: v.string() },
  handler: async (ctx, args) => {
    const publisher = await getPublisherByHandle(ctx, args.publisherHandle);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return null;
    const memberships = await ctx.db
      .query("publisherMembers")
      .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
      .collect();
    const items = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db.get(membership.userId);
        if (!user || user.deletedAt || user.deactivatedAt) return null;
        return {
          role: membership.role,
          user: {
            _id: user._id,
            handle: user.handle ?? null,
            displayName: user.displayName ?? user.name ?? null,
            image: user.image ?? null,
          },
        };
      }),
    );
    return {
      publisher: toPublicPublisher(publisher),
      members: items.filter(Boolean),
    };
  },
});

export const createOrg = mutation({
  args: {
    handle: v.string(),
    displayName: v.string(),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, userId } = await requireUser(ctx);
    await ensurePersonalPublisherForUser(ctx, user);

    const handle = validateHandle(args.handle);
    const existingPublisher = await getPublisherByHandle(ctx, handle);
    if (existingPublisher) throw new ConvexError(`Publisher "@${handle}" already exists`);

    const existingUser = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", handle))
      .unique();
    if (existingUser && existingUser._id !== userId) {
      throw new ConvexError(`Handle "@${handle}" is already claimed`);
    }

    const now = Date.now();
    const publisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle,
      displayName: args.displayName.trim() || handle,
      bio: args.bio?.trim() || undefined,
      image: undefined,
      linkedUserId: undefined,
      trustedPublisher: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("publisherMembers", {
      publisherId,
      userId,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "publisher.create",
      targetType: "publisher",
      targetId: publisherId,
      metadata: { kind: "org", handle },
      createdAt: now,
    });
    return {
      publisher: toPublicPublisher(await ctx.db.get(publisherId)),
      role: "owner" as const,
    };
  },
});

export const migrateLegacyPublisherHandleToOrg = mutation({
  args: {
    handle: v.string(),
    fallbackUserHandle: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await migrateLegacyPublisherHandleToOrgWithActor(ctx, {
      actorUserId: userId,
      ...args,
    });
  },
});

export const ensureOrgPublisherHandleInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    fallbackUserHandle: v.optional(v.string()),
    displayName: v.optional(v.string()),
    trusted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => await ensureOrgPublisherHandleWithActor(ctx, args),
});

export const addMember = mutation({
  args: {
    publisherId: v.id("publishers"),
    userHandle: v.string(),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("publisher")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const publisher = await ctx.db.get(args.publisherId);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError("Publisher not found");
    }
    const membership = await getPublisherMembership(ctx, publisher._id, userId);
    if (!membership || !isPublisherRoleAllowed(membership.role, ["admin"])) {
      throw new ConvexError("Forbidden");
    }
    if (args.role === "owner" && membership.role !== "owner") {
      throw new ConvexError("Only org owners can promote members to owner");
    }
    const handle = normalizePublisherHandle(args.userHandle);
    if (!handle) throw new ConvexError("User handle is required");
    const targetUser = await getActiveUserByHandleOrPersonalPublisher(ctx, handle);
    if (!targetUser) {
      throw new ConvexError(`User "@${handle}" not found`);
    }
    await ensurePersonalPublisherForUser(ctx, targetUser);
    const existing = await getPublisherMembership(ctx, publisher._id, targetUser._id);
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { role: args.role, updatedAt: now });
    } else {
      await ctx.db.insert("publisherMembers", {
        publisherId: publisher._id,
        userId: targetUser._id,
        role: args.role,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "publisher.member.upsert",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: {
        memberUserId: targetUser._id,
        memberHandle: targetUser.handle ?? handle,
        role: args.role,
      },
      createdAt: now,
    });
    return { ok: true };
  },
});

export const removeMember = mutation({
  args: {
    publisherId: v.id("publishers"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const publisher = await ctx.db.get(args.publisherId);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError("Publisher not found");
    }
    const actorMembership = await getPublisherMembership(ctx, publisher._id, userId);
    if (!actorMembership || !isPublisherRoleAllowed(actorMembership.role, ["admin"])) {
      throw new ConvexError("Forbidden");
    }
    const targetMembership = await getPublisherMembership(ctx, publisher._id, args.userId);
    if (!targetMembership) return { ok: true };
    if (targetMembership.role === "owner" && actorMembership.role !== "owner") {
      throw new ConvexError("Only org owners can remove other owners");
    }
    if (targetMembership.role === "owner") {
      const members = await ctx.db
        .query("publisherMembers")
        .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
        .collect();
      const remainingOwners = members.filter(
        (member) => member.role === "owner" && member.userId !== args.userId,
      );
      if (remainingOwners.length === 0) {
        throw new ConvexError("Publisher must have at least one owner");
      }
    }
    await ctx.db.delete(targetMembership._id);
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "publisher.member.remove",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: { memberUserId: args.userId },
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

export const setTrustedPublisherInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    publisherId: v.id("publishers"),
    trustedPublisher: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertAdmin(actor);
    await ctx.db.patch(args.publisherId, {
      trustedPublisher: args.trustedPublisher,
      updatedAt: Date.now(),
    });
  },
});

export const migrateLegacyPublisherHandleToOrgInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    fallbackUserHandle: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => await migrateLegacyPublisherHandleToOrgWithActor(ctx, args),
});
