---
summary: "How to report ClawHub security issues and when vulnerabilities are publicly disclosed."
read_when:
  - Reporting a ClawHub security issue
  - Understanding ClawHub vulnerability disclosure
  - Distinguishing ClawHub platform issues from third-party skill or plugin issues
title: "Security"
sidebarTitle: "Security"
---

# Security

ClawHub security issues can be reported through GitHub Security Advisories for
`openclaw/clawhub`.

Use GitHub Security Advisories for vulnerabilities in ClawHub itself. Good
ClawHub advisory reports include bugs in:

- the ClawHub website, API, or CLI
- registry publishing, downloads, installs, or artifact integrity
- authentication, authorization, or API tokens
- scanning, moderation, or report handling

Do not use ClawHub advisories for vulnerabilities in a third-party skill or
plugin's own source code. Report those directly to the publisher or source
repository linked from the ClawHub listing.

## Vulnerability disclosure

Because ClawHub is a hosted cloud application, ClawHub service vulnerabilities
are not publicly disclosed by default. They are publicly disclosed when there is
evidence of real user impact or when users need to take action.

Examples of real user impact include confirmed exploitation, exposure of user
data or secrets, malicious content reaching users because of a platform failure,
or any issue that requires users to rotate credentials, update local software, or
take other protective action.

Vulnerabilities in user-installed software are publicly disclosed, such as
ClawHub CLI packages, binaries, libraries, or other release artifacts that users
need to update locally.

## Related pages

For install-time audit labels, risk levels, findings, and interpretation, see
[Security Audits](./security-audits.md).

For marketplace reports, moderation holds, hidden listings, bans, and account
standing, see [Moderation and Account Safety](./moderation.md).
