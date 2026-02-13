import { describe, expect, it } from 'vitest'
import { buildSkillOgSvg } from './skillOgSvg'

describe('skill OG SVG', () => {
  it('includes title, description, and labels', () => {
    const svg = buildSkillOgSvg({
      markDataUrl: 'data:image/png;base64,AAA=',
      title: 'Discord Doctor',
      description: 'Quick diagnosis and repair for Discord bot.',
      ownerLabel: '@jhillock',
      versionLabel: 'v1.2.3',
      footer: 'clawhub.ai/jhillock/discord-doctor',
    })

    expect(svg).toContain('Discord Doctor')
    expect(svg).toContain('Quick diagnosis and repair')
    expect(svg).toContain('@jhillock')
    expect(svg).toContain('v1.2.3')
    expect(svg).toContain('clawhub.ai/jhillock/discord-doctor')
  })

  it('wraps long titles to avoid clipping', () => {
    const svg = buildSkillOgSvg({
      markDataUrl: 'data:image/png;base64,AAA=',
      title: 'Excalidraw Flowchart',
      description: 'Create Excalidraw flowcharts from descriptions.',
      ownerLabel: '@swiftlysisngh',
      versionLabel: 'v1.0.2',
      footer: 'clawhub.ai/swiftlysisngh/excalidraw-flowchart',
    })

    const titleBlock = svg.match(/<text[^>]*font-weight="800"[\s\S]*?<\/text>/)?.[0] ?? ''
    const titleTspans = titleBlock.match(/<tspan /g) ?? []
    expect(titleTspans.length).toBe(2)
    expect(svg).toContain('Excalidraw')
    expect(svg).toContain('Flowchart')
  })

  it('clips and wraps long descriptions', () => {
    const longWord = 'a'.repeat(200)
    const svg = buildSkillOgSvg({
      markDataUrl: 'data:image/png;base64,AAA=',
      title: 'Gurkerlcli',
      description: `Prefix ${longWord} suffix`,
      ownerLabel: '@pasogott',
      versionLabel: 'v0.1.0',
      footer: 'clawhub.ai/pasogott/gurkerlcli',
    })

    expect(svg).toContain('<clipPath id="cardClip">')
    expect(svg).toContain('clip-path="url(#cardClip)"')
    expect(svg).not.toContain(longWord)
    expect(svg).toContain('…')

    const descBlock = svg.match(/<text[^>]*font-size="26"[\s\S]*?<\/text>/)?.[0] ?? ''
    const descTspans = descBlock.match(/<tspan /g) ?? []
    expect(descTspans.length).toBeLessThanOrEqual(3)
  })
})
