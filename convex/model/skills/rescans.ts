import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { OwnedResourceActor } from "../../lib/publishers";

export async function getLatestSkillRescanTarget(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  skillId: Id<"skills">,
) {
  const skill = await ctx.db.get(skillId);
  if (!skill || skill.softDeletedAt) throw new ConvexError("Skill not found");
  if (!skill.latestVersionId) throw new ConvexError("Skill has no published version");
  const version = await ctx.db.get(skill.latestVersionId);
  if (!version || version.softDeletedAt) throw new ConvexError("Latest skill version not found");
  return { skill, version };
}

export async function insertSkillRescanRequest(
  ctx: Pick<MutationCtx, "db">,
  actor: OwnedResourceActor,
  target: {
    skill: Doc<"skills">;
    version: Doc<"skillVersions">;
  },
) {
  const now = Date.now();
  return await ctx.db.insert("rescanRequests", {
    targetKind: "skill",
    skillId: target.skill._id,
    skillVersionId: target.version._id,
    targetVersion: target.version.version,
    requestedByUserId: actor._id,
    ownerUserId: target.skill.ownerUserId,
    ownerPublisherId: target.skill.ownerPublisherId,
    status: "in_progress",
    createdAt: now,
    updatedAt: now,
  });
}
