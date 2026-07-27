# ClawHub Admin CLI

Private operator CLI for ClawHub platform moderation and staff-only package operations.

This package is intentionally marked `private: true`. Do not publish it to npm.
Run it from a checked-out ClawHub repo so maintainers always use the current
repo code.

`clawhub-admin` reuses the public CLI's auth, config, HTTP, and schema helpers,
but it is a separate maintainer command surface. Commands call the existing
RBAC-gated entity endpoints, such as `/api/v1/users/*` and `/api/v1/packages/*`;
there is no separate moderator API namespace.

## Run

From the repo root:

```bash
bun install
bun run admin -- --help
```

Example:

```bash
bun run admin -- skills unhide maxhub-pipixia --reason "VT false positive; reanalysis clean" --yes
```

## Build and Verify

```bash
bun run --cwd packages/clawhub-admin build
bun run --cwd packages/clawhub-admin verify
```

For full package coverage from the repo root:

```bash
bun run ci:packages
```

## Local E2E

Use an isolated config path so admin testing never overwrites your normal
`clawhub` CLI login:

```bash
export CLAWHUB_CONFIG_PATH=/tmp/clawhub-admin-local-config.json
```

Point `--registry` at the Convex HTTP actions URL, usually
`VITE_CONVEX_SITE_URL`, not the Vite frontend URL:

```bash
bun run admin -- --registry http://127.0.0.1:3211 login --token <local-token> --no-browser
bun run admin -- --registry http://127.0.0.1:3211 whoami
bun run admin -- --registry http://127.0.0.1:3211 plugins queue --json
```

For a fresh anonymous local Convex deployment in a disposable worktree:

```bash
CONVEX_AGENT_MODE=anonymous bunx convex dev --local --typecheck=disable
```

In another shell, seed the local role fixture and use the returned admin token
for admin commands:

```bash
CONVEX_AGENT_MODE=anonymous bunx convex run --no-push devSeed:seedCliRoleHelpFixtures
```

## Commands

Authentication uses the same ClawHub token/config path as the public CLI:

```bash
bun run admin -- login
bun run admin -- whoami
```

User administration:

```bash
bun run admin -- users ban <handleOrId> [--id] [--fuzzy] [--reason <text>] [--yes]
bun run admin -- users unban <handleOrId> [--id] [--fuzzy] [--reason <text>] [--yes]
bun run admin -- users lift-moderation-hold <handleOrId> --reason <text> [--id] [--fuzzy] [--yes] [--json]
bun run admin -- users set-role <handleOrId> <user|moderator|admin> [--id] [--fuzzy] [--yes]
bun run admin -- users reclassify-ban <handleOrId> --reason <text> [--id] [--fuzzy] [--dry-run|--apply] [--yes] [--json]
bun run admin -- users recover-publisher <handle> --to <handle> --previous-github-id <id> --next-github-id <id> --reason <text> [--retired-handle <handle>] [--verified] [--apply] [--yes] [--json]
```

Org publisher administration:

```bash
bun run admin -- org create <handle> --member <handle> [--display-name <name>] [--role owner|admin|publisher] [--trusted] [--json]
```

`org create` requires `--member` and defaults that member to `owner`; it does
not add the admin running the command as an org member.

Publisher administration:

```bash
bun run admin -- publisher official list [--json]
bun run admin -- publisher official add <handle> --reason <text> [--yes] [--json]
bun run admin -- publisher official remove <handle> --reason <text> [--yes] [--json]
```

`org official ...` is retained as a compatibility alias for existing operator
scripts.

Package moderation and operations:

```bash
bun run admin -- skills reports [--status open|confirmed|dismissed|all]
bun run admin -- skills feature <slug|@owner/slug> [--json]
bun run admin -- skills unfeature <slug|@owner/slug> [--json]
bun run admin -- skills hard-delete @owner/slug --reason <text> [--apply --confirm <token> --yes] [--json]
bun run admin -- skills rescan <slug> [--version <version>] [--yes] [--json]
bun run admin -- skills unhide <slug> --reason <text> [--yes]
bun run admin -- skills triage-report <report-id> --status open|confirmed|dismissed [--note <text>] [--action none|hide] [--yes]

bun run admin -- plugins moderate <name> --version <version> --state approved|quarantined|revoked --reason <text>
bun run admin -- plugins feature <name> [--json]
bun run admin -- plugins unfeature <name> [--json]
bun run admin -- plugins status <name>
bun run admin -- plugins queue [--status open|blocked|manual|all]
bun run admin -- plugins reports [--status open|confirmed|dismissed|all]
bun run admin -- plugins triage-report <report-id> --status open|confirmed|dismissed [--note <text>] [--action none|quarantine|revoke] [--yes]

bun run admin -- plugins migrations [--phase <phase>]
bun run admin -- plugins set-migration <bundled-plugin-id> --package <name>
bun run admin -- plugins repair-name <name> --next-name <name> --reason <text> [--retire-target] [--owner <handle>] [--apply]
bun run admin -- plugins trusted-publisher get <name>
bun run admin -- plugins trusted-publisher set <name> --repository <owner/repo> --workflow-filename <file>
bun run admin -- plugins trusted-publisher delete <name>
```

All skill and plugin commands accept `--json` where the underlying endpoint supports machine-readable output.
