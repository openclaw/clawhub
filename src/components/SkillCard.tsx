import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { PublicSkill } from '../lib/publicUser'

type SkillCardProps = {
  skill: PublicSkill
  badge?: string | string[]
  chip?: string
  summaryFallback: string
  meta: ReactNode
  href?: string
}

export function SkillCard({ skill, badge, chip, summaryFallback, meta, href }: SkillCardProps) {
  const owner = encodeURIComponent(String(skill.ownerUserId))
  const link = href ?? `/${owner}/${skill.slug}`
  const badges = Array.isArray(badge) ? badge : badge ? [badge] : []

  return (
    <Link to={link} className="card skill-card">
      {badges.length || chip ? (
        <div className="skill-card-tags">
          {badges.map((label) => (
            <div key={label} className="tag">
              {label}
            </div>
          ))}
          {chip ? <div className="tag tag-accent tag-compact">{chip}</div> : null}
        </div>
      ) : null}
      <h3 className="skill-card-title">{skill.displayName}</h3>
      <p className="skill-card-summary">{skill.summary ?? summaryFallback}</p>
      <div className="skill-card-footer">{meta}</div>
    </Link>
  )
}
