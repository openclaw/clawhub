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
    if (
      !publishToken ||
      publishToken.revokedAt ||
      publishToken.consumedAt ||
      publishToken.expiresAt <= now
    ) {
      throw new Error("Trusted publish token is missing or expired");
    }
    if (
      publishToken.repository === "openclaw/openclaw" &&
      publishToken.authorizationVersion !== 2
    ) {
      throw new Error("OpenClaw trusted publishes require authorization version 2");
    }
    if (publishToken.scope === "publish") {
      throw new Error("Trusted publish token cannot authorize package upload");
    }
    if (publishToken.scope !== undefined && publishToken.scope !== "upload") {
      throw new Error("Trusted package uploads require an upload-scoped token");
    }
    if (publishToken.scope !== undefined && !publishToken.authorizationTransactionKey) {
      throw new Error("Scoped trusted publish authorization is missing its transaction key");
    }
    const uploadTicket = await ctx.db.insert("packagePublishUploadTickets", {
      kind: "github-actions",
      publishTokenId: args.publishTokenId,
      ...(publishToken.authorizationTransactionKey
        ? { authorizationTransactionKey: publishToken.authorizationTransactionKey }
        : {}),
      createdAt: now,
      expiresAt: now + PACKAGE_PUBLISH_UPLOAD_TICKET_TTL_MS,
    });
    if (publishToken.scope !== undefined) {
      // One-time capability consumption and ticket creation share the transaction.
      await ctx.db.patch(publishToken._id, { consumedAt: now });
    }
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
    if (args.auth.kind === "user") {
      if (ticket.kind !== "user" || ticket.userId !== args.auth.userId) {
        throw new Error("Package tarball upload ticket does not match this publish token");
      }
    } else {
      if (ticket.kind !== "github-actions") {
        throw new Error("Package tarball upload ticket does not match this publish token");
      }
      const publishToken = await ctx.db.get(args.auth.publishTokenId);
      if (
        !publishToken ||
        publishToken.revokedAt ||
        publishToken.expiresAt <= now ||
        (!ticket.usedAt && publishToken.consumedAt)
      ) {
        throw new Error("Trusted publish token is missing, expired, or consumed");
      }
      if ((publishToken.scope ?? "publish") !== "publish") {
        throw new Error("Trusted upload token cannot authorize package publication");
      }
      if (
        publishToken.repository === "openclaw/openclaw" &&
        publishToken.authorizationVersion !== 2
      ) {
        throw new Error("OpenClaw trusted publishes require authorization version 2");
      }
      if (ticket.authorizationTransactionKey !== undefined || publishToken.scope !== undefined) {
        if (!ticket.authorizationTransactionKey || !publishToken.authorizationTransactionKey) {
          throw new Error("Scoped trusted publish authorization is missing its transaction key");
        }
        if (ticket.authorizationTransactionKey !== publishToken.authorizationTransactionKey) {
          throw new Error("Package tarball upload ticket does not match this publish transaction");
        }
      } else if (ticket.publishTokenId !== args.auth.publishTokenId) {
        throw new Error("Package tarball upload ticket does not match this publish token");
      }
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
