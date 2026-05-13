---
name: clawhub-moderation
description: "Use for ClawHub staff moderation actions with the repo-local clawhub-mod tool: unhide skills, ban or unban users, change roles, and verify moderation state."
---

# ClawHub Moderation

Use the repo-local `clawhub-mod` tool from a checked-out ClawHub repo. It wraps
the existing ClawHub CLI auth/config and HTTP API surfaces. Do not call Convex
internal mutations directly for staff actions.

## Safety Rules

- Require an explicit target from the user: skill slug, user handle, or user id.
- Require a reason for `skills unhide`, `users ban`, and `users unban`.
- Before any write, show the exact command and ask for confirmation unless the
  user already said to proceed or supplied `--yes`.
- Prefer handles for humans. Use `--id` only when the user provides a user id.
- Never bypass API-token auth, server role checks, or audit logging.
- After the write, verify state with the CLI/API and report the result.

## Commands

Run from the ClawHub repo root:

```sh
bun run mod -- --help
```

Authenticate or validate the current token:

```sh
bun run mod -- login
bun run mod -- whoami
```

Unhide a skill after moderator review:

```sh
bun run mod -- skills unhide <slug> --reason "<reason>" --yes
```

List and triage skill reports:

```sh
bun run mod -- skills reports --status open
bun run mod -- skills triage-report <report-id> --status confirmed --action hide --note "<note>" --yes
```

Ban a user:

```sh
bun run mod -- users ban <handleOrId> --reason "<reason>" --yes
```

Unban a user:

```sh
bun run mod -- users unban <handleOrId> --reason "<reason>" --yes
```

Change a user role:

```sh
bun run mod -- users set-role <handleOrId> <user|moderator|admin> --yes
```

Use `--id` when `<handleOrId>` is a user id. Use `--fuzzy` only when the user
has asked for fuzzy handle resolution or the exact handle is ambiguous.

The old top-level aliases still exist for user commands:

```sh
bun run mod -- ban-user <handleOrId> --reason "<reason>" --yes
bun run mod -- unban-user <handleOrId> --reason "<reason>" --yes
```

## Verification

- For skills, inspect the page/API status after `skills unhide`.
- For users, prefer `bun run mod -- whoami` for the current token and user
  search/admin surfaces for target accounts where available.
- If verification is blocked by auth or missing admin access, report the command
  result and the verification blocker plainly.

## Impact Notes

- `skills unhide` is a moderator manual restore. It clears skill hidden state,
  applies a clean manual override to top-level moderation fields, preserves
  version-level scanner records, updates public stats, and writes audit logs.
- There is no standalone `skills hide` command in `clawhub-mod`; use report
  triage with `--action hide` when resolving a report that should hide a skill.
- `ban-user` is disruptive: it revokes API tokens, marks the user deleted,
  hides owned skills, soft-deletes comments, and writes audit logs.
- `unban-user` is admin-only. It clears ban state and restores skills that were
  hidden by the matching ban flow; revoked API tokens stay revoked.
