---
summary: "ClawHub trust, scan, reporting, appeal, and moderation behavior."
read_when:
  - Understanding ClawHub scan and moderation outcomes
  - Reporting a skill or package
  - Recovering from a held, hidden, or blocked listing
---

# Security + Moderation

ClawHub is open to publishing, but public listings still pass through trust,
scan, reporting, and moderation controls. The goal is practical: help users
inspect what they install, give publishers a recovery path for false positives,
and keep abusive packages out of public discovery.

See also [Acceptable usage](./acceptable-usage.md).

## What users can inspect

Before installing a skill or plugin, check its ClawHub listing for:

- owner and source attribution
- latest version and changelog
- required environment variables or permissions
- compatibility metadata for plugins
- scan or moderation status
- reports, comments, stars, downloads, and install signals where shown

Install only content you understand and trust.

## Scan states

ClawHub may show scan or moderation outcomes on public pages and owner-visible
diagnostics.

Common outcomes include:

- `clean`: no blocking issue was found.
- `suspicious`: the release needs caution or review.
- `malicious`: the release is considered unsafe.
- `pending`: checks have not finished yet.
- `held`, `quarantined`, `revoked`, or `hidden`: the release is not fully
  available on public install surfaces.

Exact wording may vary by surface, but the practical meaning is the same: if a
release is held or blocked, users should not install it until the owner resolves
the issue or moderation restores it.

## Skills

Skill scans look at the published skill bundle, metadata, declared
requirements, and suspicious instructions.

ClawHub pays special attention to mismatches between what a skill declares and
what it appears to do. For example, a skill that references a required API key
should declare that requirement in `SKILL.md` so users can see it before
installing.

See [Skill format](./skill-format.md).

## Plugins

Plugin releases include package metadata, source attribution, compatibility
fields, and artifact integrity information.

OpenClaw checks compatibility before installing ClawHub-hosted plugins. Package
records may also expose digest metadata so OpenClaw can verify downloaded
artifacts.

## Reports

Signed-in users can report skills, packages, and comments.

Reports should be specific and actionable. Abuse of reporting can itself lead to
account action.

Report examples:

- misleading metadata
- undeclared credential or permission requirements
- suspicious install instructions
- scam comments or impersonation
- content that violates [Acceptable usage](./acceptable-usage.md)

## Appeals and rescans

Owners can request a rescan when they believe a skill or package was incorrectly
held or flagged:

```bash
clawhub skill rescan <slug>
clawhub package rescan <name>
```

For moderated content, owners may be able to submit an appeal from the
owner-visible ClawHub surfaces. Appeals should explain what changed or why the
flag is incorrect.

## Bans and account standing

Accounts that violate ClawHub policy may lose publishing access. Severe abuse
can result in account bans, token revocation, hidden content, or removed
listings.

Deleted, banned, or disabled accounts cannot use ClawHub API tokens. If CLI auth
starts failing after account action, sign in to the web UI to review account
state or contact maintainers through the expected project support channel.

## Publisher guidance

To reduce false positives and improve user trust:

- keep names, summaries, tags, and changelogs accurate
- declare required environment variables and permissions
- avoid obfuscated install commands
- link to source when possible
- use dry runs before publishing plugins
- respond clearly if users or moderators ask about package behavior
