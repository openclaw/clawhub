export type SiteMode = 'skills' | 'souls'

const DEFAULT_CLAWHUB_SITE_URL = 'https://clawhub.ai'
const DEFAULT_ONLYCRABS_SITE_URL = 'https://onlycrabs.ai'
const DEFAULT_ONLYCRABS_HOST = 'onlycrabs.ai'
const LEGACY_CLAWDHUB_HOSTS = new Set(['clawdhub.com', 'www.clawdhub.com', 'auth.clawdhub.com'])

export function normalizeClawHubSiteOrigin(value?: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (LEGACY_CLAWDHUB_HOSTS.has(url.hostname.toLowerCase())) {
      return DEFAULT_CLAWHUB_SITE_URL
    }
    return url.origin
  } catch {
    return null
  }
}

export function getClawHubSiteUrl() {
  return normalizeClawHubSiteOrigin(import.meta.env.VITE_SITE_URL) ?? DEFAULT_CLAWHUB_SITE_URL
}

export function getOnlyCrabsSiteUrl() {
  const explicit = import.meta.env.VITE_SOULHUB_SITE_URL
  if (explicit) return explicit

  const siteUrl = import.meta.env.VITE_SITE_URL
  if (siteUrl) {
    try {
      const url = new URL(siteUrl)
      if (
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '0.0.0.0'
      ) {
        return url.origin
      }
    } catch {
      // ignore invalid URLs, fall through to default
    }
  }

  return DEFAULT_ONLYCRABS_SITE_URL
}

export function getOnlyCrabsHost() {
  return import.meta.env.VITE_SOULHUB_HOST ?? DEFAULT_ONLYCRABS_HOST
}

export function detectSiteMode(host?: string | null): SiteMode {
  if (!host) return 'skills'
  const onlyCrabsHost = getOnlyCrabsHost().toLowerCase()
  const lower = host.toLowerCase()
  if (lower === onlyCrabsHost || lower.endsWith(`.${onlyCrabsHost}`)) return 'souls'
  return 'skills'
}

export function detectSiteModeFromUrl(value?: string | null): SiteMode {
  if (!value) return 'skills'
  try {
    const host = new URL(value).hostname
    return detectSiteMode(host)
  } catch {
    return detectSiteMode(value)
  }
}

export function getSiteMode(): SiteMode {
  if (typeof window !== 'undefined') {
    return detectSiteMode(window.location.hostname)
  }
  const forced = import.meta.env.VITE_SITE_MODE
  if (forced === 'souls' || forced === 'skills') return forced

  const onlyCrabsSite = import.meta.env.VITE_SOULHUB_SITE_URL
  if (onlyCrabsSite) return detectSiteModeFromUrl(onlyCrabsSite)

  const siteUrl = import.meta.env.VITE_SITE_URL ?? process.env.SITE_URL
  if (siteUrl) return detectSiteModeFromUrl(siteUrl)

  return 'skills'
}

export function getSiteName(mode: SiteMode = getSiteMode()) {
  return mode === 'souls' ? 'SoulHub' : 'ClawHub'
}

export function getSiteDescription(mode: SiteMode = getSiteMode()) {
  return mode === 'souls'
    ? 'SoulHub — the home for SOUL.md bundles and personal system lore.'
    : 'ClawHub — a fast skill registry for agents, with vector search.'
}

export function getSiteUrlForMode(mode: SiteMode = getSiteMode()) {
  return mode === 'souls' ? getOnlyCrabsSiteUrl() : getClawHubSiteUrl()
}
