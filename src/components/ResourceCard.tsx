import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { PublicResource, PublicSkill, PublicSoul } from '../lib/publicUser'
import { getResourceBadge, getResourceLink, type ResourceType } from '../lib/resources'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Card } from './ui/card'

type ResourceCardProps = {
  type: ResourceType
  resource: PublicSkill | PublicSoul | PublicResource
  ownerHandle?: string | null
  summaryFallback: string
  meta: ReactNode
  badges?: string[]
  chip?: string
  href?: string
  className?: string
}

export function ResourceCard({
  type,
  resource,
  ownerHandle,
  summaryFallback,
  meta,
  badges,
  chip,
  href,
  className,
}: ResourceCardProps) {
  const link = href ?? getResourceLink(type, resource, resource.slug, ownerHandle ?? null)
  const resolvedBadges = badges ?? getResourceBadge(type, resource)

  return (
    <Link to={link} className={cn('h-full', className)}>
      <Card className="flex h-full flex-col gap-4 p-6 transition hover:border-primary/40 hover:bg-accent/30">
        {resolvedBadges.length || chip ? (
          <div className="flex flex-wrap gap-2">
            {resolvedBadges.map((label) => (
              <Badge key={label} variant="secondary">
                {label}
              </Badge>
            ))}
            {chip ? <Badge variant="accent">{chip}</Badge> : null}
          </div>
        ) : null}
        <div className="space-y-2">
          <h3 className="font-display text-lg font-semibold">{resource.displayName}</h3>
          <p className="text-sm text-muted-foreground">{resource.summary ?? summaryFallback}</p>
        </div>
        <div className="mt-auto text-xs text-muted-foreground">{meta}</div>
      </Card>
    </Link>
  )
}
