import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

export type Role = "admin" | "moderator" | "user";

const DEV_IMPERSONATE_LOCAL_HANDLE = "local";

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function isDevImpersonationAllowed() {
  const requestedHandle = readEnv("CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE");
  if (requestedHandle !== DEV_IMPERSONATE_LOCAL_HANDLE) return false;

  const deployment = readEnv("CONVEX_DEPLOYMENT") ?? "";
  if (deployment.startsWith("prod:") || deployment.includes("production")) return false;
  return (
    deployment.startsWith("anonymous:") ||
    deployment.startsWith("dev:") ||
    deployment.startsWith("local:") ||
    readEnv("CLAW_HUB_ENABLE_DEV_IMPERSONATION") === "1"
  );
}

async function getDevImpersonatedUserId(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
): Promise<Id<"users"> | undefined> {
  if (!isDevImpersonationAllowed()) return undefined;
  const user = await ctx.db
    .query("users")
    .withIndex("handle", (q) => q.eq("handle", DEV_IMPERSONATE_LOCAL_HANDLE))
    .unique();
  if (!user || user.deletedAt || user.deactivatedAt) return undefined;
  return user._id;
}

async function getDevImpersonatedUserIdFromAction(
  ctx: ActionCtx,
): Promise<Id<"users"> | undefined> {
  if (!isDevImpersonationAllowed()) return undefined;
  const user = await ctx.runQuery(internal.users.getByHandleInternal, {
    handle: DEV_IMPERSONATE_LOCAL_HANDLE,
  });
  if (!user || user.deletedAt || user.deactivatedAt) return undefined;
  return user._id;
}

export async function getOptionalActiveAuthUserId(
  ctx: MutationCtx | QueryCtx,
): Promise<Id<"users"> | undefined> {
  try {
    const userId = await getAuthUserId(ctx);
    if (!userId) return await getDevImpersonatedUserId(ctx);
    const user = await ctx.db.get(userId);
    if (!user || user.deletedAt || user.deactivatedAt) return undefined;
    return userId;
  } catch {
    return await getDevImpersonatedUserId(ctx);
  }
}

export async function getOptionalActiveAuthUserIdFromAction(
  ctx: ActionCtx,
): Promise<Id<"users"> | undefined> {
  try {
    const userId = await getAuthUserId(ctx);
    if (!userId) return await getDevImpersonatedUserIdFromAction(ctx);
    const user = await ctx.runQuery(internal.users.getByIdInternal, { userId });
    if (!user || user.deletedAt || user.deactivatedAt) return undefined;
    return userId;
  } catch {
    return await getDevImpersonatedUserIdFromAction(ctx);
  }
}

export async function requireUser(ctx: MutationCtx | QueryCtx) {
  let userId: Id<"users"> | null | undefined = null;
  try {
    userId = await getAuthUserId(ctx);
  } catch {
    userId = null;
  }
  userId ??= await getDevImpersonatedUserId(ctx);
  if (!userId) throw new Error("Unauthorized");
  let user: Doc<"users"> | null;
  try {
    user = await ctx.db.get(userId);
  } catch {
    throw new Error("User not found");
  }
  if (!user || user.deletedAt || user.deactivatedAt) throw new Error("User not found");
  return { userId, user };
}

export async function requireUserFromAction(
  ctx: ActionCtx,
): Promise<{ userId: Id<"users">; user: Doc<"users"> }> {
  let userId: Id<"users"> | null | undefined = null;
  try {
    userId = await getAuthUserId(ctx);
  } catch {
    userId = null;
  }
  userId ??= await getDevImpersonatedUserIdFromAction(ctx);
  if (!userId) throw new Error("Unauthorized");
  let user: Doc<"users"> | null;
  try {
    user = await ctx.runQuery(internal.users.getByIdInternal, { userId });
  } catch {
    throw new Error("User not found");
  }
  if (!user || user.deletedAt || user.deactivatedAt) throw new Error("User not found");
  return { userId, user: user as Doc<"users"> };
}

export function assertRole(user: Doc<"users">, allowed: Role[]) {
  if (!user.role || !allowed.includes(user.role as Role)) {
    throw new Error("Forbidden");
  }
}

export function assertAdmin(user: Doc<"users">) {
  assertRole(user, ["admin"]);
}

export function assertModerator(user: Doc<"users">) {
  assertRole(user, ["admin", "moderator"]);
}
