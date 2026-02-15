import type { PublicUser } from '../lib/publicUser'

type UserBadgeProps = {
  user: PublicUser | null | undefined
  fallbackHandle?: string | null
  prefix?: string
  size?: 'sm' | 'md'
}

export function UserBadge({ user, fallbackHandle, prefix = 'by', size = 'sm' }: UserBadgeProps) {
  const handle = user?.handle ?? user?.name ?? fallbackHandle ?? null
  const href = user?.handle ? `/u/${encodeURIComponent(user.handle)}` : null
  const label = handle ? `@${handle}` : 'user'
  const image = user?.image ?? null
  const initial = (user?.displayName ?? user?.name ?? handle ?? 'u').charAt(0).toUpperCase()

  return (
    <span className={`user-badge user-badge-${size}`}>
      {prefix ? <span className="user-badge-prefix">{prefix}</span> : null}
      <span className="user-avatar" aria-hidden="true">
        {image ? (
          <img className="user-avatar-img" src={image} alt="" loading="lazy" />
        ) : (
          <span className="user-avatar-fallback">{initial}</span>
        )}
      </span>
      {href ? (
        <a className="user-handle" href={href}>
          {label}
        </a>
      ) : (
        <span className="user-handle">{label}</span>
      )}
    </span>
  )
}

