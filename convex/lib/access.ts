import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

export type Role = "admin" | "moderator" | "user";

export async function getOptionalActiveAuthUserId(
  ctx: MutationCtx | QueryCtx,
): Promise<Id<"users"> | undefined> {
  try {
    const userId = await getAuthUserId(ctx);
    if (!userId) return undefined;
    const user = await ctx.db.get(userId);
    if (!user || user.deletedAt || user.deactivatedAt) return undefined;
    return userId;
  } catch {
    return undefined;
  }
}

export async function getOptionalActiveAuthUserIdFromAction(
  ctx: ActionCtx,
): Promise<Id<"users"> | undefined> {
  try {
    const userId = await getAuthUserId(ctx);
    if (!userId) return undefined;
    const user = await ctx.runQuery(internal.users.getByIdInternal, { userId });
    if (!user || user.deletedAt || user.deactivatedAt) return undefined;
    return userId;
  } catch {
    return undefined;
  }
}

export async function requireUser(ctx: MutationCtx | QueryCtx) {
  const userId = await getAuthUserId(ctx);
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
  const userId = await getAuthUserId(ctx);
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
