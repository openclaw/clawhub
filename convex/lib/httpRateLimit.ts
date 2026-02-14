import { internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import { hashToken } from './tokens'

const RATE_LIMIT_WINDOW_MS = 60_000
export const RATE_LIMITS = {
  read: { ip: 120, key: 600 },
  write: { ip: 30, key: 120 },
  download: { ip: 20, key: 120 },
} as const

type RateLimitResult = {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: number
}

export async function applyRateLimit(
  ctx: ActionCtx,
  request: Request,
  kind: keyof typeof RATE_LIMITS,
): Promise<{ ok: true; headers: HeadersInit } | { ok: false; response: Response }> {
  const ip = getClientIp(request) ?? 'unknown'
  const ipResult = await checkRateLimit(ctx, `ip:${ip}`, RATE_LIMITS[kind].ip)
  const token = parseBearerToken(request)
  const keyResult = token
    ? await checkRateLimit(ctx, `key:${await hashToken(token)}`, RATE_LIMITS[kind].key)
    : null

  const chosen = pickMostRestrictive(ipResult, keyResult)
  const headers = rateHeaders(chosen)

  if (!ipResult.allowed || (keyResult && !keyResult.allowed)) {
    return {
      ok: false,
      response: new Response('Rate limit exceeded', {
        status: 429,
        headers: mergeHeaders(
          {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
          },
          headers,
        ),
      }),
    }
  }

  return { ok: true, headers }
}

export function getClientIp(request: Request) {
  const cfHeader = request.headers.get('cf-connecting-ip')
  if (cfHeader) return splitFirstIp(cfHeader)

  if (!shouldTrustForwardedIps()) return null

  const forwarded =
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for') ??
    request.headers.get('fly-client-ip')

  return splitFirstIp(forwarded)
}

async function checkRateLimit(
  ctx: ActionCtx,
  key: string,
  limit: number,
): Promise<RateLimitResult> {
  // Step 1: Read-only check to avoid write conflicts on denied requests.
  const status = (await ctx.runQuery(internal.rateLimits.getRateLimitStatusInternal, {
    key,
    limit,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })) as RateLimitResult

  if (!status.allowed) {
    return status
  }

  // Step 2: Consume with a mutation only when still allowed.
  let result: { allowed: boolean; remaining: number }
  try {
    result = (await ctx.runMutation(internal.rateLimits.consumeRateLimitInternal, {
      key,
      limit,
      windowMs: RATE_LIMIT_WINDOW_MS,
    })) as { allowed: boolean; remaining: number }
  } catch (error) {
    if (isRateLimitWriteConflict(error)) {
      return {
        allowed: false,
        remaining: 0,
        limit: status.limit,
        resetAt: status.resetAt,
      }
    }
    throw error
  }

  return {
    allowed: result.allowed,
    remaining: result.remaining,
    limit: status.limit,
    resetAt: status.resetAt,
  }
}

function pickMostRestrictive(primary: RateLimitResult, secondary: RateLimitResult | null) {
  if (!secondary) return primary
  if (!primary.allowed) return primary
  if (!secondary.allowed) return secondary
  return secondary.remaining < primary.remaining ? secondary : primary
}

function rateHeaders(result: RateLimitResult): HeadersInit {
  const resetSeconds = Math.ceil(result.resetAt / 1000)
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(resetSeconds),
    ...(result.allowed ? {} : { 'Retry-After': String(resetSeconds) }),
  }
}

export function parseBearerToken(request: Request) {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!header) return null
  const trimmed = header.trim()
  if (!trimmed.toLowerCase().startsWith('bearer ')) return null
  const token = trimmed.slice(7).trim()
  return token || null
}

function splitFirstIp(header: string | null) {
  if (!header) return null
  if (header.includes(',')) return header.split(',')[0]?.trim() || null
  const trimmed = header.trim()
  return trimmed || null
}

function mergeHeaders(base: HeadersInit, extra?: HeadersInit) {
  return { ...(base as Record<string, string>), ...(extra as Record<string, string>) }
}

function shouldTrustForwardedIps() {
  const value = String(process.env.TRUST_FORWARDED_IPS ?? '')
    .trim()
    .toLowerCase()
  if (!value) return true
  if (value === '1' || value === 'true' || value === 'yes') return true
  if (value === '0' || value === 'false' || value === 'no') return false
  return false
}

function isRateLimitWriteConflict(error: unknown) {
  if (!(error instanceof Error)) return false
  return (
    error.message.includes('rateLimits') &&
    error.message.includes('changed while this mutation was being run')
  )
}
