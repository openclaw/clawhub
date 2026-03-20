---
summary: "HTTP API reference (public + CLI endpoints + auth)."
read_when:
  - Adding/changing endpoints
  - Debugging CLI ↔ registry requests
---

# HTTP API

Base URL: `https://clawhub.ai` (default).

All v1 paths are under `/api/v1/...` and implemented by Convex HTTP routes (`convex/http.ts`).
Legacy `/api/...` and `/api/cli/...` remain for compatibility (see `DEPRECATIONS.md`).
OpenAPI: `/api/v1/openapi.json`.

## Rate limits

Enforcement model:

- Anonymous requests: enforced per IP.
- Authenticated requests (valid Bearer token): enforced per user bucket.
- If token is missing/invalid, behavior falls back to IP enforcement.

- Read: 120/min per IP, 600/min per key
- Write: 30/min per IP, 120/min per key
- Download: 20/min per IP, 120/min per key (`/api/v1/download`)

Headers:

- Legacy compatibility: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- Standardized: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`
- On `429`: `Retry-After`

Header semantics:

- `X-RateLimit-Reset`: absolute Unix epoch seconds
- `RateLimit-Reset`: seconds until reset (delay)
- `Retry-After`: seconds to wait before retry (delay) on `429`

Example `429` response:

```http
HTTP/2 429
content-type: text/plain; charset=utf-8
x-ratelimit-limit: 20
x-ratelimit-remaining: 0
x-ratelimit-reset: 1771404540
ratelimit-limit: 20
ratelimit-remaining: 0
ratelimit-reset: 34
retry-after: 34

Rate limit exceeded
```

Client guidance:

- If `Retry-After` exists, wait that many seconds before retry.
- Use jittered backoff to avoid synchronized retries.
- If `Retry-After` is missing, fallback to `RateLimit-Reset` (or compute from `X-RateLimit-Reset`).

IP source:

- Uses `cf-connecting-ip` (Cloudflare) for client IP by default.
- Set `TRUST_FORWARDED_IPS=true` to opt in to `x-forwarded-for`, `x-real-ip`, or `fly-client-ip` (non-Cloudflare deployments).
- If you run behind a reverse proxy/load balancer, ensure real client IP headers are preserved and trusted correctly, or rate limits may be too strict due to shared proxy IPs.

## Public endpoints (no auth)

### `GET /api/v1/search`

Query params:

- `q` (required): query string
- `limit` (optional): integer
- `highlightedOnly` (optional): `true` to filter to highlighted skills
- `nonSuspiciousOnly` (optional): `true` to hide suspicious (`flagged.suspicious`) skills
- `nonSuspicious` (optional): legacy alias for `nonSuspiciousOnly`

Response:

```json
{
  "results": [
    {
      "score": 0.123,
      "slug": "gifgrep",
      "displayName": "GifGrep",
      "summary": "…",
      "version": "1.2.3",
      "updatedAt": 1730000000000
    }
  ]
}
```

Notes:

- Results are returned in relevance order (embedding similarity + exact slug/name token boosts + popularity prior from downloads).

### `GET /api/v1/skills`

Query params:

- `limit` (optional): integer (1–200)
- `cursor` (optional): pagination cursor for any non-`trending` sort
- `sort` (optional): `updated` (default), `downloads`, `stars` (alias: `rating`), `installsCurrent` (alias: `installs`), `installsAllTime`, `trending`
- `nonSuspiciousOnly` (optional): `true` to hide suspicious (`flagged.suspicious`) skills
- `nonSuspicious` (optional): legacy alias for `nonSuspiciousOnly`

Notes:

- `trending` ranks by installs in the last 7 days (telemetry-based).
- When `nonSuspiciousOnly=true`, cursor-based sorts may return fewer than `limit` items on a page because suspicious skills are filtered after page retrieval.
- Use `nextCursor` to continue pagination when present. A short page does not by itself mean end-of-results.

Response:

```json
{
  "items": [
    {
      "slug": "gifgrep",
      "displayName": "GifGrep",
      "summary": "…",
      "tags": { "latest": "1.2.3" },
      "stats": {},
      "createdAt": 0,
      "updatedAt": 0,
      "latestVersion": { "version": "1.2.3", "createdAt": 0, "changelog": "…" },
      "metadata": { "os": ["macos"], "systems": ["aarch64-darwin"] }
    }
  ],
  "nextCursor": null
}
```

### `GET /api/v1/skills/{slug}`

Response:

```json
{
  "skill": {
    "slug": "gifgrep",
    "displayName": "GifGrep",
    "summary": "…",
    "tags": { "latest": "1.2.3" },
    "stats": {},
    "createdAt": 0,
    "updatedAt": 0
  },
  "latestVersion": { "version": "1.2.3", "createdAt": 0, "changelog": "…" },
  "metadata": { "os": ["macos"], "systems": ["aarch64-darwin"] },
  "owner": { "handle": "steipete", "displayName": "Peter", "image": null },
  "moderation": {
    "isSuspicious": false,
    "isMalwareBlocked": false,
    "verdict": "clean",
    "reasonCodes": [],
    "summary": null,
    "engineVersion": "v2.0.0",
    "updatedAt": 0
  }
}
```

Notes:

- Old slugs created by owner rename/merge flows resolve to the canonical skill.
- `metadata.os`: OS restrictions declared in skill frontmatter (e.g. `["macos"]`, `["linux"]`). `null` if not declared.
- `metadata.systems`: Nix system targets (e.g. `["aarch64-darwin", "x86_64-linux"]`). `null` if not declared.
- `metadata` is `null` if the skill has no platform metadata.
- `moderation` is included only when the skill is flagged or the owner is viewing it.

### `GET /api/v1/skills/{slug}/moderation`

Returns structured moderation state.

Response:

```json
{
  "moderation": {
    "isSuspicious": true,
    "isMalwareBlocked": false,
    "verdict": "suspicious",
    "reasonCodes": ["suspicious.dynamic_code_execution"],
    "summary": "Detected: suspicious.dynamic_code_execution",
    "engineVersion": "v2.0.0",
    "updatedAt": 0,
    "legacyReason": null,
    "evidence": [
      {
        "code": "suspicious.dynamic_code_execution",
        "severity": "critical",
        "file": "index.ts",
        "line": 3,
        "message": "Dynamic code execution detected.",
        "evidence": ""
      }
    ]
  }
}
```

Notes:

- Owners and staff can access moderation details for hidden skills.
- Public callers only get `200` for already-flagged visible skills.
- Evidence is redacted for public callers and only includes raw snippets for owners/staff.

### `GET /api/v1/skills/{slug}/versions`

Query params:

- `limit` (optional): integer
- `cursor` (optional): pagination cursor

### `GET /api/v1/skills/{slug}/versions/{version}`

Returns version metadata + files list.

- `version.security` includes normalized scan verification status and scanner details
  (VirusTotal + LLM), when available.

### `GET /api/v1/skills/{slug}/scan`

Returns security scan verification details for a skill version.

Query params:

- `version` (optional): specific version string.
- `tag` (optional): resolve a tagged version (for example `latest`).

Notes:

- If neither `version` nor `tag` is provided, uses the latest version.
- Includes normalized verification status plus scanner-specific details.
- `security.hasScanResult` is `true` only when a scanner produced a definitive verdict (`clean`, `suspicious`, or `malicious`).
- `moderation` is a current skill-level moderation snapshot derived from the latest version.
- When querying a historical version, check `moderation.matchesRequestedVersion` and `moderation.sourceVersion` before treating `moderation` and `security` as the same version context.

### `GET /api/v1/skills/{slug}/file`

Returns raw text content.

Query params:

- `path` (required)
- `version` (optional)
- `tag` (optional)

Notes:

- Defaults to latest version.
- File size limit: 200KB.

### `GET /api/v1/resolve`

Used by the CLI to map a local fingerprint to a known version.

Query params:

- `slug` (required)
- `hash` (required): 64-char hex sha256 of the bundle fingerprint

Response:

```json
{ "slug": "gifgrep", "match": { "version": "1.2.2" }, "latestVersion": { "version": "1.2.3" } }
```

### `GET /api/v1/download`

Downloads a zip of a skill version.

Query params:

- `slug` (required)
- `version` (optional): semver string
- `tag` (optional): tag name (e.g. `latest`)

Notes:

- If neither `version` nor `tag` is provided, the latest version is used.
- Soft-deleted versions return `410`.
- Download stats are counted as unique identities per hour (`userId` when API token is valid, otherwise IP).

## Auth endpoints (Bearer token)

All endpoints require:

```
Authorization: Bearer clh_...
```

### `GET /api/v1/whoami`

Validates token and returns the user handle.

### `POST /api/v1/skills`

Publishes a new version.

- Preferred: `multipart/form-data` with `payload` JSON + `files[]` blobs.
- JSON body with `files` (storageId-based) is also accepted.

### `DELETE /api/v1/skills/{slug}` / `POST /api/v1/skills/{slug}/undelete`

Soft-delete / restore a skill (owner, moderator, or admin).

Status codes:

- `200`: ok
- `401`: unauthorized
- `403`: forbidden
- `404`: skill/user not found
- `500`: internal server error

### Owner slug management endpoints

- `POST /api/v1/skills/{slug}/rename`
  - Body: `{ "newSlug": "new-canonical-slug" }`
  - Response: `{ "ok": true, "slug": "new-canonical-slug", "previousSlug": "old-slug" }`
- `POST /api/v1/skills/{slug}/merge`
  - Body: `{ "targetSlug": "canonical-target-slug" }`
  - Response: `{ "ok": true, "sourceSlug": "old-slug", "targetSlug": "canonical-target-slug" }`

Notes:

- Both endpoints require API token auth and only work for the skill owner.
- `rename` preserves the previous slug as a redirect alias.
- `merge` hides the source listing and redirects the source slug to the target listing.

### Transfer ownership endpoints

- `POST /api/v1/skills/{slug}/transfer`
  - Body: `{ "toUserHandle": "target_handle", "message": "optional" }`
  - Response: `{ "ok": true, "transferId": "skillOwnershipTransfers:...", "toUserHandle": "target_handle", "expiresAt": 1730000000000 }`
- `POST /api/v1/skills/{slug}/transfer/accept`
- `POST /api/v1/skills/{slug}/transfer/reject`
- `POST /api/v1/skills/{slug}/transfer/cancel`
  - Response (accept/reject/cancel): `{ "ok": true, "skillSlug": "demo-skill?" }`
- `GET /api/v1/transfers/incoming`
- `GET /api/v1/transfers/outgoing`
  - Response shape: `{ "transfers": [{ "_id": "...", "skill": { "slug": "demo", "displayName": "Demo" }, "fromUser"|"toUser": { "handle": "..." }, "message": "...", "requestedAt": 0, "expiresAt": 0 }] }`

### `POST /api/v1/users/ban`

Ban a user and hard-delete owned skills (moderator/admin only).

Body:

```json
{ "handle": "user_handle", "reason": "optional ban reason" }
```

or

```json
{ "userId": "users_...", "reason": "optional ban reason" }
```

Response:

```json
{ "ok": true, "alreadyBanned": false, "deletedSkills": 3 }
```

### `POST /api/v1/users/role`

Change a user role (admin only).

Body:

```json
{ "handle": "user_handle", "role": "moderator" }
```

or

```json
{ "userId": "users_...", "role": "admin" }
```

Response:

```json
{ "ok": true, "role": "moderator" }
```

### `GET /api/v1/users`

List or search users (admin only).

Query params:

- `q` (optional): search query
- `query` (optional): alias for `q`
- `limit` (optional): max results (default 20, max 200)

Response:

```json
{
  "items": [
    {
      "userId": "users_...",
      "handle": "user_handle",
      "displayName": "User",
      "name": "User",
      "role": "moderator"
    }
  ],
  "total": 1
}
```

### `POST /api/v1/stars/{slug}` / `DELETE /api/v1/stars/{slug}`

Add/remove a star (highlights). Both endpoints are idempotent.

Responses:

```json
{ "ok": true, "starred": true, "alreadyStarred": false }
```

```json
{ "ok": true, "unstarred": true, "alreadyUnstarred": false }
```

## Legacy CLI endpoints (deprecated)

Still supported for older CLI versions:

- `GET /api/cli/whoami`
- `POST /api/cli/upload-url`
- `POST /api/cli/publish`
- `POST /api/cli/telemetry/sync`
- `POST /api/cli/skill/delete`
- `POST /api/cli/skill/undelete`

See `DEPRECATIONS.md` for removal plan.

## Registry discovery (`/.well-known/clawhub.json`)

The CLI can discover registry/auth settings from the site:

- `/.well-known/clawhub.json` (JSON, preferred)
- `/.well-known/clawdhub.json` (legacy)

Schema:

```json
{ "apiBase": "https://clawhub.ai", "authBase": "https://clawhub.ai", "minCliVersion": "0.0.5" }
```

If you self-host, serve this file (or set `CLAWHUB_REGISTRY` explicitly; legacy `CLAWDHUB_REGISTRY`).
