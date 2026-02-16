import { describe, expect, it } from 'vitest'
import {
  formatCompactStat,
  formatSkillStatsTriplet,
  formatSoulStatsTriplet,
  type SkillStatsTriplet,
  type SoulStatsTriplet,
} from './numberFormat'

describe('formatCompactStat', () => {
  it('keeps small values as whole numbers', () => {
    expect(formatCompactStat(0)).toBe('0')
    expect(formatCompactStat(999)).toBe('999')
  })

  it('formats thousands with lowercase k', () => {
    expect(formatCompactStat(1_000)).toBe('1k')
    expect(formatCompactStat(1_250)).toBe('1.3k')
    expect(formatCompactStat(23_683)).toBe('23.7k')
    expect(formatCompactStat(236_830)).toBe('237k')
  })

  it('formats millions with uppercase M', () => {
    expect(formatCompactStat(1_000_000)).toBe('1M')
    expect(formatCompactStat(2_360_000)).toBe('2.4M')
    expect(formatCompactStat(23_683_000)).toBe('23.7M')
  })

  it('carries rounded thousands into millions', () => {
    expect(formatCompactStat(999_499)).toBe('999k')
    expect(formatCompactStat(999_500)).toBe('1M')
    expect(formatCompactStat(999_949)).toBe('1M')
    expect(formatCompactStat(-999_499)).toBe('-999k')
    expect(formatCompactStat(-999_500)).toBe('-1M')
    expect(formatCompactStat(-999_949)).toBe('-1M')
  })

  it('preserves sign for negative values', () => {
    expect(formatCompactStat(-1_500)).toBe('-1.5k')
    expect(formatCompactStat(-2_500_000)).toBe('-2.5M')
  })
})

describe('stats triplet formatters', () => {
  it('formats skill triplet consistently', () => {
    const stats: SkillStatsTriplet = { stars: 12_340, downloads: 23_683, installsAllTime: 1_045_000 }

    expect(formatSkillStatsTriplet(stats)).toEqual({
      stars: '12.3k',
      downloads: '23.7k',
      installsAllTime: '1M',
    })
  })

  it('formats soul triplet consistently', () => {
    const stats: SoulStatsTriplet = { stars: 3_540, downloads: 78_010, versions: 4 }

    expect(formatSoulStatsTriplet(stats)).toEqual({
      stars: '3.5k',
      downloads: '78k',
      versions: 4,
    })
  })
})
