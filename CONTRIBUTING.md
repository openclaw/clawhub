# Contributing to ClawHub

Welcome! ClawHub is the public skill registry for [OpenClaw](https://github.com/openclaw/openclaw). We appreciate bug fixes, documentation improvements, and feature contributions.

- **Questions?** Ask in [#clawhub on Discord](https://discord.gg/clawd).
- **Bug fixes** — PRs are welcome.
- **New features or architectural changes** — please start with a Discord conversation in #clawhub first so we can align on scope.

## Local Development Setup

### Prerequisites

- [Bun](https://bun.sh/) (Convex CLI runs via `bunx`, no global install needed)
- [Node.js](https://nodejs.org/) v18, 20, 22, or 24 (required by the local Convex backend; v25+ is not yet supported)

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

### Seed the database

Populate local QA fixtures and the committed public corpus so the UI isn't empty:

```bash
# local moderation/security fixtures
bunx convex run --no-push devSeed:seedLocalFixtures

# real-ish public corpus rows under deterministic dummy accounts
bun run seed:public-corpus

# 50 extra skills for pagination testing (optional)
bunx convex run --no-push devSeedExtra:seedExtraSkillsInternal

# Refresh cached global stats after manual seeding
bunx convex run --no-push statsMaintenance:updateGlobalStatsAction
```

To reset and re-seed:

```bash
bunx convex run --no-push devSeed:seedLocalFixtures '{"reset": true}'
bun run seed:public-corpus -- --reset
```

### Optional environment variables

These features degrade gracefully without their keys:

| Variable                                                                  | Purpose                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `OPENAI_API_KEY`                                                          | Embeddings and vector search (falls back to zero vectors) |
| `VT_API_KEY`                                                              | VirusTotal malware scanning                               |
| `DISCORD_WEBHOOK_URL`                                                     | Discord notifications                                     |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_INSTALLATION_ID` | GitHub backup sync                                        |

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

## Skill & Soul Publishing

- Skill format reference: [`docs/skill-format.md`](docs/skill-format.md)
- Soul format reference: [`docs/soul-format.md`](docs/soul-format.md)
- End-to-end walkthrough (search, install, publish, sync): [`docs/quickstart.md`](docs/quickstart.md)

Quick publish:

```bash
clawhub publish <path-to-skill-directory>
```

## Before Submitting a PR

```bash
bun run format:check # oxfmt
bun run lint       # oxlint
bun run deadcode:ci # Knip files/deps/exports
bun run test       # Vitest (80% coverage threshold)
bun run build      # Vite + Nitro
bun run --cwd packages/clawhub verify
```

These are the same checks that run in CI (`.github/workflows/ci.yml`).

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
4. [`docs/architecture.md`](docs/architecture.md) — system design
5. [`docs/skill-format.md`](docs/skill-format.md) — skill structure
6. [`docs/cli.md`](docs/cli.md) — CLI reference
7. [`docs/http-api.md`](docs/http-api.md) — HTTP endpoints
8. [`docs/auth.md`](docs/auth.md) — authentication
9. [`docs/deploy.md`](docs/deploy.md) — deployment
10. [`docs/troubleshooting.md`](docs/troubleshooting.md) — common issues
