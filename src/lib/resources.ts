import { getResourceBadges } from './badges'
import type { PublicResource, PublicSkill, PublicSoul } from './publicUser'

export type ResourceType = 'skill' | 'soul' | 'extension'

type ResourceOwnerSource = {
  ownerUserId?: string | null
  ownerHandle?: string | null
}

type ResourceSource =
  | PublicSkill
  | PublicSoul
  | PublicResource
  | ResourceOwnerSource
  | null
  | undefined

export function getResourceLabel(type: ResourceType, options?: { plural?: boolean }) {
  const plural = options?.plural ?? false
  switch (type) {
    case 'soul':
      return plural ? 'Souls' : 'Soul'
    case 'extension':
      return plural ? 'Extensions' : 'Extension'
    default:
      return plural ? 'Skills' : 'Skill'
  }
}

export function getResourceOwner(resource: ResourceSource, ownerHandle?: string | null) {
  const resourceHandle = resource && 'ownerHandle' in resource ? resource.ownerHandle : undefined
  const handle = ownerHandle?.trim() || resourceHandle?.trim()
  if (handle) return handle
  const ownerId = resource?.ownerUserId ? String(resource.ownerUserId) : null
  return ownerId ?? 'unknown'
}

export function toCanonicalResourcePath(type: ResourceType, owner: string, slug: string) {
  const safeOwner = encodeURIComponent(owner)
  const safeSlug = encodeURIComponent(slug)
  switch (type) {
    case 'soul':
      return `/souls/${safeOwner}/${safeSlug}`
    case 'extension':
      return `/extensions/${safeOwner}/${safeSlug}`
    default:
      return `/skills/${safeOwner}/${safeSlug}`
  }
}

export function getResourceLink(
  type: ResourceType,
  resource: ResourceSource,
  slug: string,
  ownerHandle?: string | null,
) {
  const owner = getResourceOwner(resource, ownerHandle)
  return toCanonicalResourcePath(type, owner, slug)
}

export function getResourceBadge(_type: ResourceType, resource: ResourceSource) {
  if (resource && 'badges' in resource) {
    return getResourceBadges(resource)
  }
  return [] as string[]
}
