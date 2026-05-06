# ClawHub Moderator CLI

Private operator CLI for ClawHub platform moderation and moderator-only package operations.

This package is intentionally marked `private: true`. Do not publish it to npm.
Release built artifacts through restricted GitHub Releases only.

`clawhub-mod` reuses the public CLI's auth, config, HTTP, and schema helpers,
but it is a separate binary with a separate release path. Commands call the
existing RBAC-gated entity endpoints, such as `/api/v1/users/*` and
`/api/v1/packages/*`; there is no separate moderator API namespace.

## Build and Verify

```bash
bun run --cwd packages/clawhub-mod build
bun run --cwd packages/clawhub-mod verify
```

For full package coverage from the repo root:

```bash
bun run ci:packages
```

## Release and Install

`clawhub-mod` is intentionally not published to npm. Moderator releases are built
as GitHub Release assets from tags that match the package version:

```bash
clawhub-mod-v0.1.0
```

Run the `ClawHub Moderator CLI Release` workflow from `main` with that tag. The
workflow verifies the package, packs `@openclaw/clawhub-mod`, and creates or
updates a draft GitHub Release. Keep the release draft/restricted unless the
distribution policy changes.

Moderator users install or upgrade with GitHub auth:

```bash
gh auth login
bash scripts/install-clawhub-mod.sh
```

To pin a specific version:

```bash
bash scripts/install-clawhub-mod.sh --version 0.1.0
```

## Local E2E

Use an isolated config path so moderator testing never overwrites your normal
`clawhub` CLI login:

```bash
export CLAWHUB_CONFIG_PATH=/tmp/clawhub-mod-local-config.json
```

Point `--registry` at the Convex HTTP actions URL, usually
`VITE_CONVEX_SITE_URL`, not the Vite frontend URL:

```bash
clawhub-mod --registry http://127.0.0.1:3211 login --token <local-token> --no-browser
clawhub-mod --registry http://127.0.0.1:3211 whoami
clawhub-mod --registry http://127.0.0.1:3211 package moderation-queue --json
```

For a fresh anonymous local Convex deployment in a disposable worktree:

```bash
CONVEX_AGENT_MODE=anonymous bunx convex dev --local --typecheck=disable
```

In another shell, seed the local role fixture and use the returned admin token
for moderator commands:

```bash
CONVEX_AGENT_MODE=anonymous bunx convex run --no-push devSeed:seedCliRoleHelpFixtures
```

## Commands

Authentication uses the same ClawHub token/config path as the public CLI:

```bash
clawhub-mod login
clawhub-mod whoami
```

User administration:

```bash
clawhub-mod users ban <handleOrId> [--id] [--fuzzy] [--reason <text>] [--yes]
clawhub-mod users unban <handleOrId> [--id] [--fuzzy] [--reason <text>] [--yes]
clawhub-mod users set-role <handleOrId> <user|moderator|admin> [--id] [--fuzzy] [--yes]
```

The old top-level names are also available on the moderator binary:

```bash
clawhub-mod ban-user <handleOrId>
clawhub-mod unban-user <handleOrId>
clawhub-mod set-role <handleOrId> <user|moderator|admin>
```

Package moderation and operations:

```bash
clawhub-mod package moderate <name> --version <version> --state approved|quarantined|revoked --reason <text>
clawhub-mod package moderation-status <name>
clawhub-mod package moderation-queue [--status open|blocked|manual|all]
clawhub-mod package reports [--status open|confirmed|dismissed|all]
clawhub-mod package triage-report <report-id> --status open|confirmed|dismissed [--note <text>] [--action none|quarantine|revoke] [--yes]
clawhub-mod package appeals [--status open|accepted|rejected|all]
clawhub-mod package resolve-appeal <appeal-id> --status open|accepted|rejected [--note <text>] [--action none|approve] [--yes]
clawhub-mod package migrations [--phase <phase>]
clawhub-mod package set-migration <bundled-plugin-id> --package <name>
clawhub-mod package backfill-artifacts [--all] [--apply]
clawhub-mod package trusted-publisher get <name>
clawhub-mod package trusted-publisher set <name> --repository <owner/repo> --workflow-filename <file>
clawhub-mod package trusted-publisher delete <name>
```

All package commands accept `--json` where the underlying endpoint supports machine-readable output.
