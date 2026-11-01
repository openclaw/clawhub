import { MINUTE, type RateLimitConfig } from "@convex-dev/rate-limiter";
import { components, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getOptionalApiTokenUser } from "./apiTokenAuth";
import { ARCHIVE_REQUEST_IDENTITY_HEADER } from "./clawhubVercelOidc";
import { corsHeaders, mergeHeaders } from "./httpHeaders";
import { getVerifiedClientIp, VERIFIED_CLIENT_IP_HEADER } from "./verifiedClientIp";

export const RATE_LIMITS = {
  read: { ip: 3000, key: 12000, adminKey: 120000 },
  write: { ip: 300, key: 3000, adminKey: 30000 },
  trustedPublish: { ip: 3000, key: 12000, adminKey: 120000 },
  download: { ip: 1200, key: 6000, adminKey: 60000 },
  export: { ip: 10, key: 60, adminKey: 60 },
} as const;

const RATE_LIMIT_WINDOW_MS = 60_000;
// High-volume buckets record consumption in batches: one request in N writes
// a count of N, while every other request performs a read-only bucket check.
// The expected consumption is unchanged and exhausted buckets still deny every
// request, but each committed quota write now covers N requests. Low-volume
// buckets (write, export, trusted publish) stay exactly accounted.
const HTTP_RATE_LIMIT_BATCHED_KINDS: Partial<Record<RateLimitKind, number>> = {
  read: 4,
  download: 4,
};
const HTTP_RATE_LIMIT_SHARDS = 32;
const HTTP_RATE_LIMIT_MIN_SHARD_CAPACITY = 10;
const HTTP_RATE_LIMIT_KEY_TTL_MS = 24 * 60 * 60 * 1000;

type RateLimitResult = {
  allowed: boolean;
  // The component does not expose an exact global remaining count for sharded
  // buckets, so successful responses omit this instead of guessing.
  remaining?: number;
  limit: number;
  resetAt: number;
  unavailable?: boolean;
};

export type ApplyRateLimitResult =
  | { ok: true; headers: HeadersInit }
  | { ok: false; response: Response };

type RateLimitKind = keyof typeof RATE_LIMITS;
type RateLimitSubject = "ip" | "key" | "adminKey";
type HttpRateLimitName = `${RateLimitKind}${Capitalize<RateLimitSubject>}`;
type FixedWindowRateLimitConfig = Extract<RateLimitConfig, { kind: "fixed window" }>;

const preappliedRateLimitHeaders = new WeakMap<Request, HeadersInit>();
const verifiedClientIps = new WeakMap<Request, string>();

function fixedWindowRateLimit(rate: number): FixedWindowRateLimitConfig {
  const shards = Math.max(
    1,
    Math.min(HTTP_RATE_LIMIT_SHARDS, Math.floor(rate / HTTP_RATE_LIMIT_MIN_SHARD_CAPACITY)),
  );
  return {
    kind: "fixed window",
    rate,
    period: MINUTE,
    start: 0,
    shards,
  };
}

export const HTTP_RATE_LIMIT_CONFIGS = {
  readIp: fixedWindowRateLimit(RATE_LIMITS.read.ip),
  readKey: fixedWindowRateLimit(RATE_LIMITS.read.key),
  readAdminKey: fixedWindowRateLimit(RATE_LIMITS.read.adminKey),
  writeIp: fixedWindowRateLimit(RATE_LIMITS.write.ip),
  writeKey: fixedWindowRateLimit(RATE_LIMITS.write.key),
  writeAdminKey: fixedWindowRateLimit(RATE_LIMITS.write.adminKey),
  trustedPublishIp: fixedWindowRateLimit(RATE_LIMITS.trustedPublish.ip),
  trustedPublishKey: fixedWindowRateLimit(RATE_LIMITS.trustedPublish.key),
  trustedPublishAdminKey: fixedWindowRateLimit(RATE_LIMITS.trustedPublish.adminKey),
  downloadIp: fixedWindowRateLimit(RATE_LIMITS.download.ip),
  downloadKey: fixedWindowRateLimit(RATE_LIMITS.download.key),
  downloadAdminKey: fixedWindowRateLimit(RATE_LIMITS.download.adminKey),
  exportIp: fixedWindowRateLimit(RATE_LIMITS.export.ip),
  exportKey: fixedWindowRateLimit(RATE_LIMITS.export.key),
  exportAdminKey: fixedWindowRateLimit(RATE_LIMITS.export.adminKey),
} as const satisfies Record<HttpRateLimitName, RateLimitConfig>;

export function markRateLimitApplied(request: Request, headers: HeadersInit): void {
  preappliedRateLimitHeaders.set(request, headers);
}

export async function applyRateLimit(
  ctx: ActionCtx,
  request: Request,
  kind: RateLimitKind,
): Promise<ApplyRateLimitResult> {
  const preappliedHeaders = preappliedRateLimitHeaders.get(request);
  if (preappliedHeaders) return { ok: true, headers: preappliedHeaders };

  const batchSize = getRateLimitBatchSize(kind);
  const auth = await getOptionalApiTokenUser(ctx, request);
  const verifiedIp = await getVerifiedClientIp(request);
  if (verifiedIp) verifiedClientIps.set(request, verifiedIp);
  const ip = verifiedIp ?? "unknown";
  const ipSource = verifiedIp ? "verified-edge" : "none";
  const hasClientIp = ip !== "unknown";
  const rpcMode = process.env.CLAWHUB_HTTP_RATE_LIMIT_RPC_MODE;
  const adminProbe = rpcMode === "admin-probe" && auth?.user.role === "admin";
  const combineMetadata =
    rpcMode === "on" ||
    (adminProbe && request.headers.get("x-clawhub-rate-limit-rpc") === "combined");

  // Authenticated requests are enforced and consumed by user bucket only to
  // avoid draining shared IP quota.
  if (auth) {
    const userLimit = getAuthenticatedRateLimit(kind, auth.user);
    const userResult = await checkRateLimit(
      ctx,
      getAuthenticatedRateLimitKey(auth.userId, kind),
      userLimit.name,
      userLimit.limit,
      combineMetadata,
      batchSize,
    );
    const headers = {
      ...rateHeaders(userResult),
      ...(adminProbe
        ? { "X-ClawHub-RateLimit-Rpc": combineMetadata ? "combined" : "separate" }
        : {}),
    };
    if (userResult.unavailable) return rateLimitUnavailable(headers);
    if (!userResult.allowed) {
      console.info("rate_limit_denied", {
        kind,
        auth: true,
        admin: auth.user.role === "admin",
        userAllowed: false,
        ipAllowed: null,
        ipSource,
        hasClientIp,
      });
      return {
        ok: false,
        response: new Response("Rate limit exceeded", {
          status: 429,
          headers: mergeHeaders(
            {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store",
            },
            headers,
            corsHeaders(),
          ),
        }),
      };
    }
    return { ok: true, headers };
  }

  // Unknown direct callers must not consume a bucket shared by all visitors.
  if (!verifiedIp) return anonymousEdgeResponse(request);

  // Anonymous requests are enforced using the authenticated edge identity.
  const ipResult = await checkRateLimit(
    ctx,
    getAnonymousRateLimitKey(kind, ip),
    getHttpRateLimitName(kind, "ip"),
    RATE_LIMITS[kind].ip,
    combineMetadata,
    batchSize,
  );
  const headers = rateHeaders(ipResult);
  if (ipResult.unavailable) return rateLimitUnavailable(headers);

  if (!ipResult.allowed) {
    console.info("rate_limit_denied", {
      kind,
      auth: false,
      userAllowed: null,
      ipAllowed: ipResult.allowed,
      ipSource,
      hasClientIp,
    });
    return {
      ok: false,
      response: new Response("Rate limit exceeded", {
        status: 429,
        headers: mergeHeaders(
          {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          },
          headers,
          corsHeaders(),
        ),
      }),
    };
  }

  return { ok: true, headers };
}

function getAnonymousRateLimitKey(kind: RateLimitKind, ip: string) {
  return `ip:${ip}:${kind}`;
}

function getAuthenticatedRateLimitKey(userId: string, kind: RateLimitKind) {
  return `user:${userId}:${kind}`;
}

function getAuthenticatedRateLimit(kind: RateLimitKind, user: Pick<Doc<"users">, "role">) {
  const subject = user.role === "admin" ? "adminKey" : "key";
  return {
    name: getHttpRateLimitName(kind, subject),
    limit: RATE_LIMITS[kind][subject],
  };
}

export function getClientIp(request: Request): string | null {
  return verifiedClientIps.get(request) ?? null;
}

function anonymousEdgeResponse(request: Request): ApplyRateLimitResult {
  // An asserted but invalid edge identity must fail here: redirecting it back
  // to the same misconfigured edge would produce an endless redirect loop.
  if (
    request.headers.has(ARCHIVE_REQUEST_IDENTITY_HEADER) ||
    request.headers.has(VERIFIED_CLIENT_IP_HEADER)
  ) {
    return {
      ok: false,
      response: new Response("ClawHub edge identity could not be verified.", {
        status: 401,
        headers: mergeHeaders(
          { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
          corsHeaders(),
        ),
      }),
    };
  }
  const source = new URL(request.url);
  const configured = (process.env.SITE_URL ?? process.env.VITE_SITE_URL)?.trim();
  const publicOrigin =
    configured || (process.env.CLAWHUB_ENV === "production" ? "https://clawhub.ai" : null);
  if (publicOrigin) {
    try {
      const target = new URL(publicOrigin);
      target.pathname = source.pathname;
      target.search = source.search;
      target.hash = "";
      if (
        target.protocol === "https:" &&
        target.origin !== source.origin &&
        !target.hostname.endsWith(".convex.site")
      ) {
        return {
          ok: false,
          response: new Response(null, {
            status: 307,
            headers: mergeHeaders(
              { Location: target.href, "Cache-Control": "no-store" },
              corsHeaders(),
            ),
          }),
        };
      }
    } catch {
      /* Invalid deployment configuration fails closed below. */
    }
  }
  return {
    ok: false,
    response: new Response("Use the ClawHub public API origin or an API token.", {
      status: 401,
      headers: mergeHeaders(
        { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
        corsHeaders(),
      ),
    }),
  };
}

// The component rejects any single request larger than
// capacity / (shards / 2); a misconfigured batch would turn every sampled
// request into a 500, so fail at module load instead.
for (const [kind, batch] of Object.entries(HTTP_RATE_LIMIT_BATCHED_KINDS) as [
  RateLimitKind,
  number,
][]) {
  for (const subject of ["ip", "key", "adminKey"] as const) {
    const config = HTTP_RATE_LIMIT_CONFIGS[getHttpRateLimitName(kind, subject)];
    const shards = config.shards ?? 1;
    const maxPerRequest = config.rate / (shards < 3 ? 1 : shards / 2);
    if (batch > maxPerRequest) {
      throw new Error(`Rate limit batch ${batch} exceeds ${kind}/${subject} per-request maximum`);
    }
  }
}

export function getRateLimitBatchSize(kind: RateLimitKind): number {
  const mode = process.env.CLAWHUB_HTTP_RATE_LIMIT_BATCHING?.trim().toLowerCase();
  if (mode === "off") return 1;
  return HTTP_RATE_LIMIT_BATCHED_KINDS[kind] ?? 1;
}

async function checkRateLimit(
  ctx: ActionCtx,
  key: string,
  name: HttpRateLimitName,
  limit: number,
  combineMetadata: boolean,
  batchSize: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  try {
    const status =
      batchSize > 1 && Math.random() * batchSize >= 1
        ? await peekRateLimit(ctx, { name, key, now, count: batchSize })
        : await consumeRateLimitWithMetadata(
            ctx,
            { name, key, now, count: batchSize },
            combineMetadata,
          );
    if (!status.ok) {
      return {
        allowed: false,
        remaining: 0,
        limit,
        resetAt: now + status.retryAfter,
      };
    }

    return {
      allowed: true,
      limit,
      resetAt: getCurrentWindowResetAt(now),
    };
  } catch (error) {
    if (!isRateLimitCounterWriteConflict(error)) throw error;
    return {
      allowed: false,
      remaining: 0,
      limit,
      resetAt: now + 1000,
      unavailable: true,
    };
  }
}

async function peekRateLimit(
  ctx: ActionCtx,
  args: { name: HttpRateLimitName; key: string; now: number; count: number },
): Promise<{ ok: true; retryAfter?: number } | { ok: false; retryAfter: number }> {
  // Read-only: an exhausted bucket denies without adding a quota write. The
  // check must ask for the same count a sampled write consumes; a one-token
  // check would keep passing on shard remainders that can no longer fit a
  // batch, admitting unbounded traffic past the limit.
  const status = await ctx.runQuery(components.rateLimiter.lib.checkRateLimit, {
    name: args.name,
    key: args.key,
    config: HTTP_RATE_LIMIT_CONFIGS[args.name],
    count: args.count,
  });
  // Denied traffic still refreshes retention metadata so cleanup cannot reset
  // a bucket that is actively being limited. The refresh rarely writes.
  if (!status.ok) await touchRateLimitKeyMetadata(ctx, args);
  return status;
}

async function consumeRateLimitWithMetadata(
  ctx: ActionCtx,
  args: { name: HttpRateLimitName; key: string; now: number; count: number },
  combineMetadata: boolean,
) {
  const counterArgs = {
    name: args.name,
    key: args.key,
    config: HTTP_RATE_LIMIT_CONFIGS[args.name],
    ...(args.count > 1 ? { count: args.count } : {}),
  };
  if (!combineMetadata) {
    await touchRateLimitKeyMetadata(ctx, args);
    return await ctx.runMutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, counterArgs);
  }
  try {
    return await ctx.runMutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, {
      ...counterArgs,
      metadata: { now: args.now, ttlMs: HTTP_RATE_LIMIT_KEY_TTL_MS },
    });
  } catch (error) {
    if (!isRateLimitMetadataWriteConflict(error)) throw error;
    // The failed transaction rolled back its component counter too. Preserve
    // metadata-contention availability by retrying the bare counter, after the
    // competing metadata refresh or cleanup committed, as the separate path did.
    console.warn("rate_limit_metadata_write_contention", {
      name: args.name,
    });
    return await ctx.runMutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, counterArgs);
  }
}

async function touchRateLimitKeyMetadata(
  ctx: ActionCtx,
  args: { name: HttpRateLimitName; key: string; now: number },
) {
  try {
    await ctx.runMutation(internal.rateLimits.touchHttpRateLimitKeyInternal, {
      name: args.name,
      key: args.key,
      now: args.now,
      ttlMs: HTTP_RATE_LIMIT_KEY_TTL_MS,
    });
  } catch (error) {
    if (!isRateLimitMetadataWriteConflict(error)) throw error;
    // Metadata must be attempted before quota consumption so cleanup cannot
    // reset a bucket after it is consumed. A conflict means cleanup or another
    // refresh committed first, so the later counter mutation remains ordered.
    console.warn("rate_limit_metadata_write_contention", {
      name: args.name,
    });
  }
}

function rateLimitUnavailable(headers: HeadersInit): Extract<ApplyRateLimitResult, { ok: false }> {
  console.warn("rate_limit_unavailable", {
    reason: "counter_write_contention",
  });
  return {
    ok: false,
    response: new Response("Rate limit temporarily unavailable", {
      status: 503,
      headers: mergeHeaders(
        {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": "1",
        },
        headers,
        corsHeaders(),
      ),
    }),
  };
}

function rateHeaders(result: RateLimitResult): Record<string, string> {
  const nowMs = Date.now();
  const resetSeconds = Math.ceil(result.resetAt / 1000);
  const resetDelaySeconds = Math.max(1, Math.ceil((result.resetAt - nowMs) / 1000));
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Reset": String(resetSeconds),
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Reset": String(resetDelaySeconds),
  };
  if (result.remaining !== undefined) {
    headers["X-RateLimit-Remaining"] = String(result.remaining);
    headers["RateLimit-Remaining"] = String(result.remaining);
  }
  if (!result.allowed) headers["Retry-After"] = String(resetDelaySeconds);
  return headers;
}

function getCurrentWindowResetAt(now: number) {
  return Math.floor(now / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS + RATE_LIMIT_WINDOW_MS;
}

function getHttpRateLimitName(kind: RateLimitKind, subject: RateLimitSubject): HttpRateLimitName {
  const suffix = subject === "ip" ? "Ip" : subject === "key" ? "Key" : "AdminKey";
  return `${kind}${suffix}` as HttpRateLimitName;
}

export function parseBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token || null;
}

function isRateLimitCounterWriteConflict(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("rateLimits") &&
    error.message.includes("changed while this mutation was being run")
  );
}

function isRateLimitMetadataWriteConflict(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("httpRateLimitKeys") &&
    error.message.includes("changed while this mutation was being run")
  );
}
