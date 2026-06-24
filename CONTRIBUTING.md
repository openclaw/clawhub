# Contributing to ClawHub

Welcome! ClawHub is the public skill registry for [OpenClaw](https://github.com/openclaw/openclaw). We appreciate bug fixes, documentation improvements, and feature contributions.

- **Questions?** Ask in [#clawhub on Discord](https://discord.gg/clawd).
- **Bug fixes** — PRs are welcome.
- **New features or architectural changes** — please start with a Discord conversation in #clawhub first so we can align on scope.

## Local Development Setup

### Prerequisites

- [Bun](https://bun.sh/) (Convex CLI runs via `bunx`, no global install needed)
- [Node.js](https://nodejs.org/) v18, 20, 22, or 24 (required by the local Convex backend; v25+ is not yet supported)
- [Worktrunk](https://github.com/max-sixty/worktrunk) (`wt`) for `bun run dev:worktree` and disposable/Codex worktrees. On macOS, `brew install worktrunk` is the quickest path; shell integration is optional.

### Install and configure

```bash
bun install
cp .env.local.example .env.local
```

Edit `.env.local` with the following values for **local Convex**:

```bash
# Frontend
VITE_CONVEX_URL=http://127.0.0.1:3210
VITE_CONVEX_SITE_URL=http://127.0.0.1:3211
SITE_URL=http://localhost:3000

# Convex Auth / HTTP routes
CONVEX_SITE_URL=http://127.0.0.1:3211

# Deployment used by `bunx convex dev`
CONVEX_DEPLOYMENT=anonymous:anonymous-clawhub
```

Local Convex serves the function endpoint on port 3210 and HTTP routes (`/api/*` and auth callbacks) through the site proxy on port 3211.

### GitHub OAuth App (for login)

1. Go to [github.com/settings/developers](https://github.com/settings/developers) and create a new OAuth App.
2. Set **Homepage URL** to `http://localhost:3000`.
3. Set **Authorization callback URL** to `http://127.0.0.1:3211/api/auth/callback/github`.
4. Copy the Client ID and generate a Client Secret.

### Run the Convex backend

Start the local Convex backend first — other setup steps depend on it:

```bash
bunx convex dev --typecheck=disable
```

### Set backend environment variables

The Convex backend has its own env var store separate from `.env.local`. With the backend running, open a new terminal and set the required variables:

```bash
bunx convex env set AUTH_GITHUB_ID <your-client-id>
bunx convex env set AUTH_GITHUB_SECRET <your-client-secret>
bunx convex env set SITE_URL http://localhost:3000
```

### JWT keys (for Convex Auth)

With the backend still running, generate the signing keys:

```bash
bunx @convex-dev/auth
```

This sets `JWT_PRIVATE_KEY` and `JWKS` on the Convex backend and outputs values you can also save to `.env.local` for reference.

### Run the frontend

```bash
bun run dev -- --port 3000
```

Change the port if 3000 is already in use, and update `SITE_URL` in both `.env.local` and the Convex backend (`bunx convex env set SITE_URL ...`) to match.

### Worktree/Codex fast path

Use this path for disposable branches, Codex sessions, or parallel worktrees after one source worktree already has a working `.env.local` and `.convex` local Convex setup:

```bash
bun run setup:worktree
bun run dev:worktree
wt --yes url
wt --yes stop
```

`setup:worktree` finds a usable source worktree and symlinks `.env.local` plus `.convex` into the current checkout. If discovery picks the wrong source, pass one explicitly:

```bash
bun run setup:worktree -- --from /path/to/source/worktree
CLAWHUB_WORKTREE_SOURCE=/path/to/source/worktree bun run setup:worktree
```

`dev:worktree` is the Worktrunk entrypoint. It runs the hooks in `.config/wt.toml`, copies ignored dependencies listed in `.worktreeinclude` when possible, falls back to `bun install` if Vite is missing, seeds local fixtures plus the public corpus once when `VITE_CONVEX_URL` and `CONVEX_DEPLOYMENT` are local, refreshes cached global stats, and starts detached services on a branch-hashed loopback port. Use `wt --yes url` from the same worktree to print the URL.

The detached server writes runtime state under `.codex/runtime/`. Stop it with `wt --yes stop` before removing the worktree.

### Local Codex workers

Local dev does not start Codex-backed workers by default, so `dev:worktree` does
not spend Codex quota.

To process local ClawScan or Skill Card jobs, opt in for that shell:

```bash
CLAWHUB_ALLOW_LOCAL_CODEX_SCAN=1 bun run dev:workers -- --workers security-scan --once
CLAWHUB_ALLOW_LOCAL_CODEX_SCAN=1 bun run dev:workers -- --workers skill-card --once
```

Opted-in local runs use an ignored worktree-local `CODEX_HOME` unless you provide
one.

Without those workers, local ClawScan and Skill Card jobs stay pending until you
opt in, seed/mock results, or use the production workflows.

### Reseed the database

`dev:worktree` seeds local QA fixtures and the committed public corpus before starting the app when `VITE_CONVEX_URL` points at local Convex and `CONVEX_DEPLOYMENT` is an anonymous/local deployment marker, then records `.codex/runtime/dev-worktree.seeded` so ordinary restarts skip the expensive corpus pass. Remote-backed previews or mismatched deployment markers skip seeding and keep starting. To force the seed path without restarting the preview:

```bash
bun run seed:dev
```

`seed:dev` runs worktree setup, starts or waits for local Convex, seeds the hand-authored local QA fixtures, imports the committed public corpus, and refreshes cached global stats. It is safe to rerun after fixture or schema changes.

Lower-level seed commands are available for manual recovery or focused fixture work:

```bash
# local moderation/security fixtures only
bunx convex run --no-push devSeed:seedLocalFixtures

# committed public corpus only
bun run seed:public-corpus

# validate the committed public corpus fixture
bun run validate:public-corpus

# 50 extra skills for pagination testing (optional)
bunx convex run --no-push devSeedExtra:seedExtraSkillsInternal

# Refresh cached global stats after manual seeding
bunx convex run --no-push statsMaintenance:updateGlobalStatsAction
```

To reset and re-seed:

```bash
bunx convex run --no-push devSeed:seedLocalFixtures '{"reset": true}'
bun run seed:public-corpus -- --reset
bunx convex run --no-push statsMaintenance:updateGlobalStatsAction
```

Without `OPENAI_API_KEY`, public corpus import still works, but semantic search quality degrades because embeddings fall back to zero vectors.

### Worktree troubleshooting

- `wt: command not found`: install Worktrunk, then rerun `bun run dev:worktree`. Manual `bun run dev` plus `bunx convex dev --typecheck=disable` still works without Worktrunk.
- Missing `.env.local` or `.convex`: run `bun run setup:worktree -- --from /path/to/source/worktree`. The source must contain `.env.local` and, for local Convex deployments, `.convex/local/default/config.json`.
- Wrong local Convex deployment: make sure `CONVEX_DEPLOYMENT` in `.env.local` matches the local Convex deployment in `.convex/local/default/config.json` when using a `local:` deployment.
- Port mismatch: local Convex normally serves cloud functions at `http://127.0.0.1:3210` and HTTP routes/auth callbacks at `http://127.0.0.1:3211`. Keep `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, and `CONVEX_SITE_URL` aligned with the local config.
- `wt step copy-ignored` reports that `.convex` cannot be copied: this can happen when `.convex` is a symlink to the source worktree. The Worktrunk hook continues; confirm `.env.local`, `.convex`, and `node_modules/.bin/vite` exist before debugging deeper.
- Local Convex functions are not queryable yet during seeding: leave `bunx convex dev --typecheck=disable` running or rerun `bun run seed:dev`; the seed runner retries while Convex finishes pushing functions.
- Local seeding hits a transient Convex write conflict: `seed:public-corpus` retries retryable batch conflicts. If retries are exhausted, stop other local writers and rerun `bun run seed:dev`.
- Stale detached services: run `wt --yes stop`, then inspect `.codex/runtime/dev-worktree.log` if the server still does not restart cleanly.

### Optional environment variables

These features degrade gracefully without their keys:

| Variable              | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `OPENAI_API_KEY`      | Embeddings and vector search (falls back to zero vectors) |
| `VT_API_KEY`          | VirusTotal malware scanning                               |
| `DISCORD_WEBHOOK_URL` | Discord notifications                                     |

## CLI Development

The CLI source lives in [`packages/clawhub/`](packages/clawhub/). Both `clawhub` and `clawdhub` are registered as bin aliases.

To test the CLI against your local instance:

```bash
CLAWHUB_REGISTRY=http://127.0.0.1:3211 CLAWHUB_SITE=http://localhost:3000 clawhub search "padel"
```

Use the package-local verification contract when working on the CLI:

```bash
bun run --cwd packages/clawhub test
bun run --cwd packages/clawhub verify:build
bun run --cwd packages/clawhub test:artifact
bun run --cwd packages/clawhub verify
```

`bun test packages/clawhub/` is not the supported workflow. Source tests and built-artifact smoke tests are intentionally split.

Manual smoke tests are documented in [`specs/manual-testing.md`](specs/manual-testing.md).

## Skill Publishing

- Skill format reference: [`docs/skill-format.md`](docs/skill-format.md)
- End-to-end walkthrough (search, install, and publish): [`docs/quickstart.md`](docs/quickstart.md)

Quick publish:

```bash
clawhub publish <path-to-skill-directory>
```

## Before Submitting a PR

Run the narrowest meaningful check while iterating, then run the matching CI aliases before handoff:

- All PRs: `bun run ci:static`.
- Source or test changes: focused tests for the touched behavior plus `bun run ci:unit` unless the change is docs/config-only or a maintainer asks to rely on CI.
- App runtime, Convex, or build changes: `bun run ci:types-build`.
- Package changes: `bun run ci:packages`.
- HTTP/API/CLI integration changes: `bun run ci:e2e-http`.
- Browser smoke or visual behavior changes: `bun run ci:playwright-smoke`, `bun run test:pw:local-auth`, and/or `bun run proof:ui` depending on the touched flow.

`bun run ci:pr` is the local aggregate for the non-browser PR gates. See [`specs/ci.md`](specs/ci.md) for the full CI contract.

### Crabbox remote checks

Maintainers can run the same checks in a Crabbox lease instead of spending local
CPU. ClawHub uses Crabbox as the agent-facing command surface; the Testbox
workflow is only the backend for the default Blacksmith provider.

```bash
bun run crabbox:warmup -- --provider blacksmith-testbox
bun run crabbox:run -- --provider blacksmith-testbox --shell -- "bun run lint"
bun run crabbox:run -- --provider blacksmith-testbox --shell -- "bun run test"
bun run crabbox:run -- --provider blacksmith-testbox --shell -- "bun run build"
```

Use `--id <id-or-slug>` with `crabbox:run` when reusing an existing warmed lease,
and stop disposable leases with `bun run crabbox:stop -- --provider <provider>
<id-or-slug>`.
Use `CLAWHUB_LOCAL_CHECK_MODE=throttled` or `CLAWHUB_LOCAL_CHECK_MODE=full` as
the explicit local escape hatch when you intentionally want laptop-side proof.
If Crabbox auth/provider access is missing, report that instead of falling back
to a broad local gate that can bog down a dev machine.

**PR guidelines:**

- Keep PRs focused — one concern per PR.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, etc.
- Include test commands and screenshots for UI changes.
- Write a clear description of what changed and why.

## AI-Generated Code

AI-assisted contributions are welcome. When submitting AI-generated or AI-assisted code:

- Note it in the PR description.
- Describe the level of testing you applied.
- Include prompts if useful for reviewers.
- Confirm that you understand and can maintain the code.

## Security Reporting

Report vulnerabilities to **security@openclaw.ai** with:

- Severity assessment
- Technical reproduction steps
- Suggested remediation

See [`docs/security.md`](docs/security.md) for moderation and upload gating details.

## Reading Order for New Contributors

1. This file (local setup)
2. [`docs/clawhub.md`](docs/clawhub.md) — public registry overview
3. [`docs/quickstart.md`](docs/quickstart.md) — end-to-end workflows
4. [`docs/how-it-works.md`](docs/how-it-works.md) — registry behavior and system overview
5. [`docs/skill-format.md`](docs/skill-format.md) — skill structure
6. [`docs/cli.md`](docs/cli.md) — CLI reference
7. [`docs/http-api.md`](docs/http-api.md) — HTTP endpoints
8. [`docs/auth.md`](docs/auth.md) — authentication
9. [`specs/deploy.md`](specs/deploy.md) — deployment
10. [`docs/troubleshooting.md`](docs/troubleshooting.md) — common issues
