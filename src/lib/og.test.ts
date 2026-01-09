import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSkillMeta, buildSoulMeta, fetchSkillMeta, fetchSoulMeta } from './og'

describe('og helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds metadata with owner and summary', () => {
    const meta = buildSkillMeta({
      slug: 'weather',
      owner: 'steipete',
      displayName: 'Weather',
      summary: 'Forecasts for your area.',
      version: '1.2.3',
    })
    expect(meta.title).toBe('Weather — ClawdHub')
    expect(meta.description).toBe('Forecasts for your area.')
    expect(meta.url).toContain('/steipete/weather')
    expect(meta.owner).toBe('steipete')
    expect(meta.image).toContain('/og/skill.png?')
    expect(meta.image).toContain('v=5')
    expect(meta.image).toContain('slug=weather')
    expect(meta.image).toContain('owner=steipete')
    expect(meta.image).toContain('version=1.2.3')
    expect(meta.image).not.toContain('title=')
    expect(meta.image).not.toContain('description=')
  })

  it('builds soul metadata with summary', () => {
    const meta = buildSoulMeta({
      slug: 'north-star',
      owner: 'someone',
      displayName: 'North Star',
      summary: 'Personal north star notes.',
      version: '0.1.0',
    })
    expect(meta.title).toBe('North Star — SoulHub')
    expect(meta.description).toBe('Personal north star notes.')
    expect(meta.url).toContain('/souls/north-star')
    expect(meta.owner).toBe('someone')
    expect(meta.image).toContain('/og/soul.png?')
    expect(meta.image).toContain('v=1')
    expect(meta.image).toContain('slug=north-star')
    expect(meta.image).toContain('owner=someone')
    expect(meta.image).toContain('version=0.1.0')
  })

  it('uses defaults when owner and summary are missing', () => {
    const meta = buildSkillMeta({ slug: 'parser' })
    expect(meta.title).toBe('parser — ClawdHub')
    expect(meta.description).toMatch(/ClawdHub — a fast skill registry/i)
    expect(meta.url).toContain('/skills/parser')
    expect(meta.owner).toBeNull()
    expect(meta.image).toContain('slug=parser')
  })

  it('uses soul defaults when owner and summary are missing', () => {
    const meta = buildSoulMeta({ slug: 'signal' })
    expect(meta.title).toBe('signal — SoulHub')
    expect(meta.description).toMatch(/SoulHub — the home for SOUL.md/i)
    expect(meta.url).toContain('/souls/signal')
    expect(meta.owner).toBeNull()
    expect(meta.image).toContain('slug=signal')
  })

  it('truncates long descriptions', () => {
    const longSummary = 'a'.repeat(240)
    const meta = buildSkillMeta({ slug: 'long', summary: longSummary })
    expect(meta.description.length).toBe(200)
    expect(meta.description.endsWith('…')).toBe(true)
  })

  it('fetches skill metadata when response is ok', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        skill: { displayName: 'Weather', summary: 'Forecasts' },
        owner: { handle: 'steipete' },
        latestVersion: { version: '1.2.3' },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const meta = await fetchSkillMeta('weather')
    expect(meta).toEqual({
      displayName: 'Weather',
      summary: 'Forecasts',
      owner: 'steipete',
      version: '1.2.3',
    })
  })

  it('fetches soul metadata when response is ok', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        soul: { displayName: 'North Star', summary: 'Signal' },
        owner: { handle: 'steipete' },
        latestVersion: { version: '0.1.0' },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const meta = await fetchSoulMeta('north-star')
    expect(meta).toEqual({
      displayName: 'North Star',
      summary: 'Signal',
      owner: 'steipete',
      version: '0.1.0',
    })
  })

  it('returns null when response is not ok', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }))
    vi.stubGlobal('fetch', fetchMock)

    const meta = await fetchSkillMeta('weather')
    expect(meta).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network')
    })
    vi.stubGlobal('fetch', fetchMock)

    const meta = await fetchSkillMeta('weather')
    expect(meta).toBeNull()
  })

  it('returns null when soul fetch throws', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network')
    })
    vi.stubGlobal('fetch', fetchMock)

    const meta = await fetchSoulMeta('north-star')
    expect(meta).toBeNull()
  })
})
