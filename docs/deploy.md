---
summary: "Deploy checklist: Convex backend + Vercel web app + /api rewrites."
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
bunx convex env set APP_BUILD_SHA "$(git rev-parse HEAD)" --prod
bunx convex env set APP_DEPLOYED_AT "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --prod
bunx convex deploy
```

Or use the GitHub Actions pipeline:

```bash
gh workflow run deploy.yml --repo openclaw/clawhub --ref main
```

Production deploy notes:

- `deploy.yml` is manual-only (`workflow_dispatch`). Merging to `main` does not deploy.
- The workflow must be started from `main`.
- Deploy targets:
  - `full`: deploy Convex, verify contract, wait for the matching Vercel production deploy, then run smoke tests
  - `backend`: deploy Convex, verify contract, then run smoke tests against current production
  - `frontend`: wait for the Vercel production deploy for the selected `main` SHA, then run smoke tests
- `frontend` does not call `vercel deploy` directly yet. It relies on the existing Vercel Git-based production deploy for that SHA.
- The real deploy job uses the GitHub `Production` environment for deploy secrets, but it does not wait for a separate approval.
- Required `Production` environment secret: `CONVEX_DEPLOY_KEY`.
- Optional `Production` environment secret: `PLAYWRIGHT_AUTH_STORAGE_STATE_JSON` for authenticated smoke coverage.

## CLI npm release

The `clawhub` CLI package is released separately from the app deploy.
Only stable releases are supported here: `vX.Y.Z`.

Use the GitHub Actions workflow:

```bash
gh workflow run clawhub-cli-npm-release.yml \
  --repo openclaw/clawhub \
  --ref main \
  -f tag=v0.10.0 \
  -f preflight_only=true
```

Then rerun the same workflow from `main` with:

- the same `tag`
- `preflight_only=false`
- `preflight_run_id=<successful preflight run id>`

CLI release notes:

- Real publishes are manual-only and require the workflow to be started from `main`.
- The publish job waits at the GitHub `npm-release` environment for approval.
- npm auth is handled through npm trusted publishing, not an `NPM_TOKEN`.
- npm trusted publisher must be configured for package `clawhub` with repository `openclaw/clawhub`, workflow `clawhub-cli-npm-release.yml`, and environment `npm-release`.

That workflow assumes Vercel Git integration is enabled for this repo. It does
not run `vercel deploy` directly; frontend-related steps wait for the GitHub
commit status `Vercel – clawhub` for the selected SHA, then run smoke tests
against production.

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
- `VITE_APP_BUILD_SHA` (set to the same commit SHA stamped into Convex)

Deploy order:

1. Convex
2. contract verify
3. wait for Vercel production deploy for the same Git SHA
4. smoke

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

Drift checks:

```bash
bun run verify:convex-contract -- --prod
PLAYWRIGHT_BASE_URL=https://clawhub.ai bunx playwright test e2e/menu-smoke.pw.test.ts e2e/upload-auth-smoke.pw.test.ts
```

The Playwright smoke suite should fail on visible error UI, page errors, and
browser console errors.

Proxy/IP caveat:

- Default IP source is `cf-connecting-ip`.
- For non-Cloudflare trusted proxy setups, set `TRUST_FORWARDED_IPS=true`.
- If proxy headers are not forwarded/trusted correctly, multiple users may collapse into one IP and hit false-positive rate limits.
