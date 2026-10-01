import {
  MANAGED_MCP_DEFINITION_PATH,
  parseManagedMcpDefinition,
  type ManagedMcpDefinition,
} from "clawhub-schema";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalQuery, type ActionCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { assertAdmin, requireUserFromAction } from "./lib/access";
import { sha256Hex } from "./lib/clawpack";
import { buildManagedMcpBundle } from "./lib/managedMcpBundle";
import type { McpPublicInspection } from "./lib/mcpPublicInspection";
import { getPublisherByHandle, requirePublisherRole } from "./lib/publishers";

type PublishResult = {
  ok: true;
  packageId: Id<"packages">;
  releaseId: Id<"packageReleases">;
  publicationStatus?: "pending" | "published";
  attemptId?: Id<"publishAttempts">;
  endpointObservation?: McpPublicInspection;
};

async function requireAdminActor(ctx: ActionCtx, actorUserId: Id<"users">) {
  const user = await ctx.runQuery(internal.users.getByIdInternal, { userId: actorUserId });
  if (!user || user.deletedAt || user.deactivatedAt) throw new ConvexError("Unauthorized");
  assertAdmin(user);
}

// Package/release storage remains the authority; there is no second mutable provider registry.
export const getReleaseInternal = internalQuery({
  args: { actorUserId: v.id("users"), id: v.string() },
  handler: async (ctx, { actorUserId, id }): Promise<Doc<"packageReleases"> | null> => {
    const user = await ctx.db.get(actorUserId);
    if (!user || user.deletedAt || user.deactivatedAt) throw new ConvexError("Unauthorized");
    assertAdmin(user);
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) throw new ConvexError("Invalid integration id");
    const publisher = await getPublisherByHandle(ctx, "openclaw");
    if (!publisher || publisher.kind !== "org")
      throw new ConvexError("Managed MCP publisher is unavailable");
    await requirePublisherRole(ctx, {
      publisherId: publisher._id,
      userId: actorUserId,
      allowed: ["publisher"],
    });
    const pkg = await ctx.db
      .query("packages")
      .withIndex("by_name", (q) => q.eq("normalizedName", `@openclaw/${id}`))
      .unique();
    if (!pkg) return null;
    if (pkg.ownerPublisherId !== publisher._id || pkg.family !== "bundle-plugin")
      throw new ConvexError("Package identity is already in use");
    const release = await ctx.db
      .query("packageReleases")
      .withIndex("by_package", (q) => q.eq("packageId", pkg._id))
      .order("desc")
      .first();
    if (!release?.files.some((file) => file.path === MANAGED_MCP_DEFINITION_PATH))
      throw new ConvexError("Package is not a managed MCP integration");
    return release;
  },
});

export const getDefinitionForAdminInternal = internalAction({
  args: { actorUserId: v.id("users"), id: v.string() },
  handler: async (ctx, args): Promise<ManagedMcpDefinition | null> => {
    const release = await ctx.runQuery(internal.managedMcp.getReleaseInternal, args);
    if (!release) return null;
    const file = release.files.find((entry) => entry.path === MANAGED_MCP_DEFINITION_PATH);
    if (!file || file.size > 800_000) throw new ConvexError("Managed definition unavailable");
    const blob = await ctx.storage.get(file.storageId);
    if (!blob || blob.size > 800_000) throw new ConvexError("Managed definition unavailable");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if ((await sha256Hex(bytes)) !== file.sha256)
      throw new ConvexError("Managed definition integrity mismatch");
    const definition = parseManagedMcpDefinition(
      JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    );
    if (definition.id !== args.id) throw new ConvexError("Managed definition identity mismatch");
    return definition;
  },
});

export const getDefinition = action({
  args: { id: v.string() },
  handler: async (ctx, args): Promise<ManagedMcpDefinition | null> => {
    const { userId, user } = await requireUserFromAction(ctx);
    assertAdmin(user);
    return ctx.runAction(internal.managedMcp.getDefinitionForAdminInternal, {
      ...args,
      actorUserId: userId,
    });
  },
});

export const publishForAdminInternal = internalAction({
  args: { actorUserId: v.id("users"), definition: v.any() },
  handler: async (ctx, args): Promise<PublishResult> => {
    await requireAdminActor(ctx, args.actorUserId);
    const bundle = buildManagedMcpBundle(args.definition);
    // Refuse collisions before storing bytes. Normal publication still enforces organization membership.
    await ctx.runQuery(internal.managedMcp.getReleaseInternal, {
      actorUserId: args.actorUserId,
      id: bundle.definition.id,
    });
    const endpointObservation = await ctx.runAction(
      internal.mcpInspectionNode.inspectEndpointInternal,
      {
        url: bundle.definition.connection.url,
        transport: bundle.definition.connection.transport,
        checkOAuth: bundle.definition.connection.auth.kind === "oauth",
      },
    );
    if (
      bundle.definition.connection.auth.kind === "oauth" &&
      endpointObservation.oauthDiscovery !== "ready"
    )
      throw new ConvexError(
        "OAuth discovery must advertise public authorization, token, and client registration endpoints.",
      );
    if (endpointObservation.status === "unavailable")
      throw new ConvexError(
        "Endpoint compatibility could not be checked. Retry when the service is available.",
      );
    if (
      endpointObservation.status === "authentication-required" &&
      bundle.definition.connection.auth.kind === "none"
    )
      throw new ConvexError(
        "This endpoint requires authentication. Update the connection settings.",
      );
    const files: Array<{
      path: string;
      size: number;
      sha256: string;
      contentType: string;
      storageId: Id<"_storage">;
    }> = [];
    try {
      for (const file of bundle.files) {
        const storageId = await ctx.storage.store(
          new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.contentType }),
        );
        files.push({
          path: file.path,
          size: file.bytes.byteLength,
          contentType: file.contentType,
          storageId,
          sha256: await sha256Hex(file.bytes),
        });
      }
    } catch (error) {
      await Promise.allSettled(files.map((file) => ctx.storage.delete(file.storageId)));
      throw error;
    }
    // The ordinary publisher owns cleanup once called, including rejected or retried submissions.
    const result = await ctx.runAction(internal.packages.publishPackageForUserInternal, {
      actorUserId: args.actorUserId,
      requireSecurityChecks: true,
      requestStorageIds: files.map((file) => file.storageId),
      payload: {
        name: bundle.name,
        displayName: bundle.definition.name,
        ownerHandle: "openclaw",
        family: "bundle-plugin",
        version: bundle.definition.version,
        changelog: `Publish ${bundle.definition.name} connection configuration.`,
        categories: [bundle.definition.category],
        bundle: { id: bundle.definition.id, format: "claude" },
        files,
      },
    });
    return { ...result, endpointObservation };
  },
});

export const publish = action({
  args: { definition: v.any() },
  handler: async (ctx, args): Promise<PublishResult> => {
    const { userId, user } = await requireUserFromAction(ctx);
    assertAdmin(user);
    return ctx.runAction(internal.managedMcp.publishForAdminInternal, {
      ...args,
      actorUserId: userId,
    });
  },
});

export const unpublishForAdminInternal = internalMutation({
  args: { actorUserId: v.id("users"), id: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    // Nested query and mutation calls share this transaction, so a membership
    // revocation cannot race between the authorization check and soft deletion.
    const release = await ctx.runQuery(internal.managedMcp.getReleaseInternal, args);
    if (!release) throw new ConvexError("Managed integration not found");
    await ctx.runMutation(internal.packages.softDeletePackageInternal, {
      userId: args.actorUserId,
      name: `@openclaw/${args.id}`,
    });
    return { ok: true };
  },
});

export const unpublish = action({
  args: { id: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const { userId, user } = await requireUserFromAction(ctx);
    assertAdmin(user);
    return ctx.runMutation(internal.managedMcp.unpublishForAdminInternal, {
      ...args,
      actorUserId: userId,
    });
  },
});
