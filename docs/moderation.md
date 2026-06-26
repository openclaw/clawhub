---
summary: "How ClawHub reports, moderation holds, hidden listings, bans, and account standing work."
read_when:
  - Reporting a skill, plugin, or package
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

See also [Security](./security.md) and
[Acceptable usage](./acceptable-usage.md). For copyright or other content
rights concerns, use [Content Rights Requests](./content-rights.md).

## Reports

Signed-in users can report skills, plugins, and packages.

Use ClawHub reports only for unsafe marketplace content, such as:

- malicious listings
- misleading metadata
- undeclared credentials or permission requirements
- suspicious install instructions
- impersonation
- bad-faith registrations or trademark misuse
- content that violates [Acceptable usage](./acceptable-usage.md)

Use the **Report skill** button on a skill page, or the package reporting
command/API for packages.

Do not use ClawHub reports for vulnerabilities in a third-party skill or
plugin's own source code. Report those directly to the publisher or source
repository linked from the listing. ClawHub does not maintain or patch
third-party skill or plugin code.

GitHub Security Advisories for `openclaw/clawhub` are for vulnerabilities in
ClawHub itself. Examples include bugs in the website, API, CLI, registry, auth,
scanning, moderation, or download/install trust boundaries. Do not use ClawHub
advisories for vulnerabilities in third-party skills or plugins.

Good reports are specific and actionable. Abuse of reporting can itself lead to
account action.

## Org and namespace claims

Org, brand, package-scope, owner-handle, or namespace ownership disputes should
use the [Org and Namespace Claims](./namespace-claims.md) process, not the
in-product report flow or the account appeal form.

Use that process when you need ClawHub staff to review non-sensitive proof that a
namespace should be reserved, transferred, renamed, hidden, quarantined, aliased,
or otherwise reviewed. Do not include secrets, private documents, private legal
files, personal identity documents, API tokens, or DNS challenge tokens in a
public issue.

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
Publisher abuse pressure signals are checked daily. Signals that reach
ClawHub's potential-ban threshold can trigger an automatic warning. If the next
eligible scan after the warning deadline still places the publisher in the
potential-ban threshold, ClawHub may apply the account action automatically.
Lower-confidence and bounded temporal review signals stay out of automatic
enforcement.

Deleted, banned, or disabled accounts cannot use ClawHub API tokens. If CLI auth
starts failing after account action, sign in to the web UI to review account
state. If sign-in or normal CLI access is blocked by a ban or disabled account,
use the [ClawHub appeal form](https://appeals.openclaw.ai/) for recovery review.

If a scanner-triggered email names a skill or plugin version as malicious,
download the stored scan results for the blocked submitted version:
`clawhub scan download <slug> --version <version>`. For plugins, add
`--kind plugin`. Review the scan output, fix the listing, increment the version
number, and upload the fixed version.

## Publisher guidance

To reduce false positives and improve user trust:

- keep names, summaries, tags, and changelogs accurate
- declare required environment variables and permissions
- avoid obfuscated install commands
- link to source when possible
- use dry runs before publishing plugins
- respond clearly if users or moderators ask about release behavior
