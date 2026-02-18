import { internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import { getOptionalApiTokenUserId } from './apiTokenAuth'
import { corsHeaders, mergeHeaders } from './httpHeaders'

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
  const userId = await getOptionalApiTokenUserId(ctx, request)
  const ip = getClientIp(request) ?? 'unknown'
  const ipResult = await checkRateLimit(ctx, `ip:${ip}`, RATE_LIMITS[kind].ip)
  const userResult = userId
    ? await checkRateLimit(ctx, `user:${userId}`, RATE_LIMITS[kind].key)
    : null

  // Authenticated requests are enforced by user bucket to avoid shared-IP false positives.
  // Anonymous requests remain IP-enforced.
  const chosen = userResult ?? ipResult
  const headers = rateHeaders(chosen)
  const isDenied = userResult ? !userResult.allowed : !ipResult.allowed

  if (isDenied) {
    console.info('rate_limit_denied', {
      kind,
      auth: Boolean(userResult),
      userAllowed: userResult?.allowed ?? null,
      ipAllowed: ipResult.allowed,
      ipSource: getClientIpSource(request),
      hasClientIp: ip !== 'unknown',
    })
    return {
      ok: false,
      response: new Response('Rate limit exceeded', {
        status: 429,
        headers: mergeHeaders(
          {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          },
          headers,
          corsHeaders(),
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
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('fly-client-ip')

  return splitFirstIp(forwarded)
}

function getClientIpSource(request: Request) {
  if (request.headers.get('cf-connecting-ip')) return 'cf-connecting-ip'
  if (!shouldTrustForwardedIps()) return 'none'
  if (request.headers.get('x-forwarded-for')) return 'x-forwarded-for'
  if (request.headers.get('x-real-ip')) return 'x-real-ip'
  if (request.headers.get('fly-client-ip')) return 'fly-client-ip'
  return 'none'
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

function rateHeaders(result: RateLimitResult): HeadersInit {
  const nowMs = Date.now()
  const resetSeconds = Math.ceil(result.resetAt / 1000)
  const resetDelaySeconds = Math.max(1, Math.ceil((result.resetAt - nowMs) / 1000))
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(resetSeconds),
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(resetDelaySeconds),
    ...(result.allowed ? {} : { 'Retry-After': String(resetDelaySeconds) }),
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

function shouldTrustForwardedIps() {
  const value = String(process.env.TRUST_FORWARDED_IPS ?? '')
    .trim()
    .toLowerCase()
  // Hardening default: CF-only. Forwarded headers are trivial to spoof unless you
  // control the trusted proxy layer.
  if (!value) return false
  if (value === '1' || value === 'true' || value === 'yes') return true
  return false
}

function isRateLimitWriteConflict(error: unknown) {
  if (!(error instanceof Error)) return false
  return (
    error.message.includes('rateLimits') &&
    error.message.includes('changed while this mutation was being run')
  )
}
