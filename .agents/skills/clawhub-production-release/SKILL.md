---
name: clawhub-production-release
description: Run and verify ClawHub production deploys and stable ClawHub CLI npm releases. Use when deploying backend or frontend changes to clawhub.ai, dispatching the Deploy workflow, publishing a stable CLI tag, checking release prerequisites, or proving the exact production SHA and workflow outcome.
---

# ClawHub Production Release

ClawHub production changes are manual-only. Merging to `main` does not deploy
the app or publish the CLI.

## Safety Rules

- Run production workflows from `main`.
- Re-read the workflow and exact `main` SHA immediately before dispatch.
- Require a successful `Deploy Test` workflow for that exact SHA before
  dispatching an app production deploy. This is an operator check until the
  production workflow enforces the gate directly.
- Do not treat a green workflow alone as proof. Record the workflow URL, exact
  deployed SHA, and live-surface verification.
- Do not add one-off migrations or repairs to the deploy workflow. Run
  operator-controlled data changes separately with `clawhub-convex` and
  `create-and-cleanup-migration`.
- Never start a production deploy or npm publish unless the user explicitly
  asked for that release action.

## App Production Deploy

The workflow is `.github/workflows/deploy.yml`.

1. Confirm the selected commit is on `origin/main` and record its SHA.
2. Find the successful Test deployment for that exact SHA and record its URL:

```bash
gh run list \
  --repo openclaw/clawhub \
  --workflow deploy-test.yml \
  --branch main \
  --commit <MAIN_SHA> \
  --status success \
  --limit 1
```

If no successful exact-SHA Test run exists, stop and fix or rerun Test before
releasing production.

3. Run the required pre-merge or release validation for the changed surface.
4. Dispatch one target:

```bash
gh workflow run deploy.yml \
  --repo openclaw/clawhub \
  --ref main \
  -f target=full \
  -f allow_deleting_large_indexes=false
```

Choose `full`, `backend`, or `frontend`:

- `full`: deploy Convex, wait for the matching Vercel production deployment,
  and run production smoke checks.
- `backend`: deploy Convex and run production HTTP smoke checks.
- `frontend`: wait for Vercel's production deployment for the selected `main`
  SHA, then run HTTP and UI smoke checks. The workflow does not call
  `vercel deploy`.

Set `allow_deleting_large_indexes=true` only after reviewing the Convex index
deletion and explicitly accepting it.

5. Capture the workflow run URL and wait for completion.
6. Verify the run used the expected SHA.
7. Verify the affected live route, API, or backend contract on
   `https://clawhub.ai`.
8. Report the Test workflow URL, production workflow URL, deployed SHA, target,
   and live proof.

The workflow uses the GitHub `Production` environment. Backend deploys require
the environment secret `CONVEX_DEPLOY_KEY`. The optional
`PLAYWRIGHT_AUTH_STORAGE_STATE_JSON` enables authenticated UI smoke coverage.

## Stable CLI npm Release

The workflow is `.github/workflows/clawhub-cli-npm-release.yml`. Stable tags
must use `vX.Y.Z`.

1. Confirm the tag points to the intended commit on `main`.
2. Dispatch validation-only preflight:

```bash
gh workflow run clawhub-cli-npm-release.yml \
  --repo openclaw/clawhub \
  --ref main \
  -f tag=vX.Y.Z \
  -f preflight_only=true
```

3. Wait for success and record the preflight run ID and URL.
4. Promote that exact artifact in the real publish:

```bash
gh workflow run clawhub-cli-npm-release.yml \
  --repo openclaw/clawhub \
  --ref main \
  -f tag=vX.Y.Z \
  -f preflight_only=false \
  -f preflight_run_id=<RUN_ID>
```

5. Wait for the `npm-release` environment job and verify the published version
   from npm.
6. Report the preflight URL, publish URL, tag, release SHA, and published
   version.

Real publishes use npm trusted publishing through the `npm-release` GitHub
environment. The trusted publisher must match repository
`openclaw/clawhub`, workflow `clawhub-cli-npm-release.yml`, and environment
`npm-release`.
