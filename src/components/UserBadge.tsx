import type { PublicUser } from '../lib/publicUser'

type UserBadgeProps = {
  user: PublicUser | null | undefined
  fallbackHandle?: string | null
  prefix?: string
  size?: 'sm' | 'md'
  link?: boolean
  showName?: boolean
}

export function UserBadge({
  user,
  fallbackHandle,
  prefix = 'by',
  size = 'sm',
  link = true,
  showName = false,
}: UserBadgeProps) {
  const handle = user?.handle ?? user?.name ?? fallbackHandle ?? null
  const href = user?.handle ? `/u/${encodeURIComponent(user.handle)}` : null
  const label = handle ? `@${handle}` : 'user'
  const image = user?.image ?? null
  const displayName = user?.displayName?.trim() || null
  const hasUsefulName =
    showName && Boolean(displayName) && Boolean(handle) && displayName!.toLowerCase() !== handle!.toLowerCase()
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
      {hasUsefulName ? (
        <>
          <span className="user-name">{displayName}</span>
          <span className="user-name-sep" aria-hidden="true">
            ·
          </span>
        </>
      ) : null}
      {link && href ? (
        <a className="user-handle" href={href}>
          {label}
        </a>
      ) : (
        <span className="user-handle">{label}</span>
      )}
    </span>
  )
}
