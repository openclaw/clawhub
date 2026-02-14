import { afterEach, describe, expect, it, vi } from 'vitest'
import { __test, generateSkillSummary } from './skillSummary'

const originalFetch = globalThis.fetch

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  globalThis.fetch = originalFetch
})

describe('skillSummary', () => {
  it('normalizes and truncates noisy summaries', () => {
    const normalized = __test.normalizeSummary(`"  hello\n\nworld  "`)
    expect(normalized).toBe('hello world')
  })

  it('derives fallback from frontmatter description', () => {
    const fallback = __test.deriveSummaryFallback(`---\ndescription: Crisp summary.\n---\n# Title`)
    expect(fallback).toBe('Crisp summary.')
  })

  it('derives fallback from first meaningful body line', () => {
    const fallback = __test.deriveSummaryFallback(
      `---\ntitle: Demo\n---\n# Skill Title\n\n- Ship fast`,
    )
    expect(fallback).toBe('Skill Title')
  })

  it('returns existing summary without API call', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as typeof fetch

    const summary = await generateSkillSummary({
      slug: 'demo',
      displayName: 'Demo',
      readmeText: '# Demo',
      currentSummary: 'Existing summary',
    })

    expect(summary).toBe('Existing summary')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses identity fallback for empty content without API call', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as typeof fetch

    const summary = await generateSkillSummary({
      slug: 'empty-skill',
      displayName: 'Empty Skill',
      readmeText: '---\nname: empty-skill\n---\n',
    })

    expect(summary).toBe('Automation skill for Empty Skill.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses OpenAI when key is set and summary missing', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'AI summary output.' }],
          },
        ],
      }),
    }) as unknown as typeof fetch

    const summary = await generateSkillSummary({
      slug: 'demo',
      displayName: 'Demo',
      readmeText: '# Demo\n\nUseful helper.',
    })

    expect(summary).toBe('AI summary output.')
  })
})
