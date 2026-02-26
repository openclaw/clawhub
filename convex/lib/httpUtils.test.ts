import { describe, expect, it } from 'vitest'
import { parseBooleanQueryParam } from './httpUtils'

describe('parseBooleanQueryParam', () => {
  it('returns true for true-like values', () => {
    expect(parseBooleanQueryParam('true')).toBe(true)
    expect(parseBooleanQueryParam('1')).toBe(true)
    expect(parseBooleanQueryParam(' TRUE ')).toBe(true)
  })

  it('returns false for missing and false-like values', () => {
    expect(parseBooleanQueryParam(null)).toBe(false)
    expect(parseBooleanQueryParam('')).toBe(false)
    expect(parseBooleanQueryParam('false')).toBe(false)
    expect(parseBooleanQueryParam('0')).toBe(false)
    expect(parseBooleanQueryParam('yes')).toBe(false)
  })
})
