---
summary: 'Deploy checklist: Convex backend + Vercel web app + /api rewrites.'
read_when:
  - Shipping to production
  - Debugging /api routing
---

# Deploy

ClawHub is two deployables:

- Web app (TanStack Start) → typically Vercel.
- Convex backend → Convex deployment (serves `/api/...` routes).

## 1) Deploy Convex

From your local machine:

```bash
bunx convex deploy
```

Ensure Convex env is set (auth + embeddings):

- `AUTH_GITHUB_ID`
- `AUTH_GITHUB_SECRET`
- `CONVEX_SITE_URL`
- `JWT_PRIVATE_KEY`
- `JWKS`
- `OPENAI_API_KEY`
- `SITE_URL` (your web app URL)
- Optional webhook env (see `docs/webhook.md`)
- Optional: `GITHUB_TOKEN` (recommended; raises GitHub account lookup limit used by publish gate)

## 2) Deploy web app (Vercel)

Set env vars:

- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL` (Convex “site” URL)
- `CONVEX_SITE_URL` (same value; used by auth provider config)
- `SITE_URL` (web app URL)

## 3) Route `/api/*` to Convex

This repo currently uses `vercel.json` rewrites:

- `source: /api/:path*`
- `destination: https://<deployment>.convex.site/api/:path*`

For self-host:

- update `vercel.json` to your deployment’s Convex site URL.

## 4) Registry discovery

The CLI can discover the API base from:

- `/.well-known/clawhub.json` (preferred)
- `/.well-known/clawdhub.json` (legacy)

If you don’t serve that file, users must set:

```bash
export CLAWHUB_REGISTRY=https://your-site.example
```

## 5) Post-deploy checks

```bash
curl -i "https://<site>/api/v1/search?q=test"
curl -i "https://<site>/api/v1/skills/gifgrep"
```

Then:

```bash
clawhub login --site https://<site>
clawhub whoami
```

Rate-limit sanity checks:

```bash
curl -i "https://<site>/api/v1/download?slug=gifgrep"
```

Confirm headers are present:

- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`
- `Retry-After` on `429`

Proxy/IP caveat:

- Default IP source is `cf-connecting-ip`.
- For non-Cloudflare trusted proxy setups, set `TRUST_FORWARDED_IPS=true`.
- If proxy headers are not forwarded/trusted correctly, multiple users may collapse into one IP and hit false-positive rate limits.
