---
summary: "Maintainer deploy checklist: Convex backend, Vercel web app, CLI npm release, and /api rewrites."
---

# Deploy

This is a maintainer runbook for the ClawHub project. It is intentionally kept
under `specs/` so it does not publish into the user-facing ClawHub docs tab.

ClawHub is two deployables:

- Web app (TanStack Start) -> typically Vercel.
- Convex backend -> Convex deployment (serves `/api/...` routes).

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
  -f tag=v0.11.0 \
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
commit status `Vercel - clawhub` for the selected SHA, then run smoke tests
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
- Optional: `GITHUB_TOKEN` (recommended; raises GitHub API limits used by publish gates)

## 2) Deploy web app (Vercel)

Set env vars:

- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL` (Convex "site" URL)
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

- update `vercel.json` to your deployment's Convex site URL.

## 4) Registry discovery

The CLI can discover the API base from:

1. explicit CLI/env override
2. configured registry URL
3. site URL registry metadata

Keep production rewrites and discovery metadata aligned before release.

## 5) Post-deploy checks

Run the contract verifier and smoke tests against production after deploy:

```bash
bun run verify:convex-contract -- --prod
PLAYWRIGHT_BASE_URL=https://clawhub.ai bunx playwright test e2e/menu-smoke.pw.test.ts e2e/upload-auth-smoke.pw.test.ts
```
