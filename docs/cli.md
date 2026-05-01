---
summary: "CLI reference: commands, flags, config, lockfile, sync behavior."
read_when:
  - Working on CLI behavior
  - Debugging install/update/sync
---

# CLI

CLI package: `packages/clawhub/` (published as `clawhub`, bin: `clawhub`).

From this repo you can run it via the wrapper script:

```bash
bun clawhub --help
```

## Global flags

- `--workdir <dir>`: working directory (default: cwd; falls back to Clawdbot workspace if configured)
- `--dir <dir>`: install dir under workdir (default: `skills`)
- `--site <url>`: base URL for browser login (default: `https://clawhub.ai`)
- `--registry <url>`: API base URL (default: discovered, else `https://clawhub.ai`)
- `--no-input`: disable prompts

Env equivalents:

- `CLAWHUB_SITE` (legacy `CLAWDHUB_SITE`)
- `CLAWHUB_REGISTRY` (legacy `CLAWDHUB_REGISTRY`)
- `CLAWHUB_WORKDIR` (legacy `CLAWDHUB_WORKDIR`)

### HTTP proxy

The CLI respects standard HTTP proxy environment variables for systems behind
corporate proxies or restricted networks:

- `HTTPS_PROXY` / `https_proxy`
- `HTTP_PROXY` / `http_proxy`
- `NO_PROXY` / `no_proxy`

When any of these variables is set, the CLI routes outbound requests through
the specified proxy. `HTTPS_PROXY` is used for HTTPS requests, `HTTP_PROXY`
for plain HTTP. `NO_PROXY` / `no_proxy` is respected to bypass the proxy for
specific hosts or domains.

This is required on systems where direct outbound connections are blocked
(e.g. Docker containers, Hetzner VPS with proxy-only internet, corporate
firewalls).

Example:

```bash
export HTTPS_PROXY=http://proxy.example.com:3128
export NO_PROXY=localhost,127.0.0.1
clawhub search "my query"
```

When no proxy variable is set, behavior is unchanged (direct connections).

## Config file

Stores your API token + cached registry URL.

- macOS: `~/Library/Application Support/clawhub/config.json`
- Linux/XDG: `$XDG_CONFIG_HOME/clawhub/config.json` or `~/.config/clawhub/config.json`
- Windows: `%APPDATA%\\clawhub\\config.json`
- Legacy fallback: if `clawhub/config.json` does not exist yet but `clawdhub/config.json` does, the CLI reuses the legacy path
- override: `CLAWHUB_CONFIG_PATH` (legacy `CLAWDHUB_CONFIG_PATH`)

## Commands

### `login` / `auth login`

- Default: opens browser to `<site>/cli/auth` and completes via loopback callback.
- Headless: `clawhub login --token clh_...`

### `whoami`

- Verifies the stored token via `/api/v1/whoami`.

### `star <slug>` / `unstar <slug>`

- Adds/removes a skill from your highlights.
- Calls `POST /api/v1/stars/<slug>` and `DELETE /api/v1/stars/<slug>`.
- `--yes` skips confirmation.

### `search <query...>`

- Calls `/api/v1/search?q=...`.
- Search favors exact slug/name token matches before download popularity. A standalone slug token such as `map` matches `personal-map` more strongly than the substring inside `amap`.
- Downloads are a small popularity prior, not a guarantee of top placement.
- If a skill should appear but does not, run `clawhub inspect <slug>` while logged in to check owner-visible moderation diagnostics before renaming metadata.

### `explore`

- Lists newest skills via `/api/v1/skills?limit=...&sort=createdAt` (sorted by `createdAt` desc).
- Flags:
  - `--limit <n>` (1-200, default: 25)
  - `--sort newest|updated|downloads|rating|installs|installsAllTime|trending` (default: newest)
  - `--json` (machine-readable output)
- Output: `<slug>  v<version>  <age>  <summary>` (summary truncated to 50 chars).

### `inspect <slug>`

- Fetches skill metadata and version files without installing.
- `--version <version>`: inspect a specific version (default: latest).
- `--tag <tag>`: inspect a tagged version (e.g. `latest`).
- `--versions`: list version history (first page).
- `--limit <n>`: max versions to list (1-200).
- `--files`: list files for the selected version.
- `--file <path>`: fetch raw file content (text files only; 200KB limit).
- `--json`: machine-readable output.

### `install <slug>`

- Resolves latest version via `/api/v1/skills/<slug>`.
- Downloads zip via `/api/v1/download`.
- Extracts into `<workdir>/<dir>/<slug>`.
- Writes:
  - `<workdir>/.clawhub/lock.json` (legacy `.clawdhub`)
  - `<skill>/.clawhub/origin.json` (legacy `.clawdhub`)

### `uninstall <slug>`

- Removes `<workdir>/<dir>/<slug>` and deletes the lockfile entry.
- Interactive: asks for confirmation.
- Non-interactive (`--no-input`): requires `--yes`.

### `list`

- Reads `<workdir>/.clawhub/lock.json` (legacy `.clawdhub`).

### `update [slug]` / `update --all`

- Computes fingerprint from local files.
- If fingerprint matches a known version: no prompt.
- If fingerprint does not match:
  - refuses by default
  - overwrites with `--force` (or prompt, if interactive)

### `skill publish <path>`

- Publishes via `POST /api/v1/skills` (multipart).
- Requires semver: `--version 1.2.3`.
- Publishing a skill means it is released under `MIT-0` on ClawHub.
- Published skills are free to use, modify, and redistribute without attribution.
- ClawHub does not support paid skills or per-skill pricing.
- Legacy alias: `publish <path>`.

### `delete <slug>`

- Soft-delete a skill (owner, moderator, or admin).
- Calls `DELETE /api/v1/skills/{slug}`.
- `--reason <text>` records a moderation note on the skill and audit log.
- `--note <text>` is an alias for `--reason`.
- `--yes` skips confirmation.

### `undelete <slug>`

- Restore a hidden skill (owner, moderator, or admin).
- Calls `POST /api/v1/skills/{slug}/undelete`.
- `--reason <text>` records a moderation note on the skill and audit log.
- `--note <text>` is an alias for `--reason`.
- `--yes` skips confirmation.

### `hide <slug>`

- Hide a skill (owner, moderator, or admin).
- Alias for `delete`.

### `unhide <slug>`

- Unhide a skill (owner, moderator, or admin).
- Alias for `undelete`.

### `skill rename <slug> <new-slug>`

- Rename an owned skill and keep the previous slug as a redirect alias.
- Calls `POST /api/v1/skills/{slug}/rename`.
- `--yes` skips confirmation.

### `skill merge <source-slug> <target-slug>`

- Merge one owned skill into another owned skill.
- The source slug stops listing publicly and becomes a redirect alias to the target.
- Calls `POST /api/v1/skills/{sourceSlug}/merge`.
- `--yes` skips confirmation.

### `transfer`

- Ownership transfer workflow.
- Subcommands:
  - `transfer request <slug> <handle> [--message "..."] [--yes]`
  - `transfer list [--outgoing]`
  - `transfer accept <slug> [--yes]`
  - `transfer reject <slug> [--yes]`
  - `transfer cancel <slug> [--yes]`
- Endpoints:
  - `POST /api/v1/skills/{slug}/transfer`
  - `POST /api/v1/skills/{slug}/transfer/accept`
  - `POST /api/v1/skills/{slug}/transfer/reject`
  - `POST /api/v1/skills/{slug}/transfer/cancel`
  - `GET /api/v1/transfers/incoming`
  - `GET /api/v1/transfers/outgoing`

### `ban-user <handleOrId>`

- Ban a user and delete owned skills (moderator/admin only).
- Calls `POST /api/v1/users/ban`.
- `--id` treats the argument as a user id instead of a handle.
- `--fuzzy` resolves the handle via fuzzy user search (admin only).
- `--reason` records an optional ban reason.
- `--yes` skips confirmation.

### `unban-user <handleOrId>`

- Unban a user and restore eligible skills (admin only).
- Calls `POST /api/v1/users/unban`.
- `--id` treats the argument as a user id instead of a handle.
- `--fuzzy` resolves the handle via fuzzy user search (admin only).
- `--reason` records an optional unban reason.
- `--yes` skips confirmation.

### `set-role <handleOrId> <role>`

- Change a user role (admin only).
- Calls `POST /api/v1/users/role`.
- `--id` treats the argument as a user id instead of a handle.
- `--fuzzy` resolves the handle via fuzzy user search (admin only).
- `--yes` skips confirmation.

### `package explore [query...]`

- Browses or searches the unified package catalog via `GET /api/v1/packages` and `GET /api/v1/packages/search`.
- Use this for plugins and other package-family entries; top-level `search` remains the skill search surface.
- Flags:
  - `--family skill|code-plugin|bundle-plugin`
  - `--official`
  - `--executes-code`
  - `--host-target <target>` (for example `darwin-arm64`, `linux-x64-glibc`, `win32-x64`)
  - `--environment <flag>` (for example `browser`, `desktop`, `network`)
  - `--limit <n>` (1-100, default: 25)
  - `--json`

Examples:

```bash
clawhub package explore --family code-plugin
clawhub package explore --family code-plugin --host-target darwin-arm64
clawhub package explore browser --family code-plugin --environment browser
clawhub package explore episodic-claw --family code-plugin
```

### `package inspect <name>`

- Fetches package metadata without installing.
- Use this for plugin metadata, StorePack availability, compatibility, verification, source, and version/file inspection.
- `--version <version>`: inspect a specific version (default: latest).
- `--tag <tag>`: inspect a tagged version (e.g. `latest`).
- `--versions`: list version history (first page).
- `--limit <n>`: max versions to list (1-100).
- `--files`: list files for the selected version.
- `--file <path>`: fetch raw file content (text files only; 200KB limit).
- `--json`: machine-readable output.

### `package download <name>`

- Downloads the selected package release as a StorePack archive.
- Calls `GET /api/v1/packages/{name}/download`.
- Defaults to the latest release.
- `--version <version>`: download a specific version.
- `--tag <tag>`: download a tagged version.
- `-o, --output <path>`: output path. Defaults to `<name>.storepack.zip`.
- `--json`: print the output path, StorePack SHA-256 header, and spec version.

### `package verify <file>`

- Verifies a downloaded StorePack ZIP.
- Requires `package/STOREPACK.json` inside the archive.
- `--sha256 <digest>`: also compare the full archive SHA-256.
- `--json`: machine-readable output.

### `package storepack <name>`

- Alias-style StorePack download command for operators who want the artifact noun first.
- Accepts the same `--version`, `--tag`, `--output`, and `--json` flags as `package download`.

### `package storepack-admin status`

- Admin-only migration status check.
- Calls `GET /api/v1/packages/storepack/migration-status`.
- Requires an API token for an admin user.
- `--limit <n>` controls sample size.
- `--json` emits the raw response.

### `package storepack-admin readiness`

- Admin-only readiness check for the official OpenClaw bundled plugin migration targets.
- Calls `GET /api/v1/packages/storepack/migration-readiness`.
- Requires an API token for an admin user.
- Prints each target package, readiness state, and blocker list.
- `--json` emits the raw response.

### `package storepack-admin backfill`

- Admin-only batch builder for legacy plugin releases missing stored StorePack artifacts.
- Calls `POST /api/v1/packages/storepack/backfill`.
- Requires an API token for an admin user.
- `--limit <n>` controls batch size.
- `--json` emits the raw response.

### `package storepack-admin index-backfill`

- Admin-only batch builder for StorePack host-target and environment lookup indexes.
- Calls `POST /api/v1/packages/storepack/index-backfill`.
- Requires an API token for an admin user.
- `--limit <n>` controls batch size.
- `--cursor <cursor>` continues from the previous batch response.
- `--json` emits the raw response.

### `package storepack-admin retry-failures`

- Admin-only batch retry for failed StorePack artifact builds.
- Calls `POST /api/v1/packages/storepack/retry-failures`.
- Requires an API token for an admin user.
- `--limit <n>` controls batch size.
- `--json` emits the raw response.

### `package storepack-admin revoke <name> <version>`

- Moderator/admin revocation path for a published StorePack artifact.
- Calls `POST /api/v1/packages/{name}/versions/{version}/storepack/revoke`.
- Requires an API token for an admin or moderator user.
- `--reason <text>` records the moderation reason.
- `--json` emits the raw response.

### `package publish <source>`

- Publishes a code plugin or bundle plugin via `POST /api/v1/packages`.
- `<source>` accepts:
  - Local folder path: `./my-plugin`
  - Local package archive: `./my-plugin.zip`, `./my-plugin.tgz`, or `./my-plugin.tar.gz`
  - GitHub repo: `owner/repo` or `owner/repo@ref`
  - GitHub URL: `https://github.com/owner/repo`
- Metadata is auto-detected from `package.json`, `openclaw.plugin.json`, and `openclaw.bundle.json`.
- For GitHub sources, source attribution is auto-populated from the repo, resolved commit, ref, and subpath.
- For local folders, source attribution is auto-detected from local git when the origin remote points at GitHub.
- External code plugins must declare `openclaw.compat.pluginApi` and `openclaw.build.openclawVersion` explicitly.
  Top-level `package.json.version` is not used as a fallback for publish validation.
- `--dry-run` previews the resolved publish payload without uploading.
- `--json` emits machine-readable output for CI.
- `--owner <handle>` lets admins publish under a shared owner account while keeping their own token as the actor.
- Existing flags (`--family`, `--name`, `--version`, `--source-repo`, `--source-commit`, `--source-ref`, `--source-path`) still work as overrides.
- Private GitHub repos require `GITHUB_TOKEN`.

#### Recommended local flow

Use `--dry-run` first so you can confirm the resolved package metadata and
source attribution before creating a live release:

```bash
clawhub package publish ./my-plugin --family code-plugin --dry-run
clawhub package publish ./my-plugin --family code-plugin
```

#### Minimal `package.json` for `--family code-plugin`

External code plugins need a small amount of OpenClaw metadata in
`package.json`. This minimal manifest is enough for a successful publish:

```json
{
  "name": "@myorg/openclaw-my-plugin",
  "version": "1.0.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"],
    "compat": {
      "pluginApi": ">=2026.3.24-beta.2"
    },
    "build": {
      "openclawVersion": "2026.3.24-beta.2"
    }
  }
}
```

Required fields:

- `openclaw.compat.pluginApi`
- `openclaw.build.openclawVersion`

Notes:

- `package.json.version` is your package release version, but it is not used as
  a fallback for OpenClaw compatibility/build validation.
- `openclaw.compat.minGatewayVersion` and
  `openclaw.build.pluginSdkVersion` are optional extras if you want to publish
  more detailed compatibility metadata.
- If you are using an older `clawhub` CLI release, upgrade before publishing so
  the local preflight checks run before upload.

#### GitHub Actions

ClawHub also ships an official reusable workflow at
[`/.github/workflows/package-publish.yml`](../.github/workflows/package-publish.yml)
for plugin repos.

Typical caller setup:

```yaml
name: Package Publish

on:
  pull_request:
  workflow_dispatch:
  push:
    tags:
      - "v*"

jobs:
  dry-run:
    if: github.event_name == 'pull_request'
    uses: openclaw/clawhub/.github/workflows/package-publish.yml@v0.12.0
    with:
      dry_run: true

  publish:
    if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/')
    permissions:
      contents: read
      id-token: write
    uses: openclaw/clawhub/.github/workflows/package-publish.yml@v0.12.0
    with:
      dry_run: false
    secrets:
      clawhub_token: ${{ secrets.CLAWHUB_TOKEN }}
```

Notes:

- The reusable workflow defaults `source` to the caller repo.
- Pin the reusable workflow to a stable tag or full commit SHA. Do not run release publishing from `@main`.
- `pull_request` should use `dry_run: true` so CI stays non-polluting.
- Real publishes should be limited to trusted events such as `workflow_dispatch` or tag pushes.
- Trusted publishing without a secret only works on `workflow_dispatch`; tag pushes still need `clawhub_token`.
- Keep `clawhub_token` available for first publish, untrusted packages, or break-glass publishes.
- The workflow uploads the JSON result as an artifact and exposes it as workflow outputs.

### `sync`

- Scans for local skill folders and publishes new/changed ones.
- Roots can be any folder: a skills directory or a single skill folder with `SKILL.md`.
- Auto-adds Clawdbot skill roots when `~/.clawdbot/clawdbot.json` is present:
  - `agent.workspace/skills` (main agent)
  - `routing.agents.*.workspace/skills` (per-agent)
  - `~/.clawdbot/skills` (shared)
  - `skills.load.extraDirs` (shared packs)
- Respects `CLAWDBOT_CONFIG_PATH` / `CLAWDBOT_STATE_DIR` and `OPENCLAW_CONFIG_PATH` / `OPENCLAW_STATE_DIR`.
- Flags:
  - `--root <dir...>` extra scan roots
  - `--all` upload without prompting
  - `--dry-run` show plan only
  - `--bump patch|minor|major` (default: patch)
  - `--changelog <text>` (non-interactive)
  - `--tags a,b,c` (default: latest)
  - `--concurrency <n>` (default: 4)

Telemetry:

- Sent during `sync` when logged in, unless `CLAWHUB_DISABLE_TELEMETRY=1` (legacy `CLAWDHUB_DISABLE_TELEMETRY=1`).
- Details: `docs/telemetry.md`.
