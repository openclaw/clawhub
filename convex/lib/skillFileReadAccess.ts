import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getOptionalActiveAuthUserIdFromAction } from "./access";
import { toPublicSkill } from "./public";
import { isPublicSkillVersionAvailableForSkill } from "./skillFileAccess";

export async function canReadSkillVersionFiles(ctx: ActionCtx, version: Doc<"skillVersions">) {
  const skill = (await ctx.runQuery(internal.skillFileReads.getSkillByIdInternal, {
    skillId: version.skillId,
  })) as Doc<"skills"> | null;
  if (!skill) return false;

  const authUserId = await getOptionalActiveAuthUserIdFromAction(ctx);
  if (authUserId) {
    if (
      !skill.ownerPublisherId &&
      skill.ownerUserId === authUserId &&
      !skill.softDeletedAt &&
      !version.softDeletedAt
    ) {
      return true;
    }
    if (skill.ownerPublisherId && !skill.softDeletedAt && !version.softDeletedAt) {
      const canAccessOwnerScope = (await ctx.runQuery(
        internal.publishers.canAccessOwnerScopeInternal,
        {
          publisherId: skill.ownerPublisherId,
          userId: authUserId,
          allowedPublisherRoles: ["publisher"],
          legacyOwnerUserId: skill.ownerUserId,
        },
      )) as boolean;
      if (canAccessOwnerScope) {
        return true;
      }
    }
    const actor = (await ctx.runQuery(internal.users.getByIdInternal, {
      userId: authUserId,
    })) as Doc<"users"> | null;
    if (actor?.role === "admin" || actor?.role === "moderator") return true;
  }

  if (skill.softDeletedAt || version.softDeletedAt) return false;

  return Boolean(toPublicSkill(skill)) && isPublicSkillVersionAvailableForSkill(version, skill._id);
}
