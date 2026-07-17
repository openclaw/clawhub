# CI

Pull requests are validated by `.github/workflows/ci.yml`.

## PR Checks

The `CI` workflow keeps the public required status checks stable while bundling
the short non-browser gates into one Blacksmith runner registration. The
`pr-gates` job runs the actual command steps for:

- `static` runs peer dependency validation, dependency audit, formatting, lint,
  and dead-code checks.
- `unit` runs the Vitest coverage suite. This replaces a separate `test` run
  because coverage already executes the test suite.
- `packages` builds `packages/schema` and verifies the ClawHub CLI package.
- `types-build` typechecks the app, schema package, and CLI package, then builds
  the app.
- `e2e-http` runs the secretless HTTP and CLI end-to-end subset.

The `static`, `unit`, `packages`, `types-build`, and `e2e-http` jobs are
hosted-runner compatibility mirrors of `pr-gates` so existing branch protection
rules do not need to change. Inspect the `pr-gates` step logs for the exact
failing command.

- `playwright-smoke` builds the app and runs a chromium browser smoke against the
  public read backend.
- `playwright-local-auth` uses `test:pw:local-auth` to start a local anonymous
  Convex backend with dev auth, then runs the chromium specs under
  `e2e/local-auth/`. Related low-risk specs are grouped so the matrix spends
  fewer Blacksmith runner registrations while keeping publish lifecycle checks
  isolated for easier failure triage. The account cleanup and moderation/star
  shards use 8-vCPU runners because their browser flows share the machine with
  the local Convex backend; the remaining shards use 4-vCPU runners. The matrix
  keeps `max-parallel: 3` to cap organization-level runner registrations.

For local reproduction, run the matching `ci:*` package scripts. `bun run ci:pr`
matches the non-browser PR gates. `bun run ci:playwright-smoke` assumes the
chromium Playwright browser has already been installed.

Vercel preview builds retry the Convex preview deploy up to three total attempts,
waiting 20 seconds and then 40 seconds. This tolerates transient
`get_config_hashes` 404 responses while a fresh preview deployment is provisioning.

To reproduce the local-auth browser gate locally, install the chromium
Playwright browser once and run:

```bash
bunx playwright install chromium
bun run test:pw:local-auth
```

To run one authenticated local browser spec through the same infra:

```bash
bun run test:pw:local-auth -- --project=chromium e2e/local-auth/<spec>.pw.test.ts
```

The local-auth runner uses dev auth and a local Convex deployment; it does not
need production credentials or a ClawHub auth token. It starts its own isolated
local Convex process and temporarily moves aside `.env.local` plus
`.convex/local/default`, then restores them afterward. Stop any already-running
local Convex process before running it.

The full `bun run test:e2e` suite includes token-backed CLI flows. Keep that for
local or secret-backed validation; PR CI should not require a developer auth
token or a local global ClawHub config.

## Maintenance Jobs

`Security Dataset Snapshot` exports live production security-review data for the
sanitized Hugging Face dataset. Keep its default fanout small enough that a
nightly run cannot dominate the org-level GitHub runner-registration bucket:
12 created-at shards per source kind, at most 32 planned matrix jobs, and
`max-parallel: 12`. Manual dispatches are also capped before shard planning, so a
large input cannot allocate a huge matrix before the guard runs. This workflow
publishes a complete replacement snapshot, so do not run overlapping dispatches
as a backfill strategy; make any higher-fanout backfill a deliberate temporary
workflow change with its own capacity plan.

## Required Checks

GitHub rulesets should require these status checks on `main`:

- `CI / static`
- `CI / unit`
- `CI / packages`
- `CI / types-build`
- `CI / e2e-http`
- `CI / playwright-smoke`
- `CI / playwright-local-auth`
- `Security Gate: Secret Scanning / Scan for Verified Secrets`

`CodeQL Light` is path-filtered and skipped for draft pull requests, so it should
not be marked required unless an always-present aggregate job is added.

The full multi-browser Playwright suite is not a required PR check yet. It still
needs stable read fixtures or a dedicated backend fixture before it can be a hard
gate without coupling every PR to live data and mobile-browser variance.

Production-only checks stay in the manual deploy workflow:

- `bun run verify:convex-contract -- --prod`
- `bun run test:e2e:prod-http`
- production Playwright smoke tests

Successful `full` and `frontend` production deploys create two annotated Git
tags:

- `deploy/prod/YYYYMMDD-HHMMSSZ-<sha7>`: immutable audit tag with exact deploy
  time and commit.
- `prod/vYYYY.MM.DD.N`: clean human rollback tag, incremented per UTC day.

Both tags point to the deployed commit and record the GitHub Actions run plus the
Vercel deployment URL when GitHub's Vercel status exposes it.

Use these tags as the audit map for rollback selection. Vercel traffic rollback
still happens through Vercel's deployment rollback/promote controls; the Git tag
is the stable source pointer for the deployed build.
