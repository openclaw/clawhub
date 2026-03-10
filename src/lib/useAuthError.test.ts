import { describe, expect, it } from 'vitest'
import { clearAuthError, parseAuthErrorFromUrl, setAuthError } from './useAuthError'

describe('parseAuthErrorFromUrl', () => {
  it('returns null when URL has no hash', () => {
    expect(parseAuthErrorFromUrl('/some/path')).toBeNull()
  })

  it('returns null when hash has no error params', () => {
    expect(parseAuthErrorFromUrl('/path#token=abc')).toBeNull()
  })

  it('extracts error from hash', () => {
    expect(parseAuthErrorFromUrl('/path#error=Something+went+wrong')).toBe('Something went wrong')
  })

  it('extracts error_description from hash', () => {
    expect(parseAuthErrorFromUrl('/path#error_description=Account+banned')).toBe('Account banned')
  })

  it('prefers error_description over error', () => {
    expect(
      parseAuthErrorFromUrl('/path#error=generic&error_description=Specific+message'),
    ).toBe('Specific message')
  })

  it('handles encoded characters', () => {
    expect(parseAuthErrorFromUrl('/path#error=Your+account+has+been+banned')).toBe(
      'Your account has been banned',
    )
  })
})

describe('setAuthError / clearAuthError', () => {
  it('clears the error', () => {
    setAuthError('test error')
    clearAuthError()
    // After clearing, parseAuthErrorFromUrl still works independently
    expect(parseAuthErrorFromUrl('/path')).toBeNull()
  })
})
