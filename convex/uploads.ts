import { v } from "convex/values";
import { internalMutation, mutation } from "./functions";
import { requireUser } from "./lib/access";

const PACKAGE_PUBLISH_UPLOAD_TICKET_TTL_MS = 15 * 60_000;

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
