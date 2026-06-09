import type { Doc, Id } from "../../convex/_generated/dataModel";

type BadgeKind = Doc<"skillBadges">["kind"];

type SkillBadgeMap = Partial<Record<BadgeKind, { byUserId: Id<"users">; at: number }>>;

type SkillLike = { badges?: SkillBadgeMap | null };
type OwnerLike = { official?: boolean | null };

type BadgeLabel = "Deprecated" | "Official";

export function isSkillHighlighted(skill: SkillLike) {
  return Boolean(skill.badges?.highlighted);
}

export function isSkillOfficial(skill: SkillLike, owner?: OwnerLike | null) {
  return Boolean(skill.badges?.official || owner?.official === true);
}

export function isSkillDeprecated(skill: SkillLike) {
  return Boolean(skill.badges?.deprecated);
}

export function getSkillBadges(skill: SkillLike, owner?: OwnerLike | null): BadgeLabel[] {
  const badges: BadgeLabel[] = [];
  if (isSkillDeprecated(skill)) badges.push("Deprecated");
  if (isSkillOfficial(skill, owner)) badges.push("Official");
  return badges;
}
