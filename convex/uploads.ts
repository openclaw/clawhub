import { v } from "convex/values";
import { internalMutation, mutation } from "./functions";
import { requireUser } from "./lib/access";

const PACKAGE_PUBLISH_UPLOAD_TICKET_TTL_MS = 15 * 60_000;
const SKILL_PUBLISH_UPLOAD_TICKET_TTL_MS = 15 * 60_000;

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const createPackagePublishUploadForUserInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.deletedAt || user.deactivatedAt) throw new Error("User not found");
    const now = Date.now();
    const uploadTicket = await ctx.db.insert("packagePublishUploadTickets", {
      kind: "user",
      userId: args.userId,
      createdAt: now,
      expiresAt: now + PACKAGE_PUBLISH_UPLOAD_TICKET_TTL_MS,
    });
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl, uploadTicket };
  },
});

export const createPackagePublishUploadForTokenInternal = internalMutation({
  args: { publishTokenId: v.id("packagePublishTokens") },
  handler: async (ctx, args) => {
    const publishToken = await ctx.db.get(args.publishTokenId);
    const now = Date.now();
    if (!publishToken || publishToken.revokedAt || publishToken.expiresAt <= now) {
      throw new Error("Trusted publish token is missing or expired");
    }
    const uploadTicket = await ctx.db.insert("packagePublishUploadTickets", {
      kind: "github-actions",
      publishTokenId: args.publishTokenId,
      createdAt: now,
      expiresAt: now + PACKAGE_PUBLISH_UPLOAD_TICKET_TTL_MS,
    });
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl, uploadTicket };
  },
});

export const consumePackagePublishUploadTicketInternal = internalMutation({
  args: {
    uploadTicket: v.id("packagePublishUploadTickets"),
    storageId: v.id("_storage"),
    auth: v.union(
      v.object({ kind: v.literal("user"), userId: v.id("users") }),
      v.object({
        kind: v.literal("github-actions"),
        publishTokenId: v.id("packagePublishTokens"),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get(args.uploadTicket);
    const now = Date.now();
    if (!ticket || ticket.expiresAt <= now) {
      throw new Error("Package tarball upload ticket is missing or expired");
    }
    if (
      args.auth.kind === "user"
        ? ticket.kind !== "user" || ticket.userId !== args.auth.userId
        : ticket.kind !== "github-actions" || ticket.publishTokenId !== args.auth.publishTokenId
    ) {
      throw new Error("Package tarball upload ticket does not match this publish token");
    }
    if (ticket.usedAt) {
      if (ticket.storageId === args.storageId) return;
      throw new Error("Package tarball upload ticket was already used");
    }

    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) throw new Error("Package tarball upload no longer exists");
    if (metadata._creationTime < ticket.createdAt) {
      throw new Error("Package tarball upload must be created after its upload ticket");
    }

    await ctx.db.patch(ticket._id, {
      usedAt: now,
      storageId: args.storageId,
    });
  },
});

// --- Skill publish staged upload (large bundles) ---
//
// Mirrors the package publish ticket flow above, scoped to user auth only
// (skill publish authenticates via a user API token). A ticket binds a
// generated storage upload URL to the issuing user so the skills publish route
// can accept a bundle staged directly in Convex storage, bypassing the ~4.5MB
// edge multipart body limit.

export const createSkillPublishUploadForUserInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.deletedAt || user.deactivatedAt) throw new Error("User not found");
    const now = Date.now();
    const uploadTicket = await ctx.db.insert("skillPublishUploadTickets", {
      userId: args.userId,
      createdAt: now,
      expiresAt: now + SKILL_PUBLISH_UPLOAD_TICKET_TTL_MS,
    });
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl, uploadTicket };
  },
});

export const consumeSkillPublishUploadTicketInternal = internalMutation({
  args: {
    uploadTicket: v.id("skillPublishUploadTickets"),
    storageId: v.id("_storage"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get(args.uploadTicket);
    const now = Date.now();
    if (!ticket || ticket.expiresAt <= now) {
      throw new Error("Skill bundle upload ticket is missing or expired");
    }
    if (ticket.userId !== args.userId) {
      throw new Error("Skill bundle upload ticket does not match this publisher");
    }
    if (ticket.usedAt) {
      if (ticket.storageId === args.storageId) return;
      throw new Error("Skill bundle upload ticket was already used");
    }

    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) throw new Error("Skill bundle upload no longer exists");
    if (metadata._creationTime < ticket.createdAt) {
      throw new Error("Skill bundle upload must be created after its upload ticket");
    }

    await ctx.db.patch(ticket._id, {
      usedAt: now,
      storageId: args.storageId,
    });
  },
});
