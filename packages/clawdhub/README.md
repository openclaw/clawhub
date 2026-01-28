# `clawdhub`

ClawdHub CLI — install, update, search, and publish agent skills as folders.

## Install

```bash
# From this repo (shortcut script at repo root)
bun clawdhub --help

# Once published to npm
# npm i -g clawdhub
```

## Auth (publish)

```bash
clawdhub login
# or
clawdhub auth login

# Headless / token paste
# or (token paste / headless)
clawdhub login --token clh_...
```

Notes:

- Browser login opens `https://clawdhub.com/cli/auth` and completes via a loopback callback.
- Token stored in `~/Library/Application Support/clawdhub/config.json` on macOS (override via `CLAWDHUB_CONFIG_PATH`).

## Examples

```bash
clawdhub search "postgres backups"
clawdhub install my-skill-pack
clawdhub update --all
clawdhub update --all --no-input --force
clawdhub publish ./my-skill-pack --slug my-skill-pack --name "My Skill Pack" --version 1.2.0 --changelog "Fixes + docs"
```

## Sync (upload local skills)

```bash
# Start anywhere; scans workdir first, then legacy Clawdis/Clawd locations.
clawdhub sync

# Explicit roots + non-interactive dry-run
clawdhub sync --root ../clawdis/skills --all --dry-run
```

## Defaults

- Site: `https://clawdhub.com` (override via `--site` or `CLAWDHUB_SITE`)
- Registry: discovered from `/.well-known/clawdhub.json` on the site (override via `--registry` or `CLAWDHUB_REGISTRY`)
- Workdir: current directory (falls back to Clawdbot workspace if configured; override via `--workdir` or `CLAWDHUB_WORKDIR`)
- Install dir: `./skills` under workdir (override via `--dir`, `CLAWDHUB_DIR`, or `dir` in config.json)
