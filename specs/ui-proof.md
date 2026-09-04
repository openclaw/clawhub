# UI Proof Runtime

Remote `proof:ui` lanes prove the full stack from their source and fresh local
data; there is no shared/production-backend mode. `--mode before-after` compares
baseline/candidate; `--mode feature` runs the candidate. The optional Crabbox
runner bootstraps lanes; `--runner local` only attaches to maintainer-started
loopback instances, keeping baseline/candidate URLs and artifacts separate.

## Isolation and trust

Remote lanes use the trusted wrapper's helper/runtime, even for older baselines.
Push, seed and build run from the lane app root. The remote shell selects source
and execs the Node lane owner; it does not own background servers or cleanup.
The local caller may have ignored `.env.local`/`.convex`: syncing must not hydrate
those files. Reject unsafe `--env` overrides before requesting a lease.

The actual remote wrapper/app roots must reject `.convex`, `.env` and `.env.*`
(except example/sample/template files) by name, without reading or deleting them.
Check initially, after source push, and after preparation/seed when they run.
No cloud auth or operator state is read, copied or sourced. Source/scenarios are
executable input; this helper is not a sandbox and retains Crabbox's trust boundary.

Each lane owns fresh mode-0700 state outside source/artifacts: HOME, XDG paths,
caches, binaries, temporary files, database and storage. The identity and secret
are fresh; the self-host CLI selection file is mode 0600. Child environments
inherit only PATH/DISPLAY plus explicit lane settings. Install hooks run before
credentials exist. Use `bun install --frozen-lockfile`, not the invalid
`bun --no-env-file install`; runtime invocations retain `--no-env-file`.
Bun/unzip provisioning remains bounded and noninteractive. `--skip-install`
skips dependency reinstallation; browser binaries are still installed in the
fresh private cache, never loaded from an operator browser profile/cache.

## Backend and source readiness

Check installed CLI package metadata for exactly **1.44.0** and invoke its direct
`bin/main.js`, never copied `.bin` launchers. Smoke verifies its executable version once. The backend release and verified platform ZIP digests live in the
helper's pin table; never resolve latest or execute an unverified archive.

Pass `--interface 127.0.0.1`, both fixed lane ports and loopback origin/site URLs.
The pinned backend's
[config.rs](https://github.com/get-convex/convex-backend/blob/precompiled-2026-08-25-7cce8fb/crates/local_backend/src/config.rs)
uses that interface for both API and site bind addresses;
[main.rs](https://github.com/get-convex/convex-backend/blob/precompiled-2026-08-25-7cce8fb/crates/local_backend/src/main.rs)
uses both addresses to start listeners. Recheck these paths when changing the pin.
Disable backend beacon telemetry and CLI Sentry (`CI=1`); start no dashboard.

Check all three fixed ports before preparation and again before backend startup.
Never adopt an occupied listener. Require exact fresh `/instance_name`, then:

```sh
node <verified-cli> run --push --typecheck disable --codegen disable appMeta:getDeploymentInfo '{}' --env-file <private-file>
```

Recheck identity and source cleanliness, then run a separate `run --no-push`
readiness query before seed/build/browser. **Do not use `dev --local` or
`dev --once`.** CLI 1.44.0's configuring `dev` path writes `.env.local` even with
explicit self-hosted selection; `run --push` bypasses it. The selection file has
only self-host URL/admin key. Private HOME also prevents fallback global-auth
lookup. Keep the app's `local:<fresh-instance>` marker separate from CLI selection.

`--dev-auth` explicitly sets backend `DEV_AUTH_ENABLED` and
`DEV_AUTH_CONVEX_DEPLOYMENT` via `convex env set`, plus frontend opt-in. Seed gets
only disposable self-host credentials and the direct CLI/private-file paths;
build/browser get no admin key. The pinned backend requires its instance secret
in argv: never log process arguments. Keygen output is private. Other child
output is bounded and redacted, including split/truncated secrets, before logging.

## Lifecycle and completion

One controller handles backend/preview exit, deadline, INT and TERM. Own process
groups, not only leaders. Cleanup sends TERM (INT for ffmpeg), waits boundedly,
then escalates to KILL. An exited leader must get a bounded close/reaping wait
before its group is probed: macOS can report EPERM between exit and close.
Closed pipes do not prove descendants are gone; after ESRCH never signal that
numeric group again. Permission denial fails that record without alternate
signals, while all other groups are still attempted. KILL is accepted before the
group disappears: a killed descendant stays in the group as a zombie until init
reaps it, so proofs of group teardown must poll with a bound, never probe once.

Preserve primary failures alongside cleanup errors. Write redacted diagnostics
and attempt private-state removal even when shutdown/logging fails. Write
`bootstrap-summary.json` only after cleanup. Remote success requires both it and
the UI manifest to pass; completed passing manifests may recover transport errors,
but screenshots cannot hide missing/failed bootstrap completion. Local attach
uses only its UI manifest. SIGKILL/host loss still requires outer containment.

## Verification and limits

Focused tests use the real owner with narrow I/O seams and real process-tree
cleanup without listeners. Avoid dotenv loading and copied launchers:

```sh
node --input-type=module -e 'import {startVitest} from "vitest/node"; const ctx=await startVitest("test",["scripts/ui-proof.test.mjs","scripts/ui-proof-backend.test.mjs","scripts/ui-proof-runtime.test.mjs","scripts/ui-proof-publish.test.mjs"],{run:true},{envDir:false});await ctx.close();'
```

The opt-in smoke **starts servers**; use the approved `preview_start`/server
launcher, never a background shell, with independently verified inputs:

```sh
node scripts/ui-proof-backend-smoke.mjs --run --cli /verified/convex-1.44.0/package/bin/main.js --backend-archive /verified/convex-local-backend-aarch64-apple-darwin.zip
```

It proves baseline/candidate source, fresh DB write/read, dev auth off/on/off,
identity, API/site loopback sockets on macOS, completion and teardown. Supporting
dependencies still come from the installed snapshot. It does not certify full-app
build/browser behavior; follow it with real ClawHub UI proof. Parent failure tests
use disposable malformed-source/missing-query/occupied-port fixtures and signals,
never operator services, and verify no continuation plus complete teardown.
