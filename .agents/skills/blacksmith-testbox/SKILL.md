---
name: blacksmith-testbox
description: Run Blacksmith Testbox for ClawHub CI-parity checks, hosted services, broad Bun gates, or builds local cannot reproduce without hurting developer machines.
---

# Blacksmith Testbox

## Scope

Use Testbox when you need remote CI parity, injected secrets, hosted services,
or an OS/runtime image that your local machine cannot provide cheaply.

Do not default to Testbox for every local test/build loop. If the repo has
documented local commands for normal iteration, use those first so you keep
warm caches, local build state, and fast feedback.

Testbox is the expensive path. Reach for it deliberately.

ClawHub maintainers can opt into Testbox-first validation by setting
`CLAWHUB_TESTBOX=1` in their environment or standing agent rules. This mode is
maintainers-only and requires Blacksmith access.

When `CLAWHUB_TESTBOX=1` is set in ClawHub:

- Pre-warm a Testbox early for longer, wider, or uncertain work.
- Prefer Testbox for broad Bun gates, e2e, Convex-ish deploy parity, package
  proof, and expensive validation.
- Reuse the same Testbox ID for every run command in the same task/session.
- Use local commands only when the task explicitly sets
  `CLAWHUB_LOCAL_CHECK_MODE=throttled|full`, or when the user asks for local
  proof.

## Install The CLI

If `blacksmith` is not installed, install it:

```bash
curl -fsSL https://get.blacksmith.sh | sh
```

For the canary channel:

```bash
BLACKSMITH_CHANNEL=canary sh -c 'curl -fsSL https://get.blacksmith.sh | sh'
```

Then authenticate:

```bash
blacksmith auth login
```

## Agent-Triggered Browser Auth

When an agent needs to ensure the user is authenticated before running Testbox
commands, use browser-based auth with non-interactive mode. This opens the
browser for the user to sign in; the agent does not interact with the browser.

`--organization` is required with `--non-interactive`:

```bash
blacksmith auth login --non-interactive --organization <org-slug>
```

The org slug can come from `BLACKSMITH_ORG` or the `--org` global flag. Do not
use `--api-token` for this browser flow; that is for headless/token auth.

## Decide First: Local Or Testbox

Before warming anything up, check the repo's own instructions.

Prefer local commands when:

- the repo documents a supported local test/build workflow
- you are iterating on unit tests, lint, typecheck, formatting, or other
  local-only validation
- the value comes from warm local caches and fast repeat runs
- the command does not need remote secrets, hosted services, or CI-only images

Prefer Testbox when:

- `CLAWHUB_TESTBOX=1` is set by the user, agent environment, or standing rules
- the repo explicitly requires CI-parity or remote validation
- the command needs secrets, service containers, or provisioned infra
- you are reproducing CI-only failures
- you need the exact workflow image/job environment from GitHub Actions

For ClawHub specifically, normal local iteration stays local unless maintainer
Testbox mode is enabled with `CLAWHUB_TESTBOX=1`:

- `bun run format:check`
- `bun run lint`
- `bun run test`
- `bun run coverage`
- `bunx tsc --noEmit`
- `bun run build`

If `CLAWHUB_TESTBOX=1` is enabled, run those same repo commands inside the warm
Testbox. If the user wants laptop-friendly local proof for one command, use the
explicit escape hatch `CLAWHUB_LOCAL_CHECK_MODE=throttled`.

In `.codex` worktrees without a `node_modules` symlink, do not run
`bun install` just to validate locally. Use syntax checks or Testbox.

## Setup: Warmup Before Coding

If you decided Testbox is warranted, warm one up early. This returns an ID
instantly and boots the CI environment in the background while you work:

```bash
blacksmith testbox warmup ci-check-testbox.yml --ref main --idle-timeout 90
# -> tbx_01jkz5b3t9...
```

Save this ID in the current session. You need it for every `run` command.
Treat `blacksmith testbox list` as diagnostics, not a reusable work queue.
Listed boxes can be visible at the org/repo level while still being unusable or
stale for the current local agent lane.

For ClawHub maintainer Testbox mode, claim the ID in the current checkout:

```bash
bun run testbox:claim -- --id <ID>
```

Warmup dispatches `.github/workflows/ci-check-testbox.yml`, which provisions a
VM with Bun, Node, dependency install/cache, and a clean checkout of the repo at
the chosen ref.

Bootstrap note: GitHub only exposes `workflow_dispatch` workflows through the
Actions API after the workflow file exists on the default branch. If a brand-new
Testbox workflow exists only on a feature branch, `blacksmith testbox warmup
ci-check-testbox.yml --ref <branch>` can return a GitHub 404 even though the
file exists on that branch. Land the workflow bootstrap first, then dispatch
branch refs normally.

Options:

```text
--ref <branch|tag>     Git ref to dispatch against
--job <name>           Specific job within the workflow, if it has multiple
--idle-timeout <min>   Idle timeout in minutes
```

## Critical: Always Run From The Repo Root

Always invoke `blacksmith testbox` commands from the root of the git
repository. The CLI syncs the current working directory to the testbox using
rsync with `--delete`. If you run from a subdirectory, rsync mirrors only that
subdirectory and can delete everything else on the testbox.

Correct:

```bash
blacksmith testbox run --id <ID> "bun run test"
blacksmith testbox run --id <ID> "cd packages/clawhub && bun run verify"
```

Wrong:

```bash
cd packages/clawhub && blacksmith testbox run --id <ID> "bun run verify"
```

If your shell is in a subdirectory, move back first:

```bash
cd "$(git rev-parse --show-toplevel)"
```

## Running Commands

Raw Blacksmith form:

```bash
blacksmith testbox run --id <ID> "<command>"
```

The `run` command waits for the testbox to become ready if it is still booting,
so you can call `run` immediately after warmup.

In ClawHub, prefer the guarded runner wrapper so stale/reused ids fail before
the Blacksmith CLI spends time syncing or emits a confusing missing-key error:

```bash
bun run testbox:run -- --id <ID> -- bun run lint
bun run testbox:run -- --id <ID> -- bun run test
bun run testbox:run -- --id <ID> -- bun run build
```

The wrapper refuses to run when the local per-Testbox key is missing or when
the id was not claimed by this ClawHub checkout with:

```bash
bun run testbox:claim -- --id <ID>
```

Treat that as the expected remediation, not as a GitHub account or normal
SSH-key problem. A local key alone is not enough; a ready box may still carry
stale rsync state from another lane.

If the agent crashes, the remote box relies on Blacksmith's idle timeout. The
local ClawHub claim marker is not deleted automatically, so the wrapper treats
claims older than 12 hours as stale. Override only for intentional long-running
work with:

```bash
CLAWHUB_TESTBOX_CLAIM_TTL_MINUTES=<minutes>
```

Before spending a broad gate on a manually assembled command, run:

```bash
bun run testbox:sanity -- --id <ID>
```

## Downloading Files From A Testbox

Use the `download` command to retrieve files or directories from a running
testbox to your local machine. This is useful for fetching build artifacts,
test results, coverage reports, or any output generated on the testbox.

```bash
blacksmith testbox download --id <ID> <remote-path> [local-path]
```

The remote path is relative to the testbox working directory. If no local path
is specified, the file is saved to the current directory using the same base
name.

Examples:

```bash
blacksmith testbox download --id <ID> coverage/lcov-report/ ./coverage/
blacksmith testbox download --id <ID> test-results/ ./test-results/
blacksmith testbox download --id <ID> dist/ ./dist/
```

## How File Sync Works

Understanding this model is critical for using Testbox correctly.

When you call `run`, the CLI performs a delta sync of your local changes to the
remote testbox before executing your command:

1. The testbox VM starts from a clean checkout at the warmup ref. The workflow
   setup steps run during warmup and populate dependency directories on the
   remote VM.
2. On each `run`, the CLI uses git to detect which files changed locally since
   the last sync. It syncs only tracked files and untracked non-ignored files.
3. `.gitignore`'d directories are never synced. `node_modules/`, `.bun/`,
   `.vite/`, `dist/`, `.output/`, `.nitro/`, and coverage outputs stay local.
   The testbox uses its own copies populated by the warmup workflow.
4. If nothing has changed since the last sync, the sync is skipped.

Why this matters:

- If you modify `package.json` or `bun.lock`, re-run install on the testbox:

  ```bash
  bun run testbox:run -- --id <ID> -- bun install --frozen-lockfile
  ```

- If tests depend on generated/build output, re-run the build on the testbox.
- New untracked files sync as long as they are not gitignored.
- Deleted files are also deleted on the remote testbox.

## Critical: Do Not Ban Local Tests

Do not assume local validation is forbidden. Many repos intentionally invest in
fast, warm local loops, and forcing every run through Testbox destroys that
advantage.

Use Testbox for checks that actually need it: remote parity, secrets, services,
CI-only runners, expensive broad gates, or reproducibility against the workflow
image.

ClawHub maintainer exception: if `CLAWHUB_TESTBOX=1` is set by the user or
agent environment, treat Testbox as the normal validation path for this repo.
Use `CLAWHUB_LOCAL_CHECK_MODE=throttled|full` as the explicit local escape
hatch.

## Workflow

1. Decide whether the repo's local loop is the right default. For ClawHub,
   `CLAWHUB_TESTBOX=1` makes Testbox the maintainer default.
2. If Testbox is warranted, warm up early:
   `blacksmith testbox warmup ci-check-testbox.yml --ref main --idle-timeout 90`.
3. Save the ID, then claim it:
   `bun run testbox:claim -- --id <ID>`.
4. Write code while the testbox boots in the background.
5. Run sanity before broad checks:
   `bun run testbox:sanity -- --id <ID>`.
6. Run the remote command:
   `bun run testbox:run -- --id <ID> -- bun run lint`.
7. If tests fail, fix code and re-run against the same warm box.
8. If dependency manifests changed, run install in the box before testing.
9. If you need artifacts, download them with `blacksmith testbox download`.
10. Stop the box when done if it is no longer needed:
    `blacksmith testbox stop --id <ID>`.

## ClawHub Broad Gate

For a broad ClawHub proof in maintainer Testbox mode, use the repo package
manager and keep the commands explicit:

```bash
bun run testbox:run -- --id <ID> -- bun run format:check
bun run testbox:run -- --id <ID> -- bun run lint
bun run testbox:run -- --id <ID> -- bun run test
bun run testbox:run -- --id <ID> -- bunx tsc --noEmit
bun run testbox:run -- --id <ID> -- bunx tsc -p packages/schema/tsconfig.json --noEmit
bun run testbox:run -- --id <ID> -- bunx tsc -p packages/clawhub/tsconfig.json --noEmit
bun run testbox:run -- --id <ID> -- bun run build
```

For e2e:

```bash
bun run testbox:run -- --id <ID> -- bun run test:e2e
bun run testbox:run -- --id <ID> -- bun run test:pw
```

## Waiting For Readiness

The `run` command automatically waits for the testbox, so explicit waiting is
usually unnecessary. If you do need to check readiness separately, use
`--wait`. Do not use a sleep-and-recheck loop.

```bash
blacksmith testbox status --id <ID> --wait --wait-timeout 5m
```

## Managing Testboxes

```bash
blacksmith testbox status --id <ID>
blacksmith testbox list
blacksmith testbox stop --id <ID>
```

Testboxes automatically shut down after being idle. For ClawHub maintainer
work, use 90 minutes for long-running sessions:

```bash
blacksmith testbox warmup ci-check-testbox.yml --idle-timeout 90
```
