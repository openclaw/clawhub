/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyRateLimit, getClientIp } from './httpRateLimit'

type MockRateLimitStatus = {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: number
}

type MockRateLimitPlan = {
  ip: MockRateLimitStatus
  user?: MockRateLimitStatus
  tokenValid?: boolean
  userActive?: boolean
}

function makeRateLimitCtx(plan: MockRateLimitPlan) {
  const runQuery = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
    if ('tokenHash' in args) {
      if (plan.tokenValid === false) return null
      return { _id: 'token_1', revokedAt: undefined }
    }
    if ('tokenId' in args) {
      if (plan.userActive === false) return null
      return { _id: 'users_123', deletedAt: undefined, deactivatedAt: undefined }
    }
    if ('key' in args && 'limit' in args && 'windowMs' in args) {
      const key = String(args.key)
      if (key.startsWith('ip:')) return plan.ip
      if (key.startsWith('user:')) return plan.user
    }
    throw new Error(`Unexpected runQuery args: ${JSON.stringify(args)}`)
  })

  const runMutation = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
    const key = String(args.key)
    const source = key.startsWith('user:') ? plan.user : plan.ip
    if (!source) throw new Error(`Missing rate limit source for ${key}`)
    return { allowed: source.allowed, remaining: source.remaining }
  })

  return {
    runQuery,
    runMutation,
  } as unknown as Parameters<typeof applyRateLimit>[0]
}

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

  it('prefers x-forwarded-for over x-real-ip when trusted mode is enabled', () => {
    const request = new Request('https://example.com', {
      headers: {
        'x-forwarded-for': '203.0.113.9, 198.51.100.2',
        'x-real-ip': '198.51.100.77',
      },
    })
    process.env.TRUST_FORWARDED_IPS = 'true'
    expect(getClientIp(request)).toBe('203.0.113.9')
  })
})

describe('applyRateLimit headers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns delay-seconds Retry-After on 429 (not epoch)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const runMutation = vi.fn()
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        allowed: false,
        remaining: 0,
        limit: 20,
        resetAt: 1_030_500,
      }),
      runMutation,
    } as unknown as Parameters<typeof applyRateLimit>[0]
    const request = new Request('https://example.com', {
      headers: { 'cf-connecting-ip': '203.0.113.1' },
    })

    const result = await applyRateLimit(ctx, request, 'download')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(429)
    expect(result.response.headers.get('Retry-After')).toBe('31')
    expect(result.response.headers.get('X-RateLimit-Reset')).toBe('1031')
    expect(result.response.headers.get('RateLimit-Reset')).toBe('31')
    expect(runMutation).not.toHaveBeenCalled()
  })

  it('includes rate-limit headers without Retry-After when allowed', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000)
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 2_015_000,
      }),
      runMutation: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 18,
      }),
    } as unknown as Parameters<typeof applyRateLimit>[0]
    const request = new Request('https://example.com', {
      headers: { 'cf-connecting-ip': '203.0.113.1' },
    })

    const result = await applyRateLimit(ctx, request, 'download')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const headers = new Headers(result.headers)
    expect(headers.get('X-RateLimit-Limit')).toBe('20')
    expect(headers.get('X-RateLimit-Remaining')).toBe('18')
    expect(headers.get('X-RateLimit-Reset')).toBe('2015')
    expect(headers.get('RateLimit-Limit')).toBe('20')
    expect(headers.get('RateLimit-Remaining')).toBe('18')
    expect(headers.get('RateLimit-Reset')).toBe('15')
    expect(headers.get('Retry-After')).toBeNull()
  })

  it('allows authenticated users when user bucket is healthy and shared ip bucket is exhausted', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(3_000_000)
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: false,
        remaining: 0,
        limit: 20,
        resetAt: 3_040_000,
      },
      user: {
        allowed: true,
        remaining: 42,
        limit: 120,
        resetAt: 3_010_000,
      },
    })
    const request = new Request('https://example.com', {
      headers: {
        authorization: 'Bearer clh_token',
        'cf-connecting-ip': '203.0.113.1',
      },
    })

    const result = await applyRateLimit(ctx, request, 'download')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const headers = new Headers(result.headers)
    expect(headers.get('X-RateLimit-Limit')).toBe('120')
    expect(headers.get('X-RateLimit-Remaining')).toBe('42')
    expect(headers.get('Retry-After')).toBeNull()
  })

  it('denies authenticated users when user bucket is exhausted even if ip bucket is healthy', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(4_000_000)
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 4_020_000,
      },
      user: {
        allowed: false,
        remaining: 0,
        limit: 120,
        resetAt: 4_030_000,
      },
    })
    const request = new Request('https://example.com', {
      headers: {
        authorization: 'Bearer clh_token',
        'cf-connecting-ip': '203.0.113.1',
      },
    })

    const result = await applyRateLimit(ctx, request, 'download')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(429)
    expect(result.response.headers.get('X-RateLimit-Limit')).toBe('120')
    expect(result.response.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(result.response.headers.get('Retry-After')).toBe('30')
  })

  it('falls back to ip enforcement when bearer token is invalid', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000_000)
    const ctx = makeRateLimitCtx({
      tokenValid: false,
      ip: {
        allowed: false,
        remaining: 0,
        limit: 20,
        resetAt: 5_030_000,
      },
    })
    const request = new Request('https://example.com', {
      headers: {
        authorization: 'Bearer invalid',
        'cf-connecting-ip': '203.0.113.1',
      },
    })

    const result = await applyRateLimit(ctx, request, 'download')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(429)
    expect(result.response.headers.get('X-RateLimit-Limit')).toBe('20')
    expect(result.response.headers.get('Retry-After')).toBe('30')
  })
})
