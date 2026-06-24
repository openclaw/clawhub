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
- The catalog-taxonomy digest and high-/medium-confidence classification rollout migrations were
  one-time production operations and are no longer part of the deploy checklist.
- While `migrations:runCatalogMetadataCanonicalization` exists, backend deploys that include it require
  an operator to dry-run, explicitly apply, and verify both tracked migrations before inferred-topic
  and inferred-category compatibility can be removed:

  ```bash
  bunx convex run migrations:runCatalogMetadataCanonicalization '{"dryRun":true}' --prod
  bunx convex run migrations:runCatalogMetadataCanonicalization \
    '{"dryRun":false,"confirm":"canonicalize-catalog-metadata"}' --prod
  bunx convex run --component migrations lib:getStatus --watch --prod
  ```

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
- After a successful npm publish, the workflow creates or updates the matching GitHub Release from the `CHANGELOG.md` section and appends npm tarball/integrity proof.

If npm publish succeeds but GitHub Release creation needs repair, rerun the
GitHub Release workflow without publishing to npm again:

```bash
gh workflow run clawhub-cli-github-release.yml \
  --repo openclaw/clawhub \
  --ref main \
  -f tag=v0.11.0 \
  -f preflight_run_id=<successful preflight run id> \
  -f update_existing=false
```

If the original publish workflow failed after npm publish while creating the
GitHub Release, omit `publish_run_id`; the repair workflow accepts only
successful proof run ids.

Use `update_existing=true` only when intentionally replacing the body for an
existing GitHub Release.

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
- `RESEND_API_KEY` for account-ban notification email
- `CLAWHUB_SECURITY_EMAIL_FROM` for the outbound From header, defaulting to
  `ClawHub Security <noreply@notifications.openclaw.ai>` on the verified Resend
  domain
- `CLAWHUB_NOREPLY_FROM` for guarded staff emails, defaulting to
  `ClawHub <noreply@notifications.openclaw.ai>` on the verified Resend domain
- `SITE_URL` (your web app URL)
- Optional webhook env (see `docs/webhook.md`)
- Recommended GitHub App env for authenticated GitHub API reads used by publish
  gates:
  - `GITHUB_APP_ID`
  - `GITHUB_APP_INSTALLATION_ID`
  - `GITHUB_APP_PRIVATE_KEY`
- Optional fallback: `GITHUB_TOKEN` (used when GitHub App auth is unavailable,
  and for arbitrary public repository lookups such as trusted-publisher setup)

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

### Hosted catalog feed

Refresh the OpenClaw hosted plugin and skill feeds after the production Convex
deployment has the catalog projections:

```bash
gh workflow run publish-catalog-feed.yml --repo openclaw/clawhub --ref main
```

The workflow stores both current feed snapshots in Convex and serves them
through `/v1/feeds/plugins` and `/v1/feeds/skills` with public edge-cache
validators. The unversioned `/feeds/plugins` and `/feeds/skills` paths redirect
to their versioned routes. Attach `registry.openclaw.ai` to the same Vercel
project before configuring OpenClaw's default feed URLs.

## 5) Post-deploy checks

Run the contract verifier and smoke tests against production after deploy:

```bash
bun run verify:convex-contract -- --prod
PLAYWRIGHT_BASE_URL=https://clawhub.ai bunx playwright test e2e/menu-smoke.pw.test.ts e2e/upload-auth-smoke.pw.test.ts
```
