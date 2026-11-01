# Rate Limiting

## Security Intent

All public HTTP routes, including legacy `/api/...` and `/api/cli/...` routes
kept for compatibility, must pass through `applyRateLimit` before doing
expensive work, auth parsing, publish mutations, upload ticket creation,
telemetry writes, delete/undelete mutations, or search queries.

Client IP headers are not trustworthy on direct Convex HTTP endpoints. Raw
`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`, and `fly-client-ip` values do
not establish an identity, including when the legacy forwarded-IP flag is set.
The public edge replaces caller-supplied ClawHub identity headers. The backend
accepts the asserted IP only alongside a verified ClawHub Vercel project and
environment token, plus the staging edge secret where required.
Anonymous direct callers without a verified IP are redirected to a configured
HTTPS public edge or rejected; invalid asserted edge identities are rejected.
They must never consume a shared unknown-IP bucket. Local proof may use the
server-owned loopback deployment exception; the request Host cannot enable it.
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
limit is not reset by cleanup. Metadata sharding is required because busy
authenticated-user and verified-IP buckets can receive many concurrent requests;
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

## Batched accounting for high-volume buckets

Every consumed request used to be one committed quota write. On 2026-11-01 that
was about 86% of all committed write transactions in production while Convex
write admission (`CommitterFull`) was saturated, so quota accounting was
competing with deploys, scanner acknowledgements and publication writes.

The `read` and `download` buckets therefore account in batches of four: one
request in four (chosen at random) consumes a count of four in one committed
write and refreshes retention metadata; every other request performs a
read-only component check for the same count of four and is denied when the
sampled shards cannot fit it. The check must use the batch count: with sharded
buckets, every shard can end at a remainder smaller than a batch (for example
1.75 of `readIp`'s 93.75 per shard), so a one-token check would keep admitting
traffic indefinitely after batched writes are denied.

Expected consumption equals the request count, committed consumption never
exceeds the limit, and admitted traffic is approximately the limit (random
sampling adds a small variance; a deterministic one-in-four replay against the
real component admits at most the limit at three times the load). Shard
fragmentation can strand up to one batch per shard, so a client at the very top
of the limit may be denied a few percent early (measured about 2,944 of 3,000
for `readIp`, against about 2,998 with exact accounting). Read-only checks are
Convex queries and may be served from the query cache; a cached denial can
outlive a window rollover until a sampled write touches its shards, which fails
closed. Denied read-only checks refresh retention metadata, preserving the
cleanup invariant above. A module-load guard rejects any batch larger than the
component's per-request maximum for a batched bucket.

`write`, `export` and `trustedPublish` stay exactly accounted because their
limits are low. Set `CLAWHUB_HTTP_RATE_LIMIT_BATCHING=off` to restore exact
per-request accounting for every bucket.

## Guarded RPC comparison

`CLAWHUB_HTTP_RATE_LIMIT_RPC_MODE` defaults to the existing separate metadata
refresh and quota-consume calls. Unset, `off`, and unknown values keep that path.
`admin-probe` allows an authenticated, active admin API-token caller to select
the combined path with `X-ClawHub-RateLimit-Rpc: combined`; omitting that header
selects the separate control. Only these admin probes receive the selected
strategy in the matching response header. Anonymous, ordinary-user, inactive,
and invalid-token callers cannot opt in. `on` selects the combined path for all
checks and ignores caller preferences. Set `off` to roll back the strategy.

The combined mutation attempts metadata refresh before consuming the same
component bucket. If metadata-table OCC exhausts retries, the entire combined
transaction (including component quota changes) rolls back, then the HTTP
caller retries the unchanged bare consumer once. Counter-table OCC still fails
closed with retryable 503. Other errors, including write-capacity failures,
propagate. Allowed and denied checks both refresh retention metadata, and
cleanup must still preserve an active key's quota. The response strategy labels
the attempted path; a metadata-conflict fallback can require a second call.

The switch changes RPC topology only: identity, policy, shard count, quota,
expiry, pruning, and public rate-limit headers are independent of this choice.
Promote from the admin-only comparison only after hosted measurements establish
a gain and the quota/retention checks pass. Native loopback timing alone does
not establish that gain.
