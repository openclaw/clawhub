# Contributing to ClawHub

Welcome! ClawHub is the public skill registry for [OpenClaw](https://github.com/openclaw/openclaw). We appreciate bug fixes, documentation improvements, and feature contributions.

- **Questions?** Ask in [#setup-help on Discord](https://discord.gg/clawd).
- **Bug fixes** — PRs are welcome.
- **New features or architectural changes** — please start with a Discord conversation first so we can align on scope.

## Local Development Setup

### Prerequisites

- [Bun](https://bun.sh/) (Convex CLI runs via `bunx`, no global install needed)

### Install and configure

```bash
bun install
cp .env.local.example .env.local
```

Edit `.env.local` with the following values for **local Convex**:

```bash
# Frontend
VITE_CONVEX_URL=http://127.0.0.1:3210
VITE_CONVEX_SITE_URL=http://127.0.0.1:3210
SITE_URL=http://localhost:3000
CONVEX_SITE_URL=http://127.0.0.1:3210

# Deployment used by `bunx convex dev`
CONVEX_DEPLOYMENT=anonymous:anonymous-clawhub
```

### GitHub OAuth App (for login)

1. Go to [github.com/settings/developers](https://github.com/settings/developers) and create a new OAuth App.
2. Set **Homepage URL** to `http://localhost:3000`.
3. Set **Authorization callback URL** to `http://127.0.0.1:3210/api/auth/callback/github`.
4. Copy the Client ID and generate a Client Secret, then add them to `.env.local`:

```bash
AUTH_GITHUB_ID=<your-client-id>
AUTH_GITHUB_SECRET=<your-client-secret>
```

### JWT keys (for Convex Auth)

Generate the signing keys:

```bash
bunx @convex-dev/auth
```

This outputs `JWT_PRIVATE_KEY` and `JWKS` values — paste them into `.env.local`.

### Run the app

```bash
# Terminal A: local Convex backend
bunx convex dev

# Terminal B: frontend (port 3000)
bun run dev
```

### Seed the database

Populate sample data so the UI isn't empty:

```bash
# 3 sample skills (padel, gohome, xuezh)
bunx convex run --no-push devSeed:seedNixSkills

# 50 extra skills for pagination testing (optional)
bunx convex run --no-push devSeedExtra:seedExtraSkillsInternal
```

To reset and re-seed:

```bash
bunx convex run --no-push devSeed:seedNixSkills '{"reset": true}'
```

### Optional environment variables

These features degrade gracefully without their keys:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Embeddings and vector search (falls back to zero vectors) |
| `VT_API_KEY` | VirusTotal malware scanning |
| `DISCORD_WEBHOOK_URL` | Discord notifications |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_INSTALLATION_ID` | GitHub backup sync |

## CLI Development

The CLI source lives in [`packages/clawdhub/`](packages/clawdhub/). Both `clawhub` and `clawdhub` are registered as bin aliases.

To test the CLI against your local instance:

```bash
CLAWHUB_REGISTRY=http://127.0.0.1:3210 CLAWHUB_SITE=http://localhost:3000 clawhub search "padel"
```

Manual smoke tests are documented in [`docs/manual-testing.md`](docs/manual-testing.md).

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
bun run lint       # oxlint
bun run test       # Vitest (80% coverage threshold)
bun run build      # Vite + Nitro
```

These are the same checks that run in CI (`.github/workflows/ci.yml`).

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
2. [`docs/quickstart.md`](docs/quickstart.md) — end-to-end workflows
3. [`docs/architecture.md`](docs/architecture.md) — system design
4. [`docs/skill-format.md`](docs/skill-format.md) — skill structure
5. [`docs/cli.md`](docs/cli.md) — CLI reference
6. [`docs/http-api.md`](docs/http-api.md) — HTTP endpoints
7. [`docs/auth.md`](docs/auth.md) — authentication
8. [`docs/deploy.md`](docs/deploy.md) — deployment
9. [`docs/troubleshooting.md`](docs/troubleshooting.md) — common issues
