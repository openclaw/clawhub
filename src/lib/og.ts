import { getClawHubSiteUrl, getOnlyCrabsSiteUrl } from './site'

type SkillMetaSource = {
  slug: string
  owner?: string | null
  ownerId?: string | null
  displayName?: string | null
  summary?: string | null
  version?: string | null
}

type SkillMeta = {
  title: string
  description: string
  image: string
  url: string
  owner: string | null
}

type SoulMetaSource = {
  slug: string
  owner?: string | null
  displayName?: string | null
  summary?: string | null
  version?: string | null
}

type SoulMeta = {
  title: string
  description: string
  image: string
  url: string
  owner: string | null
}

const DEFAULT_DESCRIPTION = 'ClawHub — a fast skill registry for agents, with vector search.'
const DEFAULT_SOUL_DESCRIPTION = 'SoulHub — the home for SOUL.md bundles and personal system lore.'
const OG_SKILL_IMAGE_LAYOUT_VERSION = '5'
const OG_SOUL_IMAGE_LAYOUT_VERSION = '1'

export function getSiteUrl() {
  return getClawHubSiteUrl()
}

export function getSoulSiteUrl() {
  return getOnlyCrabsSiteUrl()
}

export function getApiBase() {
  const explicit = import.meta.env.VITE_CONVEX_SITE_URL?.trim()
  return explicit || getSiteUrl()
}

export async function fetchSkillMeta(slug: string) {
  try {
    const apiBase = getApiBase()
    const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}`, apiBase)
    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const payload = (await response.json()) as {
      skill?: { displayName?: string; summary?: string | null } | null
      owner?: { handle?: string | null; userId?: string | null } | null
      latestVersion?: { version?: string | null } | null
    }
    return {
      displayName: payload.skill?.displayName ?? null,
      summary: payload.skill?.summary ?? null,
      owner: payload.owner?.handle ?? null,
      ownerId: payload.owner?.userId ?? null,
      version: payload.latestVersion?.version ?? null,
    }
  } catch {
    return null
  }
}

export async function fetchSoulMeta(slug: string) {
  try {
    const apiBase = getApiBase()
    const url = new URL(`/api/v1/souls/${encodeURIComponent(slug)}`, apiBase)
    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const payload = (await response.json()) as {
      soul?: { displayName?: string; summary?: string | null } | null
      owner?: { handle?: string | null } | null
      latestVersion?: { version?: string | null } | null
    }
    return {
      displayName: payload.soul?.displayName ?? null,
      summary: payload.soul?.summary ?? null,
      owner: payload.owner?.handle ?? null,
      version: payload.latestVersion?.version ?? null,
    }
  } catch {
    return null
  }
}

export function buildSkillMeta(source: SkillMetaSource): SkillMeta {
  const siteUrl = getSiteUrl()
  const owner = clean(source.owner)
  const ownerId = clean(source.ownerId)
  const displayName = clean(source.displayName) || clean(source.slug)
  const summary = clean(source.summary)
  const version = clean(source.version)
  const title = `${displayName} — ClawHub`
  const description =
    summary || (owner ? `Agent skill by @${owner} on ClawHub.` : DEFAULT_DESCRIPTION)
  const ownerPath = owner || ownerId || 'unknown'
  const url = `${siteUrl}/${ownerPath}/${source.slug}`
  const imageParams = new URLSearchParams()
  imageParams.set('v', OG_SKILL_IMAGE_LAYOUT_VERSION)
  imageParams.set('slug', source.slug)
  if (owner) imageParams.set('owner', owner)
  if (version) imageParams.set('version', version)
  return {
    title,
    description: truncate(description, 200),
    image: `${siteUrl}/og/skill.png?${imageParams.toString()}`,
    url,
    owner: owner || null,
  }
}

export function buildSoulMeta(source: SoulMetaSource): SoulMeta {
  const siteUrl = getSoulSiteUrl()
  const owner = clean(source.owner)
  const displayName = clean(source.displayName) || clean(source.slug)
  const summary = clean(source.summary)
  const version = clean(source.version)
  const title = `${displayName} — SoulHub`
  const description =
    summary || (owner ? `Soul by @${owner} on SoulHub.` : DEFAULT_SOUL_DESCRIPTION)
  const url = `${siteUrl}/souls/${source.slug}`
  const imageParams = new URLSearchParams()
  imageParams.set('v', OG_SOUL_IMAGE_LAYOUT_VERSION)
  imageParams.set('slug', source.slug)
  if (owner) imageParams.set('owner', owner)
  if (version) imageParams.set('version', version)
  return {
    title,
    description: truncate(description, 200),
    image: `${siteUrl}/og/soul.png?${imageParams.toString()}`,
    url,
    owner: owner || null,
  }
}

function clean(value?: string | null) {
  return value?.trim() ?? ''
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trim()}…`
}
