# Rate Limiting

## Security Intent

All public HTTP routes, including legacy `/api/...` and `/api/cli/...` routes
kept for compatibility, must pass through `applyRateLimit` before doing
expensive work, auth parsing, publish mutations, upload ticket creation,
telemetry writes, delete/undelete mutations, or search queries.

Client IP headers are not trustworthy on direct Convex HTTP endpoints. Treat
`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`, and `fly-client-ip` as
trusted only when the deployment explicitly enables trusted forwarded headers
and the request carries ClawHub's edge trust secret. The Vercel middleware owns
that boundary: it strips caller-supplied client IP and edge trust headers before
adding `x-clawhub-edge-secret`, `x-forwarded-for`, and `x-real-ip` for Convex
rewrites. Convex prefers the edge-stamped `x-forwarded-for` over connection IP
headers so Vercel rewrites are limited by the original client IP, not the Vercel
egress IP. Direct `*.convex.site` callers without the secret must continue to
use conservative missing-IP fallback buckets scoped only by rate-limit kind.
Missing-IP buckets must not include user-controlled paths, dynamic path
segments, query parameters, package names, skill slugs, or artifact versions.
Artifact-specific download scoping is only safe after the caller has an
authenticated identity or a trusted client IP.

HTTP rate-limit counters are owned by the `@convex-dev/rate-limiter` component.
The app defines named fixed-window buckets for each public HTTP policy
(`read`, `write`, `trustedPublish`, `download`, and `export`) and for each
subject class (`ip`, authenticated API token user, and admin API token user).
Anonymous requests consume the `Ip` bucket for the route policy. Authenticated
requests consume only the `Key` or `AdminKey` bucket for their user, so shared
egress IPs do not drain user quota.
Component rows are operational data, not product history. Do not use the
component `clearAll(before)` helper as a TTL job for active HTTP buckets:
`clearAll` deletes by row creation time while normal rate-limit use patches the
row's current timestamp and value in place. Clearing old creation times can
reset still-active buckets and weaken the limit.
The app-owned `httpRateLimitKeys` table exists only to make component cleanup
safe: limiter checks refresh sharded metadata for the observed `(name, key)`
with an `expiresAt`, and retention resets the exact component key only after no
metadata shard for that `(name, key)` remains active. Active allowed and denied
traffic must both refresh this metadata so a client that is still hitting a
limit is not reset by cleanup. Metadata sharding is required because shared
buckets such as missing-IP anonymous reads can receive many concurrent requests;
one metadata row per key would become a separate Convex write-contention point.

Component sharding is an implementation detail, not a quota multiplier. Keep
the public quota in `RATE_LIMITS`; the component's `shards` setting exists to
spread writes across counter rows while preserving the configured limit. Low
rate buckets should stay unsharded or keep enough per-shard capacity that
normal clients are not randomly denied well before the public limit.
Because the component does not expose an exact total remaining count for
sharded buckets, successful HTTP responses must not synthesize a global
`RateLimit-Remaining` value. Denied responses can still return an exact
remaining value of `0`.
