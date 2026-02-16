/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getClientIp } from './httpRateLimit'

describe('getClientIp', () => {
  let prev: string | undefined
  beforeEach(() => {
    prev = process.env.TRUST_FORWARDED_IPS
  })
  afterEach(() => {
    if (prev === undefined) {
      delete process.env.TRUST_FORWARDED_IPS
    } else {
      process.env.TRUST_FORWARDED_IPS = prev
    }
  })

  it('returns null when cf-connecting-ip is missing (CF-only default)', () => {
    const request = new Request('https://example.com', {
      headers: {
        'x-forwarded-for': '203.0.113.9',
      },
    })
    delete process.env.TRUST_FORWARDED_IPS
    expect(getClientIp(request)).toBeNull()
  })

  it('keeps forwarded headers disabled when TRUST_FORWARDED_IPS=false', () => {
    const request = new Request('https://example.com', {
      headers: {
        'x-forwarded-for': '203.0.113.9',
      },
    })
    process.env.TRUST_FORWARDED_IPS = 'false'
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
  })
})
