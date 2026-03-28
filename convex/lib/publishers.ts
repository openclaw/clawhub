import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type PublisherRole = "owner" | "admin" | "publisher";

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

function isMissingPublisherTableError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    /unexpected (query |insert )?table:? (publishers|publishermembers)/i.test(error.message) ||
    /innerdb\.(insert|patch) is not a function/i.test(error.message)
  );
}

function derivePersonalPublisherHandle(user: Doc<"users">) {
  const emailLocalPart = user.email?.split("@")[0];
  const userIdSuffix = String(user._id).split(":").pop();
  return (
    normalizePublisherHandle(user.handle ?? user.name ?? emailLocalPart ?? userIdSuffix) ??
    "user"
  );
}

function synthesizePersonalPublisher(user: Doc<"users">): Doc<"publishers"> {
  const handle = derivePersonalPublisherHandle(user);
  const now = user.updatedAt ?? user.createdAt ?? user._creationTime;
  return {
    _id: (user.personalPublisherId ?? (`publishers:${handle}` as Id<"publishers">)) as Id<"publishers">,
    _creationTime: user._creationTime,
    kind: "user",
    handle,
    displayName: user.displayName?.trim() || user.name?.trim() || handle,
    bio: user.bio?.trim() || undefined,
    image: user.image,
    linkedUserId: user._id,
    trustedPublisher: user.trustedPublisher,
    createdAt: user.createdAt ?? now,
    updatedAt: now,
    deletedAt: undefined,
    deactivatedAt: undefined,
  };
}

export async function getPersonalPublisherForUserOrFallback(
  ctx: DbCtx,
  user: Doc<"users">,
) {
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

export function isPublisherActive(
  publisher: Pick<Doc<"publishers">, "deletedAt" | "deactivatedAt"> | null | undefined,
) {
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

export async function getPublisherByHandle(
  ctx: DbCtx,
  handle: string | undefined | null,
) {
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

export async function getPersonalPublisherForUser(
  ctx: DbCtx,
  userId: Id<"users">,
) {
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

export async function ensurePersonalPublisherForUser(
  ctx: Pick<MutationCtx, "db">,
  user: Doc<"users">,
) {
  const handle = derivePersonalPublisherHandle(user);
  let existing: Doc<"publishers"> | null = null;
  try {
    existing =
      user.personalPublisherId
        ? await ctx.db.get(user.personalPublisherId)
        : await getPersonalPublisherForUser(ctx, user._id);
  } catch (error) {
    if (!isMissingPublisherTableError(error)) throw error;
    return synthesizePersonalPublisher(user);
  }
  if (existing && isPublisherActive(existing)) {
    const existingPublisher = existing;
    const now = Date.now();
    const conflict = await getPublisherByHandle(ctx, handle);
    if (conflict && conflict._id !== existingPublisher._id) {
      throw new ConvexError(`Publisher handle "@${handle}" is already claimed`);
    }
    try {
      await ctx.db.patch(existingPublisher._id, {
        handle,
        displayName: user.displayName?.trim() || user.name?.trim() || handle,
        bio: user.bio?.trim() || undefined,
        image: user.image,
        linkedUserId: user._id,
        trustedPublisher: user.trustedPublisher,
        deletedAt: undefined,
        deactivatedAt: undefined,
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
      return await ctx.db.get(existingPublisher._id);
    } catch (error) {
      if (isMissingPublisherTableError(error)) return synthesizePersonalPublisher(user);
      throw error;
    }
  }

  const conflict = await getPublisherByHandle(ctx, handle);
  if (conflict && conflict.linkedUserId !== user._id) {
    throw new ConvexError(`Publisher handle "@${handle}" is already claimed`);
  }

  const now = Date.now();
  try {
    const publisherId =
      conflict?._id ??
      (await ctx.db.insert("publishers", {
        kind: "user",
        handle,
        displayName: user.displayName?.trim() || user.name?.trim() || handle,
        bio: user.bio?.trim() || undefined,
        image: user.image,
        linkedUserId: user._id,
        trustedPublisher: user.trustedPublisher,
        createdAt: now,
        updatedAt: now,
      }));

    if (conflict) {
      await ctx.db.patch(conflict._id, {
        displayName: user.displayName?.trim() || user.name?.trim() || handle,
        bio: user.bio?.trim() || undefined,
        image: user.image,
        linkedUserId: user._id,
        trustedPublisher: user.trustedPublisher,
        deletedAt: undefined,
        deactivatedAt: undefined,
        updatedAt: now,
      });
    }

    const existingMember = await ctx.db
      .query("publisherMembers")
      .withIndex("by_publisher_user", (q) => q.eq("publisherId", publisherId).eq("userId", user._id))
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

    return await ctx.db.get(publisherId);
  } catch (error) {
    if (isMissingPublisherTableError(error)) return synthesizePersonalPublisher(user);
    throw error;
  }
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

export async function requirePublisherRole(
  ctx: DbCtx,
  params: {
    publisherId: Id<"publishers">;
    userId: Id<"users">;
    allowed: PublisherRole[];
  },
) {
  const publisher = await ctx.db.get(params.publisherId);
  if (!isPublisherActive(publisher)) throw new ConvexError("Publisher not found");
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
  const personalPublisher = await ensurePersonalPublisherForUser(ctx, params.actor);
  const requestedHandle = normalizePublisherHandle(params.ownerHandle);
  if (!requestedHandle) {
    return personalPublisher;
  }
  if (requestedHandle === personalPublisher?.handle) return personalPublisher;

  const publisher = await getPublisherByHandle(ctx, requestedHandle);
  if (!publisher || !isPublisherActive(publisher)) {
    throw new ConvexError(`Publisher "@${requestedHandle}" not found`);
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
