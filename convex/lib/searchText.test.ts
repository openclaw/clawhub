/* @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { __test, matchesExactTokens, tokenize } from './searchText'

describe('searchText', () => {
  it('tokenize lowercases and splits on punctuation', () => {
    expect(tokenize('Minimax Usage /minimax-usage')).toEqual([
      'minimax',
      'usage',
      'minimax',
      'usage',
    ])
  })

  it('matchesExactTokens requires at least one query token to prefix-match', () => {
    const queryTokens = tokenize('Remind Me')
    expect(matchesExactTokens(queryTokens, ['Remind Me', '/remind-me', 'Short summary'])).toBe(true)
    // "Reminder" starts with "remind", so it matches with prefix matching
    expect(matchesExactTokens(queryTokens, ['Reminder tool', '/reminder', 'Short summary'])).toBe(
      true,
    )
    // Matches because "remind" token is present
    expect(matchesExactTokens(queryTokens, ['Remind tool', '/remind', 'Short summary'])).toBe(true)
    // No matching tokens at all
    expect(matchesExactTokens(queryTokens, ['Other tool', '/other', 'Short summary'])).toBe(false)
  })

  it('matchesExactTokens supports prefix matching for partial queries', () => {
    // "go" should match "gohome" because "gohome" starts with "go"
    expect(matchesExactTokens(['go'], ['GoHome', '/gohome', 'Navigate home'])).toBe(true)
    // "pad" should match "padel"
    expect(matchesExactTokens(['pad'], ['Padel', '/padel', 'Tennis-like sport'])).toBe(true)
    // "xyz" should not match anything
    expect(matchesExactTokens(['xyz'], ['GoHome', '/gohome', 'Navigate home'])).toBe(false)
  })

  it('matchesExactTokens does not match non-prefix substrings', () => {
    expect(matchesExactTokens(['art'], ['Cartoon', '/cartoon', 'Animated'])).toBe(false)
    expect(matchesExactTokens(['art'], ['Smart tool', '/smart', 'Overview'])).toBe(false)
  })

  it('matchesExactTokens ignores empty inputs', () => {
    expect(matchesExactTokens([], ['text'])).toBe(false)
    expect(matchesExactTokens(['token'], ['  ', null, undefined])).toBe(false)
  })

  it('normalize uses lowercase', () => {
    expect(__test.normalize('AbC')).toBe('abc')
  })
})
