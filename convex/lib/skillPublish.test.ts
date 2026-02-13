import { describe, expect, it } from 'vitest'
import { __test } from './skillPublish'

describe('skillPublish', () => {
  it('merges github source into metadata', () => {
    const merged = __test.mergeSourceIntoMetadata(
      { clawdis: { emoji: 'x' } },
      {
        kind: 'github',
        url: 'https://github.com/a/b',
        repo: 'a/b',
        ref: 'main',
        commit: '0123456789012345678901234567890123456789',
        path: 'skills/demo',
        importedAt: 123,
      },
    )
    expect((merged as Record<string, unknown>).clawdis).toEqual({ emoji: 'x' })
    const source = (merged as Record<string, unknown>).source
    expect(source).toEqual(
      expect.objectContaining({
        kind: 'github',
        repo: 'a/b',
        path: 'skills/demo',
      }),
    )
  })

  it('rejects thin templated skill content for low-trust publishers', () => {
    const signals = __test.computeQualitySignals({
      readmeText: `---
description: Expert guidance for sushi-rolls.
---
# Sushi Rolls
## Getting Started
- Step-by-step tutorials
- Tips and techniques
- Project ideas
`,
      summary: 'Expert guidance for sushi-rolls.',
    })

    const quality = __test.evaluateQuality({
      signals,
      trustTier: 'low',
      similarRecentCount: 0,
    })

    expect(quality.decision).toBe('reject')
  })

  it('rejects repetitive structural spam bursts', () => {
    const signals = __test.computeQualitySignals({
      readmeText: `# Kitchen Workflow
## Mise en place
- Gather ingredients and check freshness for each item before prep starts.
- Prepare utensils and containers so every step can be executed smoothly.
- Keep notes on ingredient substitutions and expected flavor impact.
## Rolling flow
- Build rolls in small batches, taste often, and adjust seasoning carefully.
- Track timing, texture, and shape consistency to avoid rushed mistakes.
- Capture what worked and what failed so the next run is more reliable.
## Service checklist
- Plate with clear labels, cleaning steps, and handoff instructions.
- Include safety notes, storage guidance, and quality checkpoints.
- Document outcomes and follow-up improvements for the next iteration.
`,
      summary: 'Detailed sushi workflow notes.',
    })

    const quality = __test.evaluateQuality({
      signals,
      trustTier: 'low',
      similarRecentCount: 5,
    })

    expect(quality.decision).toBe('reject')
    expect(quality.reason).toContain('template spam')
  })
})
