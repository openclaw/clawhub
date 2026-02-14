import type { Doc, Id } from '../../convex/_generated/dataModel'

type BadgeKind = Doc<'skillBadges'>['kind']

type SkillBadgeMap = Partial<Record<BadgeKind, { byUserId: Id<'users'>; at: number }>>

type SkillLike = { badges?: SkillBadgeMap | null }

type BadgeLabel = 'Deprecated' | 'Official' | 'Highlighted'

export function isSkillHighlighted(skill: SkillLike) {
  return Boolean(skill.badges?.highlighted)
}

export function isSkillOfficial(skill: SkillLike) {
  return Boolean(skill.badges?.official)
}

export function isSkillDeprecated(skill: SkillLike) {
  return Boolean(skill.badges?.deprecated)
}

export function getSkillBadges(skill: SkillLike): BadgeLabel[] {
  const badges: BadgeLabel[] = []
  if (isSkillDeprecated(skill)) badges.push('Deprecated')
  if (isSkillOfficial(skill)) badges.push('Official')
  if (isSkillHighlighted(skill)) badges.push('Highlighted')
  return badges
}
