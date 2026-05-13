---
summary: "How ClawHub reports, moderation holds, hidden listings, bans, and account standing work."
read_when:
  - Reporting a skill, plugin, package, or comment
  - Recovering from a held, hidden, or blocked listing
  - Understanding ClawHub moderation, bans, or account standing
title: "Moderation and Account Safety"
sidebarTitle: "Moderation and Account Safety"
---

# Moderation and Account Safety

ClawHub is open to publishing, but public discovery and install surfaces still
need guardrails. Reports, moderation holds, hidden listings, and account actions
help protect users when a release or account appears unsafe, misleading, or out
of policy.

This page covers moderation and account standing. For audit labels such as
`Pass`, `Review`, `Warn`, `Malicious`, and risk level, see
[Security Audits](./security-audits.md).

See also [Acceptable usage](./acceptable-usage.md).

## Reports

Signed-in users can report skills, plugins, packages, and comments.

Good reports are specific and actionable. Useful reasons include:

- misleading metadata
- undeclared credentials or permission requirements
- suspicious install instructions
- scam comments or impersonation
- bad-faith registrations or trademark misuse
- content that violates [Acceptable usage](./acceptable-usage.md)

Abuse of reporting can itself lead to account action.

## Moderation holds

Some severe findings or policy issues can place a publisher or listing under a
moderation hold. When this happens, affected content may be hidden from public
discovery or future publishes may start hidden until the issue is reviewed.

Moderation holds are meant to protect users while ClawHub resolves high-risk
cases. They can also be lifted when a false positive is confirmed.

## Hidden or blocked listings

A listing may be held, hidden, quarantined, revoked, or otherwise unavailable on
public install surfaces.

If you see one of these states, do not install the release unless the owner
resolves the issue or moderation restores it.

Owners may still see diagnostics for their own held or hidden listings. These
diagnostics help explain what happened and what needs to change before the
listing can return to public surfaces.

## Bans and account standing

Accounts that violate ClawHub policy may lose publishing access. Severe abuse can
result in account bans, token revocation, hidden content, or removed listings.

Deleted, banned, or disabled accounts cannot use ClawHub API tokens. If CLI auth
starts failing after account action, sign in to the web UI to review account
state. If sign-in or normal CLI access is blocked, contact security@openclaw.ai
for recovery review.

## Publisher guidance

To reduce false positives and improve user trust:

- keep names, summaries, tags, and changelogs accurate
- declare required environment variables and permissions
- explain unusual but intentional behavior in a ClawScan note
- avoid obfuscated install commands
- link to source when possible
- use dry runs before publishing plugins
- respond clearly if users or moderators ask about release behavior
