import type { ReactNode } from 'react'
import { getSkillBadges } from '../lib/badges'
import type { PublicSkill } from '../lib/publicUser'
import { ResourceCard } from './ResourceCard'

type SkillCardProps = {
  skill: PublicSkill
  badge?: string | string[]
  chip?: string
  summaryFallback: string
  meta: ReactNode
  href?: string
  ownerHandle?: string | null
}

export function SkillCard({
  skill,
  badge,
  chip,
  summaryFallback,
  meta,
  href,
  ownerHandle,
}: SkillCardProps) {
  const badges = Array.isArray(badge) ? badge : badge ? [badge] : getSkillBadges(skill)

  return (
    <ResourceCard
      type="skill"
      resource={skill}
      ownerHandle={ownerHandle}
      summaryFallback={summaryFallback}
      meta={meta}
      badges={badges}
      chip={chip}
      href={href}
    />
  )
}
