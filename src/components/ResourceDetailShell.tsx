import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Card } from './ui/card'

type ResourceDetailShellProps = {
  title: string
  subtitle?: string
  badges?: string[]
  stats?: ReactNode
  ownerLine?: ReactNode
  actions?: ReactNode
  note?: ReactNode
  className?: string
}

export function ResourceDetailShell({
  title,
  subtitle,
  badges = [],
  stats,
  ownerLine,
  actions,
  note,
  className,
}: ResourceDetailShellProps) {
  return (
    <Card className={cn('p-6', className)}>
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <div className="space-y-1">
            <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
            {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {note ? <div className="text-sm text-muted-foreground">{note}</div> : null}
          {stats ? <div className="text-xs text-muted-foreground">{stats}</div> : null}
          {ownerLine ? <div className="text-xs text-muted-foreground">{ownerLine}</div> : null}
          {badges.length ? (
            <div className="flex flex-wrap gap-2">
              {badges.map((badge) => (
                <Badge key={badge} variant="secondary">
                  {badge}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-col gap-2 sm:flex-row">{actions}</div> : null}
      </div>
    </Card>
  )
}
