# `clawhub`

ClawHub CLI — install, update, search, and publish agent skills plus OpenClaw packages.

## Install

```bash
# From this repo (shortcut script at repo root)
bun clawhub --help

# Once published to npm
# npm i -g clawhub
```

## Auth (publish)

```bash
clawhub login
# or
clawhub auth login

# Headless / token paste
# or (token paste / headless)
clawhub login --token clh_...
```

Notes:

- Browser login opens `https://clawhub.ai/cli/auth` and completes via a loopback callback.
- Default config path:
  - macOS: `~/Library/Application Support/clawhub/config.json`
  - Linux/XDG: `$XDG_CONFIG_HOME/clawhub/config.json` or `~/.config/clawhub/config.json`
  - Windows: `%APPDATA%\\clawhub\\config.json`
- Legacy fallback: if `clawhub/config.json` does not exist yet but `clawdhub/config.json` does, the CLI reuses the legacy path.
- Override via `CLAWHUB_CONFIG_PATH` (legacy `CLAWDHUB_CONFIG_PATH`).

## Examples

```bash
clawhub search "postgres backups"
clawhub install my-skill-pack
clawhub update --all
clawhub update --all --no-input --force
clawhub skill publish ./my-skill-pack --slug my-skill-pack --name "My Skill Pack" --version 1.2.0 --changelog "Fixes + docs"
clawhub package explore --family skill
clawhub package explore --family code-plugin
clawhub package inspect @openclaw/example-plugin
clawhub package publish openclaw/example-plugin
clawhub package publish openclaw/example-plugin@v1.0.0
clawhub package publish https://github.com/openclaw/example-plugin --dry-run
clawhub package publish ./example-plugin
```

## GitHub Actions

This repo also provides an official reusable workflow for plugin repos:

- [`.github/workflows/package-publish.yml`](../../.github/workflows/package-publish.yml)

Use `dry_run: true` on pull requests and reserve real publishes for trusted events
such as `workflow_dispatch` or tag pushes with a `CLAWHUB_TOKEN` secret.

## Maintainers

The `clawhub` npm package is released separately from the ClawHub app deploy.

- Release workflow: [`.github/workflows/clawhub-cli-npm-release.yml`](../../.github/workflows/clawhub-cli-npm-release.yml)
- Release model: manual-only, stable tags only (`vX.Y.Z`), with a preflight run before the real publish
- Publish auth: npm trusted publishing through the `npm-release` GitHub environment

## Development

The supported verification flow for this package is package-local:

```bash
bun run --cwd packages/clawhub test
bun run --cwd packages/clawhub verify:build
bun run --cwd packages/clawhub test:artifact
bun run --cwd packages/clawhub verify
```

`test` runs source tests only. `test:artifact` builds `dist/` and runs a small smoke suite against the built CLI entrypoint.

## Sync (upload local skills)

```bash
# Start anywhere; scans workdir first, then legacy Clawdis/Clawd/OpenClaw/Moltbot locations.
clawhub sync

# Explicit roots + non-interactive dry-run
clawhub sync --root ../clawdis/skills --all --dry-run
```

## Defaults

- Site: `https://clawhub.ai` (override via `--site` or `CLAWHUB_SITE`, legacy `CLAWDHUB_SITE`)
- Registry: discovered from `/.well-known/clawhub.json` on the site (legacy `/.well-known/clawdhub.json`; override via `--registry` or `CLAWHUB_REGISTRY`)
- Workdir: current directory (falls back to Clawdbot workspace if configured; override via `--workdir` or `CLAWHUB_WORKDIR`)
- Install dir: `./skills` under workdir (override via `--dir`)
