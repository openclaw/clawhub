import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isReservedPublicOwnerHandle } from "./publicRouteReservations";

export type PublisherRole = "owner" | "admin" | "publisher";

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

export type PublicPublisherVisibility = {
  publisher: Doc<"publishers">;
  linkedUser: Doc<"users"> | null;
};

export const PUBLISHER_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/;
export const PUBLISHER_HANDLE_REQUIREMENTS_MESSAGE =
  "Handle must be 40 characters or fewer, start and end with a lowercase letter or number, and use only lowercase letters, numbers, hyphens, dots, or underscores";

type PersonalPublisherAuditOptions = {
  actorUserId?: Id<"users">;
  source: string;
};

type EnsurePersonalPublisherOptions = {
  handleConflict?: "throw" | "skip";
};

function isMissingPublisherTableError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    /unexpected (query |insert )?table:? (publishers|publishermembers)/i.test(error.message) ||
    /innerdb\.(insert|patch) is not a function/i.test(error.message)
  );
}

function normalizeGeneratedPublisherHandle(handle: string | undefined | null) {
  const normalized = normalizePublisherHandle(handle);
  const sanitized = normalized
    ?.replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (!sanitized) return undefined;
  if (!isReservedPublicOwnerHandle(sanitized)) return sanitized;
  return `${sanitized.slice(0, 38)}-2`;
}

export function derivePersonalPublisherHandle(user: Doc<"users">) {
  const emailLocalPart = user.email?.split("@")[0];
  const userIdSuffix = String(user._id).split(":").pop();
  return (
    normalizeGeneratedPublisherHandle(user.handle ?? user.name ?? emailLocalPart ?? userIdSuffix) ??
    "user"
  );
}

function synthesizePersonalPublisher(
  user: Doc<"users">,
  handleOverride?: string,
): Doc<"publishers"> {
  const handle = handleOverride ?? derivePersonalPublisherHandle(user);
  const now = user.updatedAt ?? user.createdAt ?? user._creationTime;
  const displayName = user.displayName?.trim() || user.name?.trim() || handle;
  const bio = user.bio?.trim() || undefined;
  return {
    _id: (user.personalPublisherId ??
      (`publishers:${handle}` as Id<"publishers">)) as Id<"publishers">,
    _creationTime: user._creationTime,
    kind: "user",
    handle,
    displayName,
    bio,
    image: user.image,
    linkedUserId: user._id,
    trustedPublisher: user.trustedPublisher,
    createdAt: user.createdAt ?? now,
    updatedAt: now,
    deletedAt: undefined,
    deactivatedAt: undefined,
  };
}

export async function getPersonalPublisherForUserOrFallback(ctx: DbCtx, user: Doc<"users">) {
  if (user.personalPublisherId) {
    const publisher = await ctx.db.get(user.personalPublisherId);
    if (isPublisherActive(publisher)) return publisher;
  }
  try {
    const publisher = await getPersonalPublisherForUser(ctx, user._id);
    if (isPublisherActive(publisher)) return publisher;
  } catch (error) {
    if (!isMissingPublisherTableError(error)) throw error;
  }
  return synthesizePersonalPublisher(user);
}

export function normalizePublisherHandle(handle: string | undefined | null) {
  const normalized = handle?.trim().replace(/^@+/, "").toLowerCase();
  return normalized ? normalized : undefined;
}

export function isReservedOpenClawPublisherHandle(handle: string | undefined | null) {
  return Boolean(normalizePublisherHandle(handle)?.includes("openclaw"));
}

export function assertPublisherHandleAllowed(handle: string) {
  if (isReservedOpenClawPublisherHandle(handle)) {
    throw new ConvexError(formatReservedOpenClawPublisherHandleMessage(handle));
  }
}

export function formatReservedOpenClawPublisherHandleMessage(handle: string) {
  return `Handle "@${handle}" is reserved for OpenClaw publishers`;
}

export function isPublisherActive(
  publisher: Pick<Doc<"publishers">, "deletedAt" | "deactivatedAt"> | null | undefined,
): publisher is Doc<"publishers"> {
  return Boolean(publisher && !publisher.deletedAt && !publisher.deactivatedAt);
}

export function isPublisherRoleAllowed(role: PublisherRole, allowed: PublisherRole[]) {
  const ranks: Record<PublisherRole, number> = {
    publisher: 1,
    admin: 2,
    owner: 3,
  };
  return allowed.some((candidate) => ranks[role] >= ranks[candidate]);
}

export type OwnedResourceActor = {
  _id: Id<"users">;
  role?: Doc<"users">["role"];
};

export async function assertCanManageOwnedResource(
  ctx: DbCtx,
  params: {
    actor: OwnedResourceActor;
    ownerUserId: Id<"users">;
    ownerPublisherId?: Id<"publishers"> | null;
    allowedPublisherRoles?: PublisherRole[];
    allowPlatformAdmin?: boolean;
    allowPlatformModerator?: boolean;
  },
) {
  if (
    params.allowPlatformModerator &&
    (params.actor.role === "admin" || params.actor.role === "moderator")
  ) {
    return;
  }
  if (params.allowPlatformAdmin && params.actor.role === "admin") return;
  if (!params.ownerPublisherId) {
    if (params.ownerUserId === params.actor._id) return;
    throw new ConvexError("Forbidden");
  }

  const publisher = await ctx.db.get(params.ownerPublisherId);
  if (publisher?.kind === "user") {
    if (publisher.linkedUserId) {
      if (publisher.linkedUserId === params.actor._id) return;
      throw new ConvexError("Forbidden");
    }
    // Compatibility for legacy personal publishers created before linkedUserId.
    // Only fall back to resource ownership while the publisher has no link.
    if (params.ownerUserId === params.actor._id) return;
    throw new ConvexError("Forbidden");
  }

  const membership = await getPublisherMembership(ctx, params.ownerPublisherId, params.actor._id);
  if (
    !membership ||
    !isPublisherRoleAllowed(membership.role, params.allowedPublisherRoles ?? ["admin"])
  ) {
    throw new ConvexError("Forbidden");
  }
}

export async function getPublisherByHandle(ctx: DbCtx, handle: string | undefined | null) {
  const normalized = normalizePublisherHandle(handle);
  if (!normalized) return null;
  try {
    return await ctx.db
      .query("publishers")
      .withIndex("by_handle", (q) => q.eq("handle", normalized))
      .unique();
  } catch (error) {
    if (isMissingPublisherTableError(error)) return null;
    throw error;
  }
}

export async function getUserByHandleOrPersonalPublisher(
  ctx: DbCtx,
  handle: string | undefined | null,
) {
  const normalized = normalizePublisherHandle(handle);
  if (!normalized) return null;

  const user = await ctx.db
    .query("users")
    .withIndex("handle", (q) => q.eq("handle", normalized))
    .unique();
  if (user) return user;

  const publisher = await getPublisherByHandle(ctx, normalized);
  if (
    !publisher ||
    !isPublisherActive(publisher) ||
    publisher.kind !== "user" ||
    !publisher.linkedUserId
  ) {
    return null;
  }

  return await ctx.db.get(publisher.linkedUserId);
}

export async function getActiveUserByHandleOrPersonalPublisher(
  ctx: DbCtx,
  handle: string | undefined | null,
) {
  const user = await getUserByHandleOrPersonalPublisher(ctx, handle);
  if (!user || user.deletedAt || user.deactivatedAt) return null;
  return user;
}

export async function getPersonalPublisherForUser(ctx: DbCtx, userId: Id<"users">) {
  try {
    return await ctx.db
      .query("publishers")
      .withIndex("by_linked_user", (q) => q.eq("linkedUserId", userId))
      .unique();
  } catch (error) {
    if (isMissingPublisherTableError(error)) return null;
    throw error;
  }
}

async function getLegacyPersonalPublisherOwner(
  ctx: Pick<QueryCtx, "db">,
  publisherId: Id<"publishers">,
) {
  const memberships = await ctx.db
    .query("publisherMembers")
    .withIndex("by_publisher", (q) => q.eq("publisherId", publisherId))
    .collect();
  for (const membership of memberships) {
    if (membership.role !== "owner") continue;
    const user = await ctx.db.get(membership.userId);
    if (user && !user.deletedAt && !user.deactivatedAt) return user;
  }
  return null;
}

export async function getPublicPublisherVisibility(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  publisher: Doc<"publishers"> | null | undefined,
): Promise<PublicPublisherVisibility | null> {
  if (!isPublisherActive(publisher)) return null;
  if (publisher.kind !== "user") return { publisher, linkedUser: null };

  if (!publisher.linkedUserId) {
    const legacyOwner = await getLegacyPersonalPublisherOwner(ctx, publisher._id);
    return legacyOwner ? { publisher, linkedUser: legacyOwner } : null;
  }

  const linkedUser = await ctx.db.get(publisher.linkedUserId);
  if (!linkedUser || linkedUser.deletedAt || linkedUser.deactivatedAt) return null;
  return { publisher, linkedUser };
}

export async function ensurePersonalPublisherForUser(
  ctx: Pick<MutationCtx, "db">,
  user: Doc<"users">,
  audit?: PersonalPublisherAuditOptions,
  options?: EnsurePersonalPublisherOptions,
) {
  const handle = derivePersonalPublisherHandle(user);
  let existing: Doc<"publishers"> | null = null;
  try {
    existing = user.personalPublisherId
      ? await ctx.db.get(user.personalPublisherId)
      : await getPersonalPublisherForUser(ctx, user._id);
  } catch (error) {
    if (!isMissingPublisherTableError(error)) throw error;
    return synthesizePersonalPublisher(user);
  }
  if (isReservedOpenClawPublisherHandle(handle)) {
    if (options?.handleConflict === "skip") {
      return existing && isPublisherActive(existing)
        ? existing
        : synthesizePersonalPublisher(user, "user");
    }
    throw new ConvexError(formatReservedOpenClawPublisherHandleMessage(handle));
  }
  if (existing && isPublisherActive(existing)) {
    const existingPublisher = existing;
    const now = Date.now();
    const displayName = user.displayName?.trim() || user.name?.trim() || handle;
    const bio = user.bio?.trim() || undefined;
    const conflict = await getPublisherByHandle(ctx, handle);
    if (conflict && conflict._id !== existingPublisher._id) {
      if (options?.handleConflict === "skip") return existingPublisher;
      throw new ConvexError(`Publisher handle "@${handle}" is already claimed`);
    }
    const nextPublisherFields = {
      handle,
      displayName,
      bio,
      image: user.image,
      linkedUserId: user._id,
      trustedPublisher: user.trustedPublisher,
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const changedFields = getChangedPersonalPublisherFields(existingPublisher, nextPublisherFields);
    const personalPublisherLinked = user.personalPublisherId !== existingPublisher._id;
    try {
      await ctx.db.patch(existingPublisher._id, {
        ...nextPublisherFields,
        updatedAt: now,
      });
      if (user.personalPublisherId !== existingPublisher._id) {
        await ctx.db.patch(user._id, {
          personalPublisherId: existingPublisher._id,
          updatedAt: now,
        });
      }
      const existingMember = await ctx.db
        .query("publisherMembers")
        .withIndex("by_publisher_user", (q) =>
          q.eq("publisherId", existingPublisher._id).eq("userId", user._id),
        )
        .unique();
      if (!existingMember) {
        await ctx.db.insert("publisherMembers", {
          publisherId: existingPublisher._id,
          userId: user._id,
          role: "owner",
          createdAt: now,
          updatedAt: now,
        });
      }
      await insertPersonalPublisherAuditLog(ctx, {
        audit,
        publisherId: existingPublisher._id,
        user,
        created: false,
        source: audit?.source,
        changedFields,
        personalPublisherLinked,
        memberCreated: !existingMember,
        previous: existingPublisher,
        next: { ...existingPublisher, ...nextPublisherFields, updatedAt: now },
        now,
      });
      return await ctx.db.get(existingPublisher._id);
    } catch (error) {
      if (isMissingPublisherTableError(error)) return synthesizePersonalPublisher(user);
      throw error;
    }
  }

  const conflict = await getPublisherByHandle(ctx, handle);
  if (conflict && conflict.linkedUserId !== user._id) {
    if (options?.handleConflict === "skip") return synthesizePersonalPublisher(user);
    throw new ConvexError(`Publisher handle "@${handle}" is already claimed`);
  }

  const now = Date.now();
  const displayName = user.displayName?.trim() || user.name?.trim() || handle;
  const bio = user.bio?.trim() || undefined;
  try {
    const nextPublisherFields = {
      kind: "user" as const,
      handle,
      displayName,
      bio,
      image: user.image,
      linkedUserId: user._id,
      trustedPublisher: user.trustedPublisher,
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const publisherId =
      conflict?._id ??
      (await ctx.db.insert("publishers", {
        ...nextPublisherFields,
        createdAt: now,
        updatedAt: now,
      }));

    const changedFields = conflict
      ? getChangedPersonalPublisherFields(conflict, nextPublisherFields)
      : ["handle", "displayName", "linkedUserId"];
    if (conflict) {
      await ctx.db.patch(conflict._id, {
        ...nextPublisherFields,
        deletedAt: undefined,
        deactivatedAt: undefined,
        updatedAt: now,
      });
    }

    const existingMember = await ctx.db
      .query("publisherMembers")
      .withIndex("by_publisher_user", (q) =>
        q.eq("publisherId", publisherId).eq("userId", user._id),
      )
      .unique();
    if (!existingMember) {
      await ctx.db.insert("publisherMembers", {
        publisherId,
        userId: user._id,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(user._id, {
      personalPublisherId: publisherId,
      updatedAt: now,
    });

    await insertPersonalPublisherAuditLog(ctx, {
      audit,
      publisherId,
      user,
      created: !conflict,
      source: audit?.source,
      changedFields,
      personalPublisherLinked: true,
      memberCreated: !existingMember,
      previous: conflict,
      next: {
        _id: publisherId,
        ...nextPublisherFields,
        createdAt: conflict?.createdAt ?? now,
        updatedAt: now,
      },
      now,
    });

    return await ctx.db.get(publisherId);
  } catch (error) {
    if (isMissingPublisherTableError(error)) return synthesizePersonalPublisher(user);
    throw error;
  }
}

function getChangedPersonalPublisherFields(
  existing: Partial<Doc<"publishers">>,
  next: {
    handle: string;
    displayName: string;
    bio?: string;
    image?: string;
    linkedUserId: Id<"users">;
    trustedPublisher?: boolean;
    deletedAt?: number;
    deactivatedAt?: number;
  },
) {
  const changed: string[] = [];
  if (existing.handle !== next.handle) changed.push("handle");
  if (existing.displayName !== next.displayName) changed.push("displayName");
  if ((existing.bio ?? undefined) !== (next.bio ?? undefined)) changed.push("bio");
  if ((existing.image ?? undefined) !== (next.image ?? undefined)) changed.push("image");
  if (existing.linkedUserId !== next.linkedUserId) changed.push("linkedUserId");
  if ((existing.trustedPublisher ?? undefined) !== (next.trustedPublisher ?? undefined)) {
    changed.push("trustedPublisher");
  }
  if ((existing.deletedAt ?? undefined) !== (next.deletedAt ?? undefined))
    changed.push("deletedAt");
  if ((existing.deactivatedAt ?? undefined) !== (next.deactivatedAt ?? undefined)) {
    changed.push("deactivatedAt");
  }
  return changed;
}

function publisherAuditSnapshot(publisher: Partial<Doc<"publishers">> | null | undefined) {
  if (!publisher) return null;
  return {
    handle: publisher.handle ?? null,
    displayName: publisher.displayName ?? null,
    bio: publisher.bio ?? null,
    image: publisher.image ?? null,
    linkedUserId: publisher.linkedUserId ?? null,
    trustedPublisher: publisher.trustedPublisher ?? null,
    deletedAt: publisher.deletedAt ?? null,
    deactivatedAt: publisher.deactivatedAt ?? null,
  };
}

async function insertPersonalPublisherAuditLog(
  ctx: Pick<MutationCtx, "db">,
  args: {
    audit?: PersonalPublisherAuditOptions;
    publisherId: Id<"publishers">;
    user: Doc<"users">;
    created: boolean;
    source?: string;
    changedFields: string[];
    personalPublisherLinked: boolean;
    memberCreated: boolean;
    previous: Partial<Doc<"publishers">> | null | undefined;
    next: Partial<Doc<"publishers">>;
    now: number;
  },
) {
  if (!args.audit?.actorUserId) return;
  if (
    !args.created &&
    args.changedFields.length === 0 &&
    !args.personalPublisherLinked &&
    !args.memberCreated
  ) {
    return;
  }
  await ctx.db.insert("auditLogs", {
    actorUserId: args.audit.actorUserId,
    action: args.created ? "publisher.personal.create" : "publisher.personal.sync",
    targetType: "publisher",
    targetId: args.publisherId,
    metadata: {
      userId: args.user._id,
      source: args.source ?? "unknown",
      created: args.created,
      changedFields: args.changedFields,
      personalPublisherLinked: args.personalPublisherLinked,
      memberCreated: args.memberCreated,
      previous: publisherAuditSnapshot(args.previous),
      next: publisherAuditSnapshot(args.next),
    },
    createdAt: args.now,
  });
}

export async function getPublisherMembership(
  ctx: DbCtx,
  publisherId: Id<"publishers">,
  userId: Id<"users">,
) {
  try {
    return await ctx.db
      .query("publisherMembers")
      .withIndex("by_publisher_user", (q) => q.eq("publisherId", publisherId).eq("userId", userId))
      .unique();
  } catch (error) {
    if (isMissingPublisherTableError(error)) return null;
    throw error;
  }
}

export async function canAccessPublisherOwnerScope(
  ctx: DbCtx,
  params: {
    publisher: Doc<"publishers"> | null | undefined;
    userId: Id<"users">;
    allowedPublisherRoles?: PublisherRole[];
    legacyOwnerUserId?: Id<"users">;
  },
) {
  const publisher = params.publisher;
  if (!publisher || !isPublisherActive(publisher)) return false;
  if (publisher.kind === "user") {
    if (publisher.linkedUserId) return publisher.linkedUserId === params.userId;
    return params.legacyOwnerUserId === params.userId;
  }
  const membership = await getPublisherMembership(ctx, publisher._id, params.userId);
  return Boolean(
    membership &&
    isPublisherRoleAllowed(membership.role, params.allowedPublisherRoles ?? ["publisher"]),
  );
}

export async function requirePublisherRole(
  ctx: DbCtx,
  params: {
    publisherId: Id<"publishers">;
    userId: Id<"users">;
    allowed: PublisherRole[];
  },
) {
  const publisher = await ctx.db.get(params.publisherId);
  if (!publisher || !isPublisherActive(publisher)) throw new ConvexError("Publisher not found");
  if (publisher.kind === "user") {
    if (publisher.linkedUserId !== params.userId) {
      throw new ConvexError("Forbidden");
    }
    const membership = await getPublisherMembership(ctx, params.publisherId, params.userId);
    return { publisher, membership };
  }
  const membership = await getPublisherMembership(ctx, params.publisherId, params.userId);
  if (!membership || !isPublisherRoleAllowed(membership.role, params.allowed)) {
    throw new ConvexError("Forbidden");
  }
  return { publisher, membership };
}

export async function resolvePublisherForActor(
  ctx: Pick<MutationCtx, "db">,
  params: {
    actor: Doc<"users">;
    ownerHandle?: string | null;
    allowed: PublisherRole[];
  },
) {
  const personalPublisher = await ensurePersonalPublisherForUser(ctx, params.actor, {
    actorUserId: params.actor._id,
    source: "publisher.resolve_for_actor",
  });
  const requestedHandle = normalizePublisherHandle(params.ownerHandle);
  if (!requestedHandle) {
    return personalPublisher;
  }
  if (requestedHandle === personalPublisher?.handle) return personalPublisher;

  const publisher = await getPublisherByHandle(ctx, requestedHandle);
  if (!publisher || !isPublisherActive(publisher)) {
    throw new ConvexError(`Publisher "@${requestedHandle}" not found`);
  }
  if (publisher.kind === "user") {
    if (publisher.linkedUserId === params.actor._id) return publisher;
    throw new ConvexError(`You do not have publish access for "@${requestedHandle}"`);
  }
  const membership = await getPublisherMembership(ctx, publisher._id, params.actor._id);
  if (!membership || !isPublisherRoleAllowed(membership.role, params.allowed)) {
    throw new ConvexError(`You do not have publish access for "@${requestedHandle}"`);
  }
  return publisher;
}

export async function getOwnerPublisher(
  ctx: DbCtx,
  params: {
    ownerPublisherId?: Id<"publishers"> | null;
    ownerUserId?: Id<"users"> | null;
  },
) {
  if (params.ownerPublisherId) {
    const publisher = await ctx.db.get(params.ownerPublisherId);
    if (isPublisherActive(publisher)) return publisher;
  }
  if (!params.ownerUserId) return null;
  const user = await ctx.db.get(params.ownerUserId);
  if (!user || user.deletedAt || user.deactivatedAt) return null;
  return await getPersonalPublisherForUserOrFallback(ctx, user);
}
export const MAX_FOLLOWED_PUBLISHERS = 100;
