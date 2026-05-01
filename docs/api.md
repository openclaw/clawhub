---
summary: "Public REST API (v1) overview and conventions."
read_when:
  - Building API clients
  - Adding endpoints or schemas
---

# API v1

Base: `https://clawhub.ai`

OpenAPI: `/api/v1/openapi.json`

## Public catalog reuse

You can build a third-party catalog, directory, or search surface on top of ClawHub's public read APIs. Public skill metadata and skill files are published under ClawHub's skill license rules, while the API itself is rate-limited and should be consumed responsibly.

Guidelines:

- Use public read endpoints such as `GET /api/v1/skills`, `GET /api/v1/search`, and `GET /api/v1/skills/{slug}` for catalog listings.
- Cache responses and respect `429`, `Retry-After`, and rate-limit headers instead of polling aggressively.
- Link back to the canonical ClawHub skill URL when displaying listings so users can inspect the source registry record.
- Use canonical page URLs in the form `https://clawhub.ai/<owner>/<slug>`.
- Do not imply that ClawHub endorses, verifies, or operates the third-party site.
- Do not mirror hidden, private, or moderation-blocked content by bypassing public API filters or auth boundaries.

## Auth

- Public read: no token required.
- Write + account: `Authorization: Bearer clh_...`.

## Rate limits

Auth-aware enforcement:

- Anonymous requests: per IP.
- Authenticated requests (valid Bearer token): per user bucket.
- Missing/invalid token falls back to IP enforcement.

- Read: 600/min per IP, 2400/min per key
- Write: 45/min per IP, 180/min per key

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After` (on 429).

Semantics:

- `X-RateLimit-Reset`: Unix epoch seconds (absolute reset time)
- `RateLimit-Reset`: delay seconds until reset
- `Retry-After`: delay seconds to wait on `429`

Example `429`:

```http
HTTP/2 429
x-ratelimit-limit: 20
x-ratelimit-remaining: 0
x-ratelimit-reset: 1771404540
ratelimit-limit: 20
ratelimit-remaining: 0
ratelimit-reset: 34
retry-after: 34
```

Client handling:

- Prefer `Retry-After` when present.
- Otherwise use `RateLimit-Reset` or derive delay from `X-RateLimit-Reset`.
- Add jitter to retries.

## Endpoints

Public read:

- `GET /api/v1/search?q=...`
  - Optional filters: `highlightedOnly=true`, `nonSuspiciousOnly=true`
  - Legacy alias: `nonSuspicious=true`
- `GET /api/v1/skills?limit=&cursor=&sort=`
  - `sort`: `updated` (default), `createdAt` (`newest`), `downloads`, `stars` (`rating`), `installsCurrent` (`installs`), `installsAllTime`, `trending`
  - `cursor` applies to non-`trending` sorts
  - Optional filter: `nonSuspiciousOnly=true`
  - Legacy alias: `nonSuspicious=true`
  - With `nonSuspiciousOnly=true`, cursor-based pages may contain fewer than `limit` items; use `nextCursor` to continue.
- `GET /api/v1/skills/{slug}`
- `GET /api/v1/skills/{slug}/moderation`
- `GET /api/v1/skills/{slug}/versions?limit=&cursor=`
- `GET /api/v1/skills/{slug}/versions/{version}`
- `GET /api/v1/skills/{slug}/scan?version=&tag=`
- `GET /api/v1/skills/{slug}/file?path=&version=&tag=`
- `GET /api/v1/resolve?slug=&hash=`
- `GET /api/v1/download?slug=&version=&tag=`

Auth required:

- `POST /api/v1/skills` (publish, multipart preferred)
- `DELETE /api/v1/skills/{slug}`
- `POST /api/v1/skills/{slug}/undelete`
- `POST /api/v1/skills/{slug}/rename`
- `POST /api/v1/skills/{slug}/merge`
- `POST /api/v1/skills/{slug}/transfer`
- `POST /api/v1/skills/{slug}/transfer/accept`
- `POST /api/v1/skills/{slug}/transfer/reject`
- `POST /api/v1/skills/{slug}/transfer/cancel`
- `GET /api/v1/transfers/incoming`
- `GET /api/v1/transfers/outgoing`
- `GET /api/v1/whoami`

## Legacy

Legacy `/api/*` and `/api/cli/*` still available. See `DEPRECATIONS.md`.
