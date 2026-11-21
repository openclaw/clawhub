# Dependency upgrade qualification

`bun run test:dependency-compat` installs the small, frozen baseline fixture in
`scripts/fixtures/dependency-baseline`, then runs offline package compatibility
checks. It does not change the application's selected dependency versions.

The baseline pins Convex 1.49.0, Workpool 0.4.15, and Vercel OIDC 4.0.8. Its
private install pins xdg-app-paths 5.5.1; the candidate OIDC 4.0.9 must still
resolve cli-config 0.4.0 and xdg-app-paths 5.1.0. The tests verify actual resolved
package versions before exercising behavior.

Every child receives a temporary HOME and working directory, synthetic tokens,
and an allowlisted environment. A private marker and nonce bind each child to
its canonical HOME and working directory; direct invocation fails before package
loading or credential writes. The ordinary Linux unit job runs this same command. Unexpected HTTP, socket, and subprocess calls
fail. OIDC refresh uses an in-memory response; no request reaches Vercel.

The Convex probe binds exact published CLI bundle hashes and exposes unchanged
account helper bodies in memory by replacing only the known final CLI entry
invocation. This checks legacy-file readability, preserved settings, account
selection, and permission changes. It does not test authenticated account
access, login, or the full CLI command dispatcher.

The OIDC probe runs both real package implementations against XDG, legacy, and
precedence fixtures. It checks request, environment, and file tokens plus cached
refresh and configuration lookup. This qualifies the executing platform's path
semantics; it is not proof of an untested operating system.

These offline checks do not establish Workpool persisted-state compatibility.
That requires a separate real-backend upgrade preserving one database across
the baseline and candidate component deployments. Once a candidate stores
`errorData` in a failed completion, do not assume Workpool 0.4.15 can read it.

## Retained database fixture

The manual fixture runs on Linux or macOS with Bun 1.4.4 and a supported Node.js
version from `CONTRIBUTING.md`. Use a fresh, task-owned checkout with frozen root
dependencies and no copied `.env.local` or `.convex` state. Run the offline command
above first to install its exact baseline packages.

The fixture expects the pinned backend executable in the private cache at
`.artifacts/native-home/.cache/convex/binaries/precompiled-2026-10-22-1447815/convex-local-backend`.
Populate that cache through the existing local-auth harness. This command boots
and shuts down the normal harness, but only lists browser tests; it does not claim
to run them. Its clean environment prevents inherited deployment credentials.
The harness also performs its normal dependency warmup and application build.

```bash
mkdir -p -m 700 .artifacts/native-home
env -i PATH="$PATH" HOME="$PWD/.artifacts/native-home" CI=1 \
  CLAWHUB_LOCAL_CHECK_MODE=throttled \
  PLAYWRIGHT_LOCAL_AUTH_BACKEND_VERSION=precompiled-2026-10-22-1447815 \
  bun run test:pw:local-auth -- --list
bun scripts/run-local-component-upgrade.ts --run
```

Ports 43220 and 43221 must be free. The runner copies only the owned, validated
backend executable into a fresh private HOME. It creates a disposable source
capsule under `.artifacts/component-upgrade` and uses a separate task-owned Bun
package cache. The live application checkout and its dependency versions are
unchanged. No remote deployment or real account credentials are used.

The baseline deploys Convex 1.49.0 and Workpool 0.4.15. A real failing action waits
on an explicit gate while a real report is enqueued and the pool is paused in the
same transaction. The action then fails through the released worker. Official
component-scoped queries verify the old failed completion and pending report.

The fixture restores the exact candidate lockfile, deploys Convex 1.50.0 and
Workpool 0.4.16 into the same backend and database, compares the paused persisted
state, and only then releases the queue. It requires the original report to
complete, the old completion to drain, and a new failure to retain `errorData`.
The result qualifies this forward upgrade on the pinned backend, not rollback
or every production data shape.

Success removes the capsule and stops the backend. Failure stops the backend
and retains the capsule. The named pre-push, seeded, and paused continuation
modes require the recorded source hash and validate their exact state before
continuing; they never reset the database or replay completed enqueue steps.
Do not use a continuation mode after the candidate has been deployed. Failed
state requires inspection before choosing a continuation.
