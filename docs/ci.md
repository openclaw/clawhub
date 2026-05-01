# CI

Pull requests are validated by `.github/workflows/ci.yml`.

## PR Checks

The `CI` workflow is intentionally split into named jobs so failures and required
status checks are precise:

- `static` runs peer dependency validation, dependency audit, formatting, lint,
  and dead-code checks.
- `unit` runs the Vitest coverage suite. This replaces a separate `test` run
  because coverage already executes the test suite.
- `packages` builds `packages/schema` and verifies the ClawHub CLI package.
- `types-build` typechecks the app, schema package, and CLI package, then builds
  the app.
- `e2e-http` runs the HTTP end-to-end suite.
- `playwright-smoke` builds the app and runs a chromium browser smoke against the
  public read backend.

For local reproduction, run the matching `ci:*` package scripts. `bun run ci:pr`
matches the non-browser PR gates. `bun run ci:playwright-smoke` assumes the
chromium Playwright browser has already been installed.

## Required Checks

GitHub rulesets should require these status checks on `main`:

- `CI / static`
- `CI / unit`
- `CI / packages`
- `CI / types-build`
- `CI / e2e-http`
- `CI / playwright-smoke`
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
