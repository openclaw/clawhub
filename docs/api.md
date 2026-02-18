---
summary: 'Public REST API (v1) overview and conventions.'
read_when:
  - Building API clients
  - Adding endpoints or schemas
---

# API v1

Base: `https://clawhub.ai`

OpenAPI: `/api/v1/openapi.json`

## Auth

- Public read: no token required.
- Write + account: `Authorization: Bearer clh_...`.

## Rate limits

Auth-aware enforcement:

- Anonymous requests: per IP.
- Authenticated requests (valid Bearer token): per user bucket.
- Missing/invalid token falls back to IP enforcement.

- Read: 120/min per IP, 600/min per key
- Write: 30/min per IP, 120/min per key

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
- `GET /api/v1/skills?limit=&cursor=&sort=`
  - `sort`: `updated` (default), `downloads`, `stars` (`rating`), `installsCurrent` (`installs`), `installsAllTime`, `trending`
- `GET /api/v1/skills/{slug}`
- `GET /api/v1/skills/{slug}/versions?limit=&cursor=`
- `GET /api/v1/skills/{slug}/versions/{version}`
- `GET /api/v1/skills/{slug}/file?path=&version=&tag=`
- `GET /api/v1/resolve?slug=&hash=`
- `GET /api/v1/download?slug=&version=&tag=`

Auth required:

- `POST /api/v1/skills` (publish, multipart preferred)
- `DELETE /api/v1/skills/{slug}`
- `POST /api/v1/skills/{slug}/undelete`
- `GET /api/v1/whoami`

## Legacy

Legacy `/api/*` and `/api/cli/*` still available. See `DEPRECATIONS.md`.
