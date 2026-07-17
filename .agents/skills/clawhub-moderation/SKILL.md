---
name: clawhub-moderation
description: "Use for ClawHub staff moderation actions with the repo-local ClawHub admin tool: skills, users, org publishers, plugin packages, trusted publishers, official publishers, and guarded staff email."
---

# ClawHub Moderation

Use the repo-local admin tool from a checked-out ClawHub repo. It wraps
the existing ClawHub CLI auth/config and HTTP API surfaces. Do not call Convex
internal mutations directly for staff actions.

## Safety Rules

- Require an explicit target from the user: skill slug, user handle, or user id.
- Require a reason for destructive, restorative, ownership, or moderation writes.
- Before any write, show the exact command and ask for confirmation unless the
  user already said to proceed or supplied `--yes`.
- For `email send`, the user must explicitly ask for the email and sign off on
  the final recipient, subject, and body. Dry-run is fine for drafting. Never
  send until both are true, and only use `--send --confirm-user-request
--confirm-user-signoff` after that approval.
- Prefer handles for humans. Use `--id` only when the user provides a user id.
- Never bypass API-token auth, server role checks, or audit logging.
- After the write, verify state with the CLI/API and report the result.

## Command Map

Run from the ClawHub repo root:

```sh
bun run admin -- --help
```

Authenticate or validate the current token:

```sh
bun run admin -- login
bun run admin -- whoami
```

Current top-level command groups:

```text
auth
users
plugins|plugin
packages|package
org
email
skills|skill
```

### Skills

`bun run admin -- skills --help` exposes:

```text
unhide <slug>
revoke-version <slug>
rescan <slug>
reports
triage-report <report-id>
```

Examples:

```sh
bun run admin -- skills unhide <slug> --reason "<reason>" --yes
bun run admin -- skills revoke-version <slug> --version <version> --reason "<reason>" --yes
bun run admin -- skills rescan <slug> --reason "<reason>" --yes
bun run admin -- skills reports --status open
bun run admin -- skills triage-report <report-id> --status confirmed --action hide --note "<note>" --yes
```

Pass `--owner <handle>` to `revoke-version` when more than one publisher uses the same slug.

### Users

`bun run admin -- users --help` exposes:

```text
ban <handleOrId>
unban <handleOrId>
lift-moderation-hold <handleOrId>
set-role <handleOrId> <role>
reclassify-ban <handleOrId>
remediate-autobans
```

Examples:

```sh
bun run admin -- users ban <handleOrId> --reason "<reason>" --yes
bun run admin -- users unban <handleOrId> --reason "<reason>" --yes
bun run admin -- users lift-moderation-hold <handleOrId> --reason "<reason>" --yes
bun run admin -- users set-role <handleOrId> <user|moderator|admin> --yes
bun run admin -- users reclassify-ban <handleOrId> --reason "<reason>" --apply --yes
bun run admin -- users remediate-autobans --apply --reason "<reason>"
```

Use `--id` when `<handleOrId>` is a user id. Use `--fuzzy` only when the user
has asked for fuzzy handle resolution or the exact handle is ambiguous.

### Org Publishers

`bun run admin -- org --help` exposes:

```text
official
create <handle>
remove-member <handle> <member>
delete <handle>
repair-scoped-packages <csv>
```

Examples:

```sh
bun run admin -- org official list
bun run admin -- org official add <handle> --reason "<reason>" --yes
bun run admin -- org official remove <handle> --reason "<reason>" --yes
bun run admin -- org create <handle> --display-name "<name>" --member <user-handle> --role owner
bun run admin -- org remove-member <handle> <member-handle>
bun run admin -- org delete <handle> --reason "<reason>"          # dry-run
bun run admin -- org delete <handle> --reason "<reason>" --apply
bun run admin -- org repair-scoped-packages <csv>                  # dry-run
bun run admin -- org repair-scoped-packages <csv> --apply
```

`org create` requires `--member`; it must not add the moderator running the
command as an implicit owner. `org delete` only works for empty org publishers
and defaults to dry-run.

### Plugin Packages

`bun run admin -- packages --help` exposes:

```text
moderate <name>
status|moderation-status <name>
queue|moderation-queue
reports
triage-report <report-id>
transfer <name>
repair-name <name>
migrations
set-migration <bundled-plugin-id>
trusted-publisher
```

Examples:

```sh
bun run admin -- packages status <name>
bun run admin -- packages transfer <name> --to <owner> --reason "<reason>"       # dry-run
bun run admin -- packages transfer <name> --to <owner> --reason "<reason>" --apply
bun run admin -- packages repair-name <name> --next-name <name> --reason "<reason>"
bun run admin -- packages trusted-publisher get <name>
bun run admin -- packages trusted-publisher set <name> --repository <owner/repo> --workflow-filename <file>
```

### Staff Email

`bun run admin -- email send --help` exposes:

```text
--to <email>
--user <handle>
--subject <subject>
--body-file <path>
--body <text>
--send
--confirm-user-request
--confirm-user-signoff
--json
```

Draft only:

```sh
bun run admin -- email send --user <handle> --subject "<subject>" --body-file <path>
```

Send only after explicit request and sign-off:

```sh
bun run admin -- email send --user <handle> --subject "<subject>" --body-file <path> --send --confirm-user-request --confirm-user-signoff
```

The server sends through the production noreply provider and writes an audit log
only after admin auth succeeds.

## Verification

- For skills, inspect the page/API status after `skills unhide`.
- For users, prefer user search/admin surfaces for target accounts where
  available.
- For orgs and packages, use the public publisher/plugin pages and the relevant
  CLI status command after a write.
- For email, verify the CLI response and audit expectation; do not send a second
  email just to test delivery.
- If verification is blocked by auth or missing admin access, report the command
  result and the verification blocker plainly.

## Impact Notes

- `skills unhide` is a moderator manual restore. It clears skill hidden state,
  applies a clean manual override to top-level moderation fields, preserves
  version-level scanner records, updates public stats, and writes audit logs.
- `skills revoke-version` permanently removes one exact version, records staff
  evidence, advances latest pointers to a safe survivor when one exists, and
  keeps the skill independently hidden when no usable version remains.
- There is no standalone `skills hide` command in `clawhub-admin`; use report
  triage with `--action hide` when resolving a report that should hide a skill.
- `users ban` is disruptive: it revokes API tokens, marks the user deleted,
  hides owned skills, soft-deletes comments, and writes audit logs.
- `users unban` is admin-only. It clears ban state and restores skills that were
  hidden by the matching ban flow; revoked API tokens stay revoked.
- `users lift-moderation-hold` is admin-only. It clears the account-level
  moderation hold, restores skills hidden by that hold, and writes an audit log.
- `packages transfer` preserves the package row, stats, releases, and history;
  it changes the owner publisher.
- `org delete` soft-deletes an empty org publisher and retains member rows for
  history; it refuses orgs with active skills or packages.
