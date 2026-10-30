import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

// File actions authorize these snapshots before reading storage. Keep their
// database reads independent of the publishing module's initialization.
export const getVersionByIdInternal = internalQuery({
  args: { versionId: v.id("skillVersions") },
  handler: async (ctx, args) => ctx.db.get(args.versionId),
});

export const getSkillByIdInternal = internalQuery({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => ctx.db.get(args.skillId),
});

export const listVersionFingerprintsInternal = internalQuery({
  args: { skillVersionId: v.id("skillVersions") },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("skillVersionFingerprints")
      .withIndex("by_version", (q) => q.eq("versionId", args.skillVersionId))
      .collect();
    return entries.map((entry) => ({
      fingerprint: entry.fingerprint,
      kind: entry.kind,
      createdAt: entry.createdAt,
    }));
  },
});
