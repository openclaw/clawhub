import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { PublicResource, PublicSkill, PublicSoul } from '../lib/publicUser'
import { getResourceBadge, getResourceLink, type ResourceType } from '../lib/resources'
import { Badge } from './ui/badge'

type ResourceListRowProps = {
  type: ResourceType
  resource: PublicSkill | PublicSoul | PublicResource
  ownerHandle?: string | null
  summaryFallback: string
  meta?: ReactNode
  badges?: string[]
  chip?: string
  href?: string
}

export function ResourceListRow({
  type,
  resource,
  ownerHandle,
  summaryFallback,
  meta,
  badges,
  chip,
  href,
}: ResourceListRowProps) {
  const link = href ?? getResourceLink(type, resource, resource.slug, ownerHandle ?? null)
  const resolvedBadges = badges ?? getResourceBadge(type, resource)

  return (
    <Link
      to={link}
      className="flex flex-col gap-3 rounded-[var(--radius)] border border-border bg-card p-4 transition hover:border-primary/40 hover:bg-accent/30"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <span className="font-display">{resource.displayName}</span>
        <span className="text-xs text-muted-foreground">/{resource.slug}</span>
        {resolvedBadges.map((badge) => (
          <Badge key={badge} variant="secondary">
            {badge}
          </Badge>
        ))}
        {chip ? <Badge variant="accent">{chip}</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">{resource.summary ?? summaryFallback}</p>
      {meta ? <div className="text-xs text-muted-foreground">{meta}</div> : null}
    </Link>
  )
}
