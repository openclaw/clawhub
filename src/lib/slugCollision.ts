type SlugResult = {
  skill: {
    slug: string
    ownerUserId: string
  } | null
  owner: {
    handle?: string | null
    _id?: string | null
  } | null
} | null

export type PublicSlugCollision = {
  message: string
  url: string | null
}

function buildSkillUrl(ownerHandle: string | null | undefined, ownerId: string | null | undefined, slug: string) {
  const owner = ownerHandle?.trim() || ownerId || null
  if (!owner) return null
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`
}

export function getPublicSlugCollision(params: {
  isSoulMode: boolean
  slug: string
  meUserId?: string | null
  result: SlugResult | undefined
}): PublicSlugCollision | null {
  if (params.isSoulMode) return null
  if (!params.meUserId) return null
  const normalizedSlug = params.slug.trim().toLowerCase()
  if (!normalizedSlug) return null
  if (!params.result?.skill) return null
  if (params.meUserId && params.result.skill.ownerUserId === params.meUserId) return null

  const url = buildSkillUrl(
    params.result.owner?.handle ?? null,
    params.result.owner?._id ?? null,
    params.result.skill.slug,
  )
  if (!url) {
    return { message: 'Slug is already taken. Choose a different slug.', url: null }
  }
  return { message: 'Slug is already taken. Choose a different slug.', url }
}
