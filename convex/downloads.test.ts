import { afterEach, describe, expect, it, vi } from 'vitest'
import { __test } from './downloads'

describe('downloads helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('calculates hour start boundaries', () => {
    const hour = 3_600_000
    expect(__test.getHourStart(0)).toBe(0)
    expect(__test.getHourStart(hour - 1)).toBe(0)
    expect(__test.getHourStart(hour)).toBe(hour)
    expect(__test.getHourStart(hour + 1)).toBe(hour)
  })

  it('prefers user identity when token user exists', () => {
    const request = new Request('https://example.com', {
      headers: { 'cf-connecting-ip': '1.2.3.4' },
    })
    expect(__test.getDownloadIdentityValue(request, 'users_123')).toBe('user:users_123')
  })

  it('uses cf-connecting-ip for anonymous identity', () => {
    const request = new Request('https://example.com', {
      headers: { 'cf-connecting-ip': '1.2.3.4' },
    })
    expect(__test.getDownloadIdentityValue(request, null)).toBe('ip:1.2.3.4')
  })

  it('falls back to forwarded ip when explicitly enabled', () => {
    vi.stubEnv('TRUST_FORWARDED_IPS', 'true')
    const request = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
    })
    expect(__test.getDownloadIdentityValue(request, null)).toBe('ip:10.0.0.1')
  })

  it('returns null when user and ip are missing', () => {
    const request = new Request('https://example.com')
    expect(__test.getDownloadIdentityValue(request, null)).toBeNull()
  })
})
