/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  detectSiteMode,
  detectSiteModeFromUrl,
  getClawHubSiteUrl,
  getOnlyCrabsHost,
  getOnlyCrabsSiteUrl,
  getSiteDescription,
  getSiteMode,
  getSiteName,
  getSiteUrlForMode,
} from './site'

function withMetaEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const env = import.meta.env as unknown as Record<string, unknown>
  const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, env[key])
    if (value === undefined) {
      delete env[key]
    } else {
      env[key] = value
    }
  }
  try {
    return run()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete env[key]
      else env[key] = value
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('site helpers', () => {
  it('returns default and env configured site URLs', () => {
    expect(getClawHubSiteUrl()).toBe('https://clawhub.ai')
    withMetaEnv({ VITE_SITE_URL: 'https://example.com' }, () => {
      expect(getClawHubSiteUrl()).toBe('https://example.com')
    })
    withMetaEnv({ VITE_SITE_URL: 'https://clawdhub.com' }, () => {
      expect(getClawHubSiteUrl()).toBe('https://clawhub.ai')
    })
    withMetaEnv({ VITE_SITE_URL: 'https://auth.clawhub.com' }, () => {
      expect(getClawHubSiteUrl()).toBe('https://clawhub.ai')
    })
  })

  it('picks SoulHub URL from explicit env', () => {
    withMetaEnv({ VITE_SOULHUB_SITE_URL: 'https://souls.example.com' }, () => {
      expect(getOnlyCrabsSiteUrl()).toBe('https://souls.example.com')
    })
  })

  it('derives SoulHub URL from local VITE_SITE_URL', () => {
    withMetaEnv({ VITE_SITE_URL: 'http://localhost:3000' }, () => {
      expect(getOnlyCrabsSiteUrl()).toBe('http://localhost:3000')
    })
    withMetaEnv({ VITE_SITE_URL: 'http://127.0.0.1:3000' }, () => {
      expect(getOnlyCrabsSiteUrl()).toBe('http://127.0.0.1:3000')
    })
    withMetaEnv({ VITE_SITE_URL: 'http://0.0.0.0:3000' }, () => {
      expect(getOnlyCrabsSiteUrl()).toBe('http://0.0.0.0:3000')
    })
  })

  it('falls back to default SoulHub URL for invalid VITE_SITE_URL', () => {
    withMetaEnv({ VITE_SITE_URL: 'not a url' }, () => {
      expect(getOnlyCrabsSiteUrl()).toBe('https://onlycrabs.ai')
    })
  })

  it('detects site mode from host and URLs', () => {
    expect(detectSiteMode(null)).toBe('skills')

    withMetaEnv({ VITE_SOULHUB_HOST: 'souls.example.com' }, () => {
      expect(getOnlyCrabsHost()).toBe('souls.example.com')
      expect(detectSiteMode('souls.example.com')).toBe('souls')
      expect(detectSiteMode('sub.souls.example.com')).toBe('souls')
      expect(detectSiteMode('clawhub.ai')).toBe('skills')

      expect(detectSiteModeFromUrl('https://souls.example.com/x')).toBe('souls')
      expect(detectSiteModeFromUrl('souls.example.com')).toBe('souls')
      expect(detectSiteModeFromUrl('https://clawhub.ai')).toBe('skills')
    })
  })

  it('detects site mode from window when available', () => {
    withMetaEnv({ VITE_SOULHUB_HOST: 'onlycrabs.ai' }, () => {
      vi.stubGlobal('window', { location: { hostname: 'onlycrabs.ai' } } as unknown as Window)
      expect(getSiteMode()).toBe('souls')
    })
  })

  it('detects site mode from env on the server', () => {
    withMetaEnv({ VITE_SITE_MODE: 'souls', VITE_SOULHUB_HOST: 'onlycrabs.ai' }, () => {
      expect(getSiteMode()).toBe('souls')
    })
    withMetaEnv({ VITE_SITE_MODE: 'skills', VITE_SOULHUB_HOST: 'onlycrabs.ai' }, () => {
      expect(getSiteMode()).toBe('skills')
    })
  })

  it('detects site mode from VITE_SOULHUB_SITE_URL and SITE_URL fallback', () => {
    withMetaEnv(
      { VITE_SITE_MODE: undefined, VITE_SOULHUB_SITE_URL: 'https://onlycrabs.ai' },
      () => {
        expect(getSiteMode()).toBe('souls')
      },
    )

    withMetaEnv({ VITE_SOULHUB_SITE_URL: undefined, VITE_SITE_URL: undefined }, () => {
      vi.stubEnv('SITE_URL', 'https://onlycrabs.ai')
      expect(getSiteMode()).toBe('souls')
    })
  })

  it('derives site metadata from mode', () => {
    expect(getSiteName('skills')).toBe('ClawHub')
    expect(getSiteName('souls')).toBe('SoulHub')

    expect(getSiteDescription('skills')).toContain('ClawHub')
    expect(getSiteDescription('souls')).toContain('SoulHub')

    expect(getSiteUrlForMode('skills')).toBe('https://clawhub.ai')
    expect(getSiteUrlForMode('souls')).toBe('https://onlycrabs.ai')
  })
})
