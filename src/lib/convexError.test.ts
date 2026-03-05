import { describe, expect, it } from 'vitest'
import { getUserFacingConvexError } from './convexError'

describe('getUserFacingConvexError', () => {
  it('falls back when data is generic wrapper text', () => {
    expect(
      getUserFacingConvexError({ data: 'Server Error Called by client' }, 'Publish failed'),
    ).toBe('Publish failed')
  })

  it('unwraps convex wrapper text from Error messages', () => {
    expect(
      getUserFacingConvexError(
        new Error('[CONVEX A] [Request ID: abc] Server Error Called by client ConvexError: Bad input'),
        'fallback',
      ),
    ).toBe('Bad input')
  })

  it('maps legacy ownership error to slug-taken message', () => {
    expect(getUserFacingConvexError(new Error('Only the owner can publish updates'), 'fallback')).toBe(
      'Slug is already taken. Choose a different slug.',
    )
  })

  it('returns fallback for unknown errors', () => {
    expect(getUserFacingConvexError('wat', 'Publish failed')).toBe('Publish failed')
  })
})
