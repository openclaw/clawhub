import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { PublicSkill } from '../lib/publicUser'

type SkillCardProps = {
  skill: PublicSkill
  badge?: string | string[]
  chip?: string
  platformLabels?: string[]
  summaryFallback: string
  meta: ReactNode
  href?: string
}

export function SkillCard({ skill, badge, chip, platformLabels, summaryFallback, meta, href }: SkillCardProps) {
  const owner = encodeURIComponent(String(skill.ownerUserId))
  const link = href ?? `/${owner}/${skill.slug}`
  const badges = Array.isArray(badge) ? badge : badge ? [badge] : []
  const hasTags = badges.length || chip || platformLabels?.length

  return (
    <Link to={link} className="card skill-card">
      {hasTags ? (
        <div className="skill-card-tags">
          {badges.map((label) => (
            <div key={label} className="tag">
              {label}
            </div>
          ))}
          {chip ? <div className="tag tag-accent tag-compact">{chip}</div> : null}
          {platformLabels?.map((label) => (
            <div key={label} className="tag tag-compact">{label}</div>
          ))}
        </div>
      ) : null}
      <h3 className="skill-card-title">{skill.displayName}</h3>
      <p className="skill-card-summary">{skill.summary ?? summaryFallback}</p>
      <div className="skill-card-footer">{meta}</div>
    </Link>
  )
}
