import { customCtx, customMutation } from "convex-helpers/server/customFunctions";
import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "./_generated/dataModel";
import {
  mutation as rawMutation,
  internalMutation as rawInternalMutation,
  query,
  internalQuery,
  action,
  internalAction,
  httpAction,
} from "./_generated/server";
import { extractDigestFields, upsertSkillSearchDigest } from "./lib/skillSearchDigest";

const triggers = new Triggers<DataModel>();

triggers.register("skills", async (ctx, change) => {
  if (change.operation === "delete") {
    const existing = await ctx.db
      .query("skillSearchDigest")
      .withIndex("by_skill", (q) => q.eq("skillId", change.id))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  } else {
    const fields = extractDigestFields(change.newDoc);
    const owner = await ctx.db.get(change.newDoc.ownerUserId);
    const isOwnerVisible = owner && !owner.deletedAt && !owner.deactivatedAt;
    await upsertSkillSearchDigest(ctx, {
      ...fields,
      // Use '' as sentinel for "visible user without a handle" so
      // digestToOwnerInfo can distinguish from undefined (not backfilled).
      // Deactivated/deleted owners also get '' → digestToOwnerInfo returns
      // null owner, matching the live path.
      ownerHandle: isOwnerVisible ? (owner.handle ?? "") : "",
      ownerName: isOwnerVisible ? owner.name : undefined,
      ownerDisplayName: isOwnerVisible ? owner.displayName : undefined,
      ownerImage: isOwnerVisible ? owner.image : undefined,
    });
  }
});

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));
export { query, internalQuery, action, internalAction, httpAction };
