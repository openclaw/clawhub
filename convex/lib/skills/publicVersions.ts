import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { isPublicSkillDoc } from "../globalStats";
import { toPublicPublisher } from "../public";
import { getOwnerPublisher } from "../publishers";
import {
  isPublishedSkillVersion,
  isPublicSkillVersionAvailableForSkill,
  isSkillVersionForSkill,
} from "../skillFileAccess";

export type PublicSkillVersionSelection =
  | { status: "available"; skill: Doc<"skills">; version: Doc<"skillVersions"> }
  | { status: "not_found" | "deleted" };

type SkillVersionSelector = {
  skillId: Id<"skills">;
  versionId?: Id<"skillVersions">;
  version?: string;
  tag?: string;
};

function checkPublicVersionSelection(
  skill: Doc<"skills"> | null,
  version: Doc<"skillVersions"> | null,
): PublicSkillVersionSelection {
  if (!skill || skill.softDeletedAt) return { status: "not_found" };
  if (
    !version ||
    !isSkillVersionForSkill(version, skill._id) ||
    !isPublishedSkillVersion(version)
  ) {
    return { status: "not_found" };
  }
  // Withheld publications stay undiscoverable even if also marked deleted.
  if (version.softDeletedAt || version.ownerDeletedAt !== undefined) return { status: "deleted" };
  if (!isPublicSkillVersionAvailableForSkill(version, skill._id)) return { status: "not_found" };
  return { status: "available", skill, version };
}

/**
 * Checked publication selection, not viewer authorization or installability.
 * Callers retain their parent visibility policy and apply metadata/download
 * moderation to the returned current parent. Raw reads remain for owner previews.
 */
export async function readPublicSkillVersion(
  ctx: Pick<QueryCtx, "db">,
  selector: SkillVersionSelector,
): Promise<PublicSkillVersionSelection> {
  const skill = await ctx.db.get(selector.skillId);
  if (!skill || skill.softDeletedAt) return { status: "not_found" };
  let version: Doc<"skillVersions"> | null;
  if (selector.versionId !== undefined) {
    version = await ctx.db.get(selector.versionId);
  } else if (selector.version !== undefined) {
    version = await ctx.db
      .query("skillVersions")
      .withIndex("by_skill_version", (q) =>
        q.eq("skillId", skill._id).eq("version", selector.version!),
      )
      .unique();
  } else {
    const versionId =
      selector.tag !== undefined
        ? skill.tags[selector.tag]
        : (skill.latestVersionId ?? skill.tags.latest);
    version = versionId ? await ctx.db.get(versionId) : null;
  }
  return checkPublicVersionSelection(skill, version);
}

export async function readPublicSkillVersionSelections(
  ctx: Pick<QueryCtx, "db">,
  selections: Array<{ skillId: Id<"skills">; versionId: Id<"skillVersions"> }>,
): Promise<PublicSkillVersionSelection[]> {
  const skillIds = [...new Set(selections.map((selection) => selection.skillId))];
  const versionIds = [...new Set(selections.map((selection) => selection.versionId))];
  const [skills, versions] = await Promise.all([
    Promise.all(skillIds.map((id) => ctx.db.get(id))),
    Promise.all(versionIds.map((id) => ctx.db.get(id))),
  ]);
  const skillMap = new Map(skillIds.map((id, index) => [id, skills[index] ?? null]));
  const versionMap = new Map(versionIds.map((id, index) => [id, versions[index] ?? null]));
  return selections.map(({ skillId, versionId }) =>
    checkPublicVersionSelection(skillMap.get(skillId) ?? null, versionMap.get(versionId) ?? null),
  );
}

/** Existing metadata inspection policy: retain malware transparency, never bytes. */
export async function getPublicSkillMetadataOwner(
  ctx: Pick<QueryCtx, "db">,
  skill: Doc<"skills"> | null,
) {
  if (!skill || skill.softDeletedAt) return null;
  const isMalwareBlocked =
    skill.moderationVerdict === "malicious" ||
    (skill.moderationFlags?.includes("blocked.malware") ?? false);
  if (!isMalwareBlocked && !isPublicSkillDoc(skill)) return null;
  return toPublicPublisher(
    await getOwnerPublisher(ctx, {
      ownerPublisherId: skill.ownerPublisherId,
      ownerUserId: skill.ownerUserId,
    }),
  );
}
