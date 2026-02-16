export function UserBadge({ handle, displayName, image }: { handle?: string | null; displayName?: string | null; image?: string | null }) {
  return (
    <span className="user-badge">
      {image ? <img src={image} alt="" style={{ width: 20, height: 20, borderRadius: '50%', marginRight: 4 }} /> : null}
      <span>{displayName ?? handle ?? 'Unknown'}</span>
    </span>
  )
}
