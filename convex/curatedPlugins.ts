import { ConvexError, v } from "convex/values";
import { internalMutation } from "./functions";

// Staff records evidence reviewed during curation. This never grants Official
// status; that remains the existing, separately audited publisher policy.
export const setStaffCustodyInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    publisherId: v.id("publishers"),
    sourceRepo: v.string(),
    repositoryOwnerId: v.number(),
    evidenceUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (actor?.role !== "admin" || actor.deletedAt || actor.deactivatedAt) {
      throw new ConvexError("Only active staff may establish custody");
    }
    const publisher = await ctx.db.get(args.publisherId);
    if (!publisher || publisher.kind !== "org" || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError("An active organization publisher is required");
    }
    if (
      !/^[-\w.]+\/[-\w.]+$/.test(args.sourceRepo) ||
      !Number.isSafeInteger(args.repositoryOwnerId) ||
      args.repositoryOwnerId <= 0
    ) {
      throw new ConvexError("Invalid company repository identity");
    }
    let evidence: URL;
    try {
      evidence = new URL(args.evidenceUrl);
    } catch {
      throw new ConvexError("Invalid ownership evidence URL");
    }
    if (evidence.protocol !== "https:" || evidence.username || evidence.password)
      throw new ConvexError("Ownership evidence must use HTTPS");
    const members = await ctx.db
      .query("publisherMembers")
      .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
      .take(101);
    if (!members.length || members.length > 100)
      throw new ConvexError("Staff ownership could not be established");
    for (const member of members) {
      const user = await ctx.db.get(member.userId);
      if (user?.role !== "admin" || user.deletedAt || user.deactivatedAt)
        throw new ConvexError("Cannot establish custody for a publisher with company members");
    }
    if (!members.some((m) => m.role === "owner"))
      throw new ConvexError("A staff owner is required");
    if (publisher.githubOrgId)
      throw new ConvexError("A verified company publisher cannot enter staff custody");
    const now = Date.now();
    const staffCustody = {
      repositoryOwner: args.sourceRepo.split("/")[0].toLowerCase(),
      repositoryOwnerId: args.repositoryOwnerId,
      sourceRepo: args.sourceRepo.toLowerCase(),
      evidenceUrl: args.evidenceUrl,
      establishedAt: now,
      establishedBy: actor._id,
    };
    await ctx.db.patch(publisher._id, { staffCustody, updatedAt: now });
    await ctx.db.insert("auditLogs", {
      actorUserId: actor._id,
      action: "publisher.staffCustody.establish",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: staffCustody,
      createdAt: now,
    });
    return { ok: true };
  },
});
