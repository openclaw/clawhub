/* @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { getClientIp } from './httpRateLimit'

describe('getClientIp', () => {
  it('returns null when cf-connecting-ip missing', () => {
    const request = new Request('https://example.com', {
      headers: {
        'x-forwarded-for': '203.0.113.9',
      },
    })
    process.env.TRUST_FORWARDED_IPS = ''
    expect(getClientIp(request)).toBeNull()
  })

  it('returns first ip from cf-connecting-ip', () => {
    const request = new Request('https://example.com', {
      headers: {
        'cf-connecting-ip': '203.0.113.1, 198.51.100.2',
      },
    })
    expect(getClientIp(request)).toBe('203.0.113.1')
  })

  it('uses forwarded headers when opt-in enabled', () => {
    const request = new Request('https://example.com', {
      headers: {
        'x-forwarded-for': '203.0.113.9, 198.51.100.2',
      },
    })
    process.env.TRUST_FORWARDED_IPS = 'true'
    expect(getClientIp(request)).toBe('203.0.113.9')
    process.env.TRUST_FORWARDED_IPS = ''
  })
})
