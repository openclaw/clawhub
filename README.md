<p align="center">
  <img src="public/clawd-logo.png" alt="ClawHub" width="120">
</p>

<h1 align="center">ClawHub</h1>

<p align="center">
  <a href="https://github.com/openclaw/clawhub/actions/workflows/ci.yml?branch=main"><img src="https://img.shields.io/github/actions/workflow/status/openclaw/clawhub/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://discord.gg/clawd"><img src="https://img.shields.io/discord/1456350064065904867?label=Discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

ClawHub is the **public skill registry for Clawdbot**: publish, version, and search text-based agent skills (a `SKILL.md` plus supporting files).
It's designed for fast browsing + a CLI-friendly API, with moderation hooks and vector search.

onlycrabs.ai is the **SOUL.md registry**: publish and share system lore the same way you publish skills.

<p align="center">
  <a href="https://clawhub.ai">ClawHub</a> ·
  <a href="https://onlycrabs.ai">onlycrabs.ai</a> ·
  <a href="VISION.md">Vision</a> ·
  <a href="docs/README.md">Docs</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://discord.gg/clawd">Discord</a>
</p>

## What you can do with it

- Browse skills + render their `SKILL.md`.
- Publish new skill versions with changelogs + tags (including `latest`).
- Browse souls + render their `SOUL.md`.
- Publish new soul versions with changelogs + tags.
- Search via embeddings (vector index) instead of brittle keywords.
- Star + comment; admins/mods can curate and approve skills.

## onlycrabs.ai (SOUL.md registry)

- Entry point is host-based: `onlycrabs.ai`.
- On the onlycrabs.ai host, the home page and nav default to souls.
- On ClawHub, souls live under `/souls`.
- Soul bundles only accept `SOUL.md` for now (no extra files).

## How it works (high level)

- Web app: TanStack Start (React, Vite/Nitro).
- Backend: Convex (DB + file storage + HTTP actions) + Convex Auth (GitHub OAuth).
- Search: OpenAI embeddings (`text-embedding-3-small`) + Convex vector search.
- API schema + routes: `packages/schema` (`clawhub-schema`).

## CLI

Common CLI flows:

- Auth: `clawhub login`, `clawhub whoami`
- Discover: `clawhub search ...`, `clawhub explore`
- Manage local installs: `clawhub install <slug>`, `clawhub uninstall <slug>`, `clawhub list`, `clawhub update --all`
- Inspect without installing: `clawhub inspect <slug>`
- Publish/sync: `clawhub publish <path>`, `clawhub sync`

Docs: [`docs/quickstart.md`](docs/quickstart.md), [`docs/cli.md`](docs/cli.md).


## Telemetry

ClawHub tracks minimal **install telemetry** (to compute install counts) when you run `clawhub sync` while logged in.
Disable via:

```bash
export CLAWHUB_DISABLE_TELEMETRY=1
```

Details: [`docs/telemetry.md`](docs/telemetry.md).

## Repo layout

- `src/` — TanStack Start app (routes, components, styles).
- `convex/` — schema + queries/mutations/actions + HTTP API routes.
- `packages/schema/` — shared API types/routes for the CLI and app.
- [`docs/`](docs/README.md) — project documentation (architecture, CLI, auth, deployment, and more).
- [`docs/spec.md`](docs/spec.md) — product + implementation spec (good first read).

## Local dev

Prereqs: [Bun](https://bun.sh/) (Convex runs via `bunx`, no global install needed).

```bash
bun install
cp .env.local.example .env.local
# edit .env.local — see CONTRIBUTING.md for local Convex values

# terminal A: local Convex backend
bunx convex dev

# terminal B: web app (port 3000)
bun run dev

# seed sample data
bunx convex run --no-push devSeed:seedNixSkills
```

For full setup instructions (env vars, GitHub OAuth, JWT keys, database seeding), see [CONTRIBUTING.md](CONTRIBUTING.md).

## Environment

- `VITE_CONVEX_URL`: Convex deployment URL (`https://<deployment>.convex.cloud`).
- `VITE_CONVEX_SITE_URL`: Convex site URL (`https://<deployment>.convex.site`).
- `VITE_SOULHUB_SITE_URL`: onlycrabs.ai site URL (`https://onlycrabs.ai`).
- `VITE_SOULHUB_HOST`: onlycrabs.ai host match (`onlycrabs.ai`).
- `VITE_SITE_MODE`: Optional override (`skills` or `souls`) for SSR builds.
- `CONVEX_SITE_URL`: same as `VITE_CONVEX_SITE_URL` (auth + cookies).
- `SITE_URL`: App URL (local: `http://localhost:3000`).
- `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`: GitHub OAuth App.
- `JWT_PRIVATE_KEY` / `JWKS`: Convex Auth keys.
- `OPENAI_API_KEY`: embeddings for search + indexing.

## Nix plugins (nixmode skills)

ClawHub can store a nix-clawdbot plugin pointer in SKILL frontmatter so the registry knows which
Nix package bundle to install. A nix plugin is different from a regular skill pack: it bundles the
skill pack, the CLI binary, and its config flags/requirements together.

Add this to `SKILL.md`:

```yaml
---
name: peekaboo
description: Capture and automate macOS UI with the Peekaboo CLI.
metadata: {"clawdbot":{"nix":{"plugin":"github:clawdbot/nix-steipete-tools?dir=tools/peekaboo","systems":["aarch64-darwin"]}}}
---
```

Install via nix-clawdbot:

```nix
programs.clawdbot.plugins = [
  { source = "github:clawdbot/nix-steipete-tools?dir=tools/peekaboo"; }
];
```

You can also declare config requirements + an example snippet:

```yaml
---
name: padel
description: Check padel court availability and manage bookings via Playtomic.
metadata: {"clawdbot":{"config":{"requiredEnv":["PADEL_AUTH_FILE"],"stateDirs":[".config/padel"],"example":"config = { env = { PADEL_AUTH_FILE = \\\"/run/agenix/padel-auth\\\"; }; };"}}}
---
```

To show CLI help (recommended for nix plugins), include the `cli --help` output:

```yaml
---
name: padel
description: Check padel court availability and manage bookings via Playtomic.
metadata: {"clawdbot":{"cliHelp":"padel --help\\nUsage: padel [command]\\n"}}
---
```

`metadata.clawdbot` is preferred, but `metadata.clawdis` and `metadata.openclaw` are accepted as aliases.

## Skill metadata

Skills declare their runtime requirements (env vars, binaries, install specs) in the `SKILL.md` frontmatter. ClawHub's security analysis checks these declarations against actual skill behavior.

Full reference: [`docs/skill-format.md`](docs/skill-format.md#frontmatter-metadata)

Quick example:

```yaml
---
name: my-skill
description: Does a thing with an API.
metadata:
  openclaw:
    requires:
      env:
        - MY_API_KEY
      bins:
        - curl
    primaryEnv: MY_API_KEY
---
```

## Scripts

```bash
bun run dev
bun run build
bun run test
bun run coverage
bun run lint
```
