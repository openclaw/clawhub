import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./functions";
import { assertAdmin } from "./lib/access";

const restoredSkillFileValidator = v.object({
  path: v.string(),
  size: v.number(),
  storageId: v.id("_storage"),
  sha256: v.string(),
  contentType: v.optional(v.string()),
});

export const evictSquatterSkillForRestoreInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    slug: v.string(),
    rightfulOwnerUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("Actor not found");
    assertAdmin(actor);

    const slug = args.slug.trim().toLowerCase();
    if (!slug) throw new Error("Slug required");

    const now = Date.now();

    const existingSkill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!existingSkill) return { ok: true as const, action: "noop" as const };
    if (existingSkill.ownerUserId === args.rightfulOwnerUserId) {
      return { ok: true as const, action: "already_owned" as const };
    }

    const evictedSlug = buildEvictedSlug(slug, now);

    // Free the slug immediately (same transaction) by renaming the squatter's skill.
    await ctx.db.patch(existingSkill._id, {
      slug: evictedSlug,
      softDeletedAt: now,
      hiddenAt: existingSkill.hiddenAt ?? now,
      hiddenBy: existingSkill.hiddenBy ?? actor._id,
      updatedAt: now,
    });

    // Remove from vector search ASAP.
    const embeddings = await ctx.db
      .query("skillEmbeddings")
      .withIndex("by_skill", (q) => q.eq("skillId", existingSkill._id))
      .collect();
    for (const embedding of embeddings) {
      await ctx.db.patch(embedding._id, {
        visibility: "deleted",
        updatedAt: now,
      });
    }

    // Cleanup the rest asynchronously (versions, fingerprints, installs, etc.)
    await ctx.scheduler.runAfter(0, internal.skills.hardDeleteInternal, {
      skillId: existingSkill._id,
      actorUserId: actor._id,
      phase: "versions",
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: actor._id,
      action: "slug.reclaim.sync",
      targetType: "skill",
      targetId: existingSkill._id,
      metadata: {
        slug,
        evictedSlug,
        squatterUserId: existingSkill.ownerUserId,
        rightfulOwnerUserId: args.rightfulOwnerUserId,
        reason: "Synchronous eviction during registry artifact restore",
      },
      createdAt: now,
    });

    return { ok: true as const, action: "evicted" as const, evictedSlug };
  },
});

export const refreshRestoredSkillVersionInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    skillId: v.id("skills"),
    versionId: v.id("skillVersions"),
    files: v.array(restoredSkillFileValidator),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new Error("Actor not found");
    assertAdmin(actor);

    const [skill, version] = await Promise.all([
      ctx.db.get(args.skillId),
      ctx.db.get(args.versionId),
    ]);
    if (!skill) throw new Error("Skill not found");
    if (!version || version.skillId !== skill._id || version.softDeletedAt) {
      throw new Error("Skill version not found");
    }

    const now = Date.now();
    await ctx.db.patch(version._id, {
      files: args.files,
    });
    await ctx.db.patch(skill._id, {
      latestVersionId: version._id,
      latestVersionSummary: latestVersionSummaryFromVersion(version),
      tags: { ...skill.tags, latest: version._id },
      softDeletedAt: undefined,
      moderationStatus: "active",
      hiddenAt: undefined,
      hiddenBy: undefined,
      unpublishedSlugReservedUntil: undefined,
      unpublishedSlugReleasedAt: undefined,
      unpublishedOriginalSlug: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: actor._id,
      action: "skill.restore.registry_artifact",
      targetType: "skill",
      targetId: skill._id,
      metadata: {
        slug: skill.slug,
        version: version.version,
        versionId: version._id,
      },
      createdAt: now,
    });

    return { ok: true as const, skillId: skill._id, versionId: version._id };
  },
});

function buildEvictedSlug(slug: string, now: number) {
  const suffix = now.toString(36);
  return `${slug}-evicted-${suffix}`;
}

function latestVersionSummaryFromVersion(
  version: Pick<
    Doc<"skillVersions">,
    "version" | "createdAt" | "changelog" | "changelogSource" | "parsed"
  >,
): NonNullable<Doc<"skills">["latestVersionSummary"]> {
  return {
    version: version.version,
    createdAt: version.createdAt,
    changelog: version.changelog,
    changelogSource: version.changelogSource,
    description: frontmatterString(version.parsed?.frontmatter?.description),
    clawdis: version.parsed?.clawdis,
  };
}

function frontmatterString(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}
