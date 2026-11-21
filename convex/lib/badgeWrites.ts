import { getPluginDiscoveryExclusion } from "clawhub-schema/pluginCategories";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { getSkillBadgeMap, isSkillHighlighted } from "./badges";
import { assertFeaturedCapacity } from "./featuredPolicy";
import type { WebhookSkillPayload } from "./webhooks";

type BadgeKind = Doc<"skillBadges">["kind"];
type PackageBadgeKind = Doc<"packageBadges">["kind"];

export async function upsertSkillBadge(
  ctx: MutationCtx,
  skillId: Id<"skills">,
  kind: BadgeKind,
  userId: Id<"users">,
  at: number,
) {
  const existing = await ctx.db
    .query("skillBadges")
    .withIndex("by_skill_kind", (q) => q.eq("skillId", skillId).eq("kind", kind))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { byUserId: userId, at });
  } else {
    if (kind === "highlighted") await assertFeaturedCapacity(ctx, "skill");
    await ctx.db.insert("skillBadges", {
      skillId,
      kind,
      byUserId: userId,
      at,
    });
  }
  // Keep denormalized badges field on skill doc in sync
  const skill = await ctx.db.get(skillId);
  if (skill) {
    await ctx.db.patch(skillId, {
      badges: {
        ...(skill.badges as Record<string, unknown> | undefined),
        [kind]: { byUserId: userId, at },
      },
    });
  }
}

export async function removeSkillBadge(ctx: MutationCtx, skillId: Id<"skills">, kind: BadgeKind) {
  const existing = await ctx.db
    .query("skillBadges")
    .withIndex("by_skill_kind", (q) => q.eq("skillId", skillId).eq("kind", kind))
    .unique();
  if (existing) {
    await ctx.db.delete(existing._id);
  }
  // Keep denormalized badges field on skill doc in sync
  const skill = await ctx.db.get(skillId);
  if (skill) {
    const { [kind]: _, ...remainingBadges } = (skill.badges ?? {}) as Record<string, unknown>;
    await ctx.db.patch(skillId, { badges: remainingBadges });
  }
}

async function upsertPackageBadge(
  ctx: MutationCtx,
  pkg: Doc<"packages">,
  kind: PackageBadgeKind,
  userId: Id<"users">,
  at: number,
) {
  const packageId = pkg._id;
  const existing = await ctx.db
    .query("packageBadges")
    .withIndex("by_package_kind", (q) => q.eq("packageId", packageId).eq("kind", kind))
    .unique();
  if (existing) {
    return false;
  }
  if (pkg.family === "code-plugin" || pkg.family === "bundle-plugin") {
    if (getPluginDiscoveryExclusion(pkg.categories, "explicit-featured")) {
      throw new ConvexError(
        "Model providers and agent runtimes are excluded from Featured discovery.",
      );
    }
    await assertFeaturedCapacity(ctx, "plugin");
  }
  await ctx.db.insert("packageBadges", {
    packageId,
    kind,
    byUserId: userId,
    at,
  });
  return true;
}

async function removePackageBadge(
  ctx: MutationCtx,
  packageId: Id<"packages">,
  kind: PackageBadgeKind,
) {
  const existing = await ctx.db
    .query("packageBadges")
    .withIndex("by_package_kind", (q) => q.eq("packageId", packageId).eq("kind", kind))
    .unique();
  if (!existing) return false;
  await ctx.db.delete(existing._id);
  return true;
}

export async function setSkillFeaturedForActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  skill: Doc<"skills">,
  nextBatch: string | undefined,
  notify = true,
) {
  const existingBadges = await getSkillBadgeMap(ctx, skill._id);
  const previousHighlighted = isSkillHighlighted({ badges: existingBadges });
  const featured = nextBatch === "highlighted";
  const result = { ok: true as const, featured, skillId: skill._id, slug: skill.slug };
  // Keeping a selection must preserve its timestamp, ordering and notifications.
  if (featured && previousHighlighted) return result;
  if (!featured && !previousHighlighted && nextBatch === skill.batch) return result;
  const now = Date.now();

  if (featured) {
    await upsertSkillBadge(ctx, skill._id, "highlighted", actor._id, now);
  } else {
    await removeSkillBadge(ctx, skill._id, "highlighted");
  }

  await ctx.db.patch(skill._id, {
    batch: nextBatch,
    updatedAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "badge.highlighted",
    targetType: "skill",
    targetId: skill._id,
    metadata: { highlighted: featured },
    createdAt: now,
  });

  if (featured && !previousHighlighted && notify) {
    await queueHighlightedWebhook(ctx, skill._id);
  }

  return result;
}

export async function setPackageFeaturedForActor(
  ctx: MutationCtx,
  actor: Doc<"users">,
  pkg: Doc<"packages">,
  featured: boolean,
) {
  const now = Date.now();
  const changed = featured
    ? await upsertPackageBadge(ctx, pkg, "highlighted", actor._id, now)
    : await removePackageBadge(ctx, pkg._id, "highlighted");
  const result = { ok: true as const, featured, packageId: pkg._id, name: pkg.name };
  if (!changed) return result;

  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "package.badge.highlighted",
    targetType: "package",
    targetId: pkg._id,
    metadata: { highlighted: featured },
    createdAt: now,
  });

  return result;
}

async function queueHighlightedWebhook(ctx: MutationCtx, skillId: Id<"skills">) {
  const skill = await ctx.db.get(skillId);
  if (!skill) return;
  const owner = await ctx.db.get(skill.ownerUserId);
  const latestVersion = skill.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;

  const badges = await getSkillBadgeMap(ctx, skillId);
  const payload: WebhookSkillPayload = {
    slug: skill.slug,
    displayName: skill.displayName,
    summary: skill.summary ?? undefined,
    version: latestVersion?.version ?? undefined,
    ownerHandle: owner?.handle ?? owner?.name ?? undefined,
    highlighted: isSkillHighlighted({ badges }),
    tags: Object.keys(skill.tags ?? {}),
  };

  await ctx.scheduler.runAfter(0, internal.webhooks.sendDiscordWebhook, {
    event: "skill.highlighted",
    skill: payload,
  });
}
