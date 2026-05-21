# ClawHub Moderator CLI

Private operator CLI for ClawHub platform moderation and moderator-only package operations.

This package is intentionally marked `private: true`. Do not publish it to npm.
Run it from a checked-out ClawHub repo so maintainers always use the current
repo code.

`clawhub-mod` reuses the public CLI's auth, config, HTTP, and schema helpers,
but it is a separate maintainer command surface. Commands call the existing
RBAC-gated entity endpoints, such as `/api/v1/users/*` and `/api/v1/packages/*`;
there is no separate moderator API namespace.

## Run

From the repo root:

```bash
bun install
bun run mod -- --help
```

Example:

```bash
bun run mod -- skills unhide maxhub-pipixia --reason "VT false positive; reanalysis clean" --yes
```

## Build and Verify

```bash
bun run --cwd packages/clawhub-mod build
bun run --cwd packages/clawhub-mod verify
```

For full package coverage from the repo root:

```bash
bun run ci:packages
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
bun run mod -- --registry http://127.0.0.1:3211 login --token <local-token> --no-browser
bun run mod -- --registry http://127.0.0.1:3211 whoami
bun run mod -- --registry http://127.0.0.1:3211 plugins queue --json
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
bun run mod -- login
bun run mod -- whoami
```

User administration:

```bash
bun run mod -- users ban <handleOrId> [--id] [--fuzzy] [--reason <text>] [--yes]
bun run mod -- users unban <handleOrId> [--id] [--fuzzy] [--reason <text>] [--yes]
bun run mod -- users set-role <handleOrId> <user|moderator|admin> [--id] [--fuzzy] [--yes]
bun run mod -- users reclassify-ban <handleOrId> --reason <text> [--id] [--fuzzy] [--dry-run|--apply] [--yes] [--json]
bun run mod -- users remediate-autobans [--dry-run|--apply] [--user <handleOrId>] [--id] [--since <date>] [--limit <n>] [--cursor <cursor>] [--all] [--json]
```

The old top-level names are also available on the moderator binary:

```bash
bun run mod -- ban-user <handleOrId>
bun run mod -- unban-user <handleOrId>
bun run mod -- set-role <handleOrId> <user|moderator|admin>
```

Package moderation and operations:

```bash
bun run mod -- skills reports [--status open|confirmed|dismissed|all]
bun run mod -- skills rescan <slug> [--version <version>] [--yes] [--json]
bun run mod -- skills unhide <slug> --reason <text> [--yes]
bun run mod -- skills triage-report <report-id> --status open|confirmed|dismissed [--note <text>] [--action none|hide] [--yes]

bun run mod -- plugins moderate <name> --version <version> --state approved|quarantined|revoked --reason <text>
bun run mod -- plugins status <name>
bun run mod -- plugins queue [--status open|blocked|manual|all]
bun run mod -- plugins reports [--status open|confirmed|dismissed|all]
bun run mod -- plugins triage-report <report-id> --status open|confirmed|dismissed [--note <text>] [--action none|quarantine|revoke] [--yes]

bun run mod -- plugins migrations [--phase <phase>]
bun run mod -- plugins set-migration <bundled-plugin-id> --package <name>
bun run mod -- plugins backfill-artifacts [--all] [--apply]
bun run mod -- plugins repair-name <name> --next-name <name> --reason <text> [--retire-target] [--owner <handle>] [--apply]
bun run mod -- plugins trusted-publisher get <name>
bun run mod -- plugins trusted-publisher set <name> --repository <owner/repo> --workflow-filename <file>
bun run mod -- plugins trusted-publisher delete <name>
```

All skill and plugin commands accept `--json` where the underlying endpoint supports machine-readable output.
