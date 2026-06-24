# Rate Limiting

## Security Intent

All public HTTP routes, including legacy `/api/...` and `/api/cli/...` routes
kept for compatibility, must pass through `applyRateLimit` before doing
expensive work, auth parsing, publish mutations, upload ticket creation,
telemetry writes, delete/undelete mutations, or search queries.

Client IP headers are not trustworthy on direct Convex HTTP endpoints. Treat
`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`, and `fly-client-ip` as
trusted only when the deployment explicitly enables trusted forwarded headers.
Do not enable that opt-in while the Convex `*.convex.site` HTTP origin remains
publicly reachable. Without the opt-in, anonymous traffic must use conservative
missing-IP fallback buckets scoped only by rate-limit kind. Missing-IP buckets
must not include user-controlled paths, dynamic path segments, query parameters,
package names, skill slugs, or artifact versions.
Artifact-specific download scoping is only safe after the caller has an
authenticated identity or a trusted client IP.

HTTP rate-limit counters are owned by the `@convex-dev/rate-limiter` component.
The app defines named fixed-window buckets for each public HTTP policy
(`read`, `write`, `trustedPublish`, `download`, and `export`) and for each
subject class (`ip`, authenticated API token user, and admin API token user).
Anonymous requests consume the `Ip` bucket for the route policy. Authenticated
requests consume only the `Key` or `AdminKey` bucket for their user, so shared
egress IPs do not drain user quota.

Component sharding is an implementation detail, not a quota multiplier. Keep
the public quota in `RATE_LIMITS`; the component's `shards` setting exists to
spread writes across counter rows while preserving the configured limit.
