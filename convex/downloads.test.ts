import { describe, expect, it } from 'vitest'
import { __test } from './downloads'

describe('downloads helpers', () => {
  it('calculates day start boundaries', () => {
    const day = 86_400_000
    expect(__test.getDayStart(0)).toBe(0)
    expect(__test.getDayStart(day - 1)).toBe(0)
    expect(__test.getDayStart(day)).toBe(day)
    expect(__test.getDayStart(day + 1)).toBe(day)
  })
})
