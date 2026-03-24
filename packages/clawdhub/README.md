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
- Token stored in `~/Library/Application Support/clawhub/config.json` on macOS (override via `CLAWHUB_CONFIG_PATH`, legacy `CLAWDHUB_CONFIG_PATH`).

## Examples

```bash
clawhub search "postgres backups"
clawhub install my-skill-pack
clawhub update --all
clawhub update --all --no-input --force
clawhub publish ./my-skill-pack --slug my-skill-pack --name "My Skill Pack" --version 1.2.0 --changelog "Fixes + docs"
clawhub package explore --family skill
clawhub package explore --family code-plugin
clawhub package inspect @openclaw/example-plugin
clawhub package publish ./example-plugin --owner openclaw --source-repo openclaw/example-plugin --source-commit abc123
```

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
