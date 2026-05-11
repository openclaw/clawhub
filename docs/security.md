---
summary: "ClawHub trust, scan, reporting, and moderation behavior."
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

Scan findings are artifact-based. Expected provider behavior, such as declared
API credentials, localhost OAuth callbacks, scoped uninstall cleanup, Basic Auth
encoding, or user-selected file uploads to the stated provider, is treated
differently from hidden credential forwarding, broad private-file access,
unrelated network destinations, or stealth browser abuse.

See [Skill format](./skill-format.md).

## Plugins

Plugin releases include package metadata, source attribution, compatibility
fields, and artifact integrity information.

OpenClaw checks compatibility before installing ClawHub-hosted plugins. Package
records may also expose digest metadata so OpenClaw can verify downloaded
artifacts. ClawScan includes declared package `openclaw.environment` env/config
metadata when reviewing plugin releases so declared runtime requirements are
compared against observed behavior.

## Reports

Signed-in users can report skills, packages, and comments.

Reports should be specific and actionable. Abuse of reporting can itself lead to
account action.

Report examples:

- misleading metadata
- undeclared credential or permission requirements
- suspicious install instructions
- scam comments or impersonation
- bad-faith registrations or trademark misuse
- content that violates [Acceptable usage](./acceptable-usage.md)

## Publisher ClawScan notes

Publishers can provide an optional ClawScan note when publishing a skill or
plugin. This note gives ClawScan context for behavior that may otherwise look
unusual, such as network access, native host access, or provider-specific
credentials.

## Moderation Holds

When the static scanner flags an uploaded skill as malicious, the publisher is
automatically placed under a moderation hold (`requiresModerationAt` set on the
user). This hides all of the publisher's skills, causes future publishes to
start hidden, and creates a `user.moderation.auto` audit log entry.

Static suspicious findings are retained as file/line evidence for moderators,
but they do not hide content or decide the public scan verdict on their own.
New uploads remain in review/pending state until the LLM review settles. Static
scanning only blocks immediately for malicious signatures. VirusTotal engine
hits remain visible security evidence, but VirusTotal Code Insight/Palm
verdicts are advisory and do not hide skills on their own. ClawScan LLM reviews
keep purpose-aligned notes as guidance. Medium review findings remain visible on
the artifact, while the suspicious filter is reserved for high-impact LLM
concerns, malicious findings, or corroborated AV-engine detections.

Admins can lift a false-positive hold:

```bash
npx convex run users:liftModerationHold '{"userId": "<user-id>", "reason": "False positive from security tool scanning"}'
```

This clears `requiresModerationAt` and `requiresModerationReason`, restores
skills hidden by the user-level hold, and writes a `user.moderation.lift` audit
log entry. Skills hidden for other reasons, or whose own static scan remains
malicious, stay hidden.

## Bans and account standing

Accounts that violate ClawHub policy may lose publishing access. Severe abuse
can result in account bans, token revocation, hidden content, or removed
listings.

Deleted, banned, or disabled accounts cannot use ClawHub API tokens. If CLI auth
starts failing after account action, sign in to the web UI to review account
state. If sign-in or normal CLI access is blocked, contact
security@openclaw.ai for recovery review.

## Publisher guidance

To reduce false positives and improve user trust:

- keep names, summaries, tags, and changelogs accurate
- declare required environment variables and permissions
- add a publisher ClawScan note when a release has unusual but intentional behavior
- avoid obfuscated install commands
- link to source when possible
- use dry runs before publishing plugins
- respond clearly if users or moderators ask about package behavior
