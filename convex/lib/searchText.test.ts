/* @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { __test, matchesExactTokens, scoreTokenMatch, tokenize } from './searchText'

describe('searchText', () => {
  it('tokenize lowercases and splits on punctuation', () => {
    expect(tokenize('Minimax Usage /minimax-usage')).toEqual([
      'minimax',
      'usage',
      'minimax',
      'usage',
    ])
  })

  it('matchesExactTokens requires ALL query tokens to prefix-match', () => {
    const queryTokens = tokenize('Remind Me')
    // Both "remind" and "me" match
    expect(matchesExactTokens(queryTokens, ['Remind Me', '/remind-me', 'Short summary'])).toBe(true)
    // "reminder" starts with "remind", but no "me" token
    expect(matchesExactTokens(queryTokens, ['Reminder tool', '/reminder', 'Short summary'])).toBe(
      false,
    )
    // "remind" matches but no "me" token either
    expect(matchesExactTokens(queryTokens, ['Remind tool', '/remind', 'Short summary'])).toBe(false)
    // "remind" + "me" present in summary
    expect(matchesExactTokens(queryTokens, ['Remind tool', '/remind', 'Reminds me of things'])).toBe(true)
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
    // "notion" should not match "annotations" (substring only)
    expect(matchesExactTokens(['notion'], ['Annotations helper', '/annotations'])).toBe(false)
  })

  it('scoreTokenMatch returns higher scores for better matches', () => {
    const queryTokens = tokenize('Remind Me')
    // Exact match on both tokens
    expect(scoreTokenMatch(queryTokens, ['Remind Me'])).toBeGreaterThan(0)
    // Only one token matches — below threshold for 2-token query
    expect(scoreTokenMatch(queryTokens, ['Other tool with me'])).toBe(0)
    // Both match (prefix)
    const bothMatch = scoreTokenMatch(queryTokens, ['Reminder mechanism'])
    expect(bothMatch).toBeGreaterThan(0)
    // Exact > prefix
    const exactBoth = scoreTokenMatch(queryTokens, ['remind me'])
    expect(exactBoth).toBeGreaterThan(bothMatch)
  })

  it('matchesExactTokens ignores empty inputs', () => {
    expect(matchesExactTokens([], ['text'])).toBe(false)
    expect(matchesExactTokens(['token'], ['  ', null, undefined])).toBe(false)
  })

  it('normalize uses lowercase', () => {
    expect(__test.normalize('AbC')).toBe('abc')
  })
})
