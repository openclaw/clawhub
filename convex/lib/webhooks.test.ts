/* @vitest-environment node */
import { afterEach, describe, expect, it } from 'vitest'
import { buildDiscordPayload, buildSkillUrl, getWebhookConfig, shouldSendWebhook } from './webhooks'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('webhook config', () => {
  it('parses highlighted-only flag', () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://example.com'
    process.env.DISCORD_WEBHOOK_HIGHLIGHTED_ONLY = 'true'
    const config = getWebhookConfig()
    expect(config.highlightedOnly).toBe(true)
  })

  it('defaults site url when missing', () => {
    delete process.env.SITE_URL
    process.env.DISCORD_WEBHOOK_URL = 'https://example.com'
    const config = getWebhookConfig()
    expect(config.siteUrl).toBe('https://clawhub.ai')
  })
})

describe('webhook filtering', () => {
  it('skips when url missing', () => {
    const config = getWebhookConfig({} as NodeJS.ProcessEnv)
    expect(shouldSendWebhook('skill.publish', { slug: 'demo', displayName: 'Demo' }, config)).toBe(
      false,
    )
  })

  it('filters non-highlighted when highlighted-only', () => {
    const config = {
      url: 'https://example.com',
      highlightedOnly: true,
      siteUrl: 'https://clawhub.ai',
    }
    const allowed = shouldSendWebhook(
      'skill.publish',
      { slug: 'demo', displayName: 'Demo', highlighted: false },
      config,
    )
    expect(allowed).toBe(false)
  })

  it('allows highlighted event when highlighted-only', () => {
    const config = {
      url: 'https://example.com',
      highlightedOnly: true,
      siteUrl: 'https://clawhub.ai',
    }
    const allowed = shouldSendWebhook(
      'skill.highlighted',
      { slug: 'demo', displayName: 'Demo', highlighted: true },
      config,
    )
    expect(allowed).toBe(true)
  })
})

describe('payload building', () => {
  it('builds canonical url with owner', () => {
    const url = buildSkillUrl(
      { slug: 'beeper', displayName: 'Beeper', ownerHandle: 'KrauseFx' },
      'https://clawhub.ai',
    )
    expect(url).toBe('https://clawhub.ai/KrauseFx/beeper')
  })

  it('builds a publish embed', () => {
    const payload = buildDiscordPayload(
      'skill.publish',
      {
        slug: 'demo',
        displayName: 'Demo Skill',
        summary: 'Nice skill',
        version: '1.2.3',
        ownerHandle: 'steipete',
        tags: ['latest', 'discord'],
      },
      { url: 'https://example.com', highlightedOnly: false, siteUrl: 'https://clawhub.ai' },
    )
    const embed = payload.embeds[0]
    expect(embed.title).toBe('Demo Skill')
    expect(embed.description).toBe('Nice skill')
    expect(embed.fields[0].value).toBe('v1.2.3')
  })
})
