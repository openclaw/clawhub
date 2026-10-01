import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { getPersonalPublisherForUser } from "./publishers";

export async function assertPackageRuntimeIdAvailable(
  ctx: Pick<QueryCtx, "db">,
  identity: Pick<Doc<"packages">, "ownerUserId" | "ownerPublisherId" | "runtimeId"> & {
    _id?: Id<"packages">;
  },
) {
  if (!identity.runtimeId) return;
  const runtimeId = identity.runtimeId;
  const publisher = identity.ownerPublisherId ? await ctx.db.get(identity.ownerPublisherId) : null;
  const userId = !identity.ownerPublisherId
    ? identity.ownerUserId
    : publisher?.kind === "user"
      ? publisher.linkedUserId
      : undefined;
  const personalPublisher = userId ? await getPersonalPublisherForUser(ctx, userId) : null;
  const publisherId = userId
    ? personalPublisher?.kind === "user"
      ? personalPublisher._id
      : undefined
    : identity.ownerPublisherId;
  // Personal publishers and legacy user-owned packages share one namespace.
  // Query both exact claims; unrelated publishers must not consume this transaction's read budget.
  const claims = [];
  if (userId) {
    claims.push(
      ctx.db
        .query("packages")
        .withIndex("by_ownerUserId_ownerPublisherId_runtimeId_softDeletedAt", (q) =>
          q
            .eq("ownerUserId", userId)
            .eq("ownerPublisherId", undefined)
            .eq("runtimeId", runtimeId)
            .eq("softDeletedAt", undefined),
        ),
    );
  }
  if (publisherId) {
    claims.push(
      ctx.db
        .query("packages")
        .withIndex("by_ownerPublisherId_runtimeId_softDeletedAt", (q) =>
          q
            .eq("ownerPublisherId", publisherId)
            .eq("runtimeId", runtimeId)
            .eq("softDeletedAt", undefined),
        ),
    );
  }
  for (const claim of claims) {
    for await (const candidate of claim) {
      if (candidate._id === identity._id) continue;
      throw new ConvexError(
        `Plugin id "${identity.runtimeId}" is already claimed by another package in this publisher namespace`,
      );
    }
  }
}
