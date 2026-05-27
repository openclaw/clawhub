---
summary: "Trust-boundary contract for the plugin verification evidence endpoint."
audience:
  - Reviewing plugin trust API changes
  - Building ClawHub plugin install or review clients
---

# Plugin Verify

`GET /api/v1/plugins/{name}/verify` returns version-scoped evidence for a
ClawHub plugin release. It is a machine-readable evidence envelope, not an
endorsement program and not a replacement for moderation, official publisher
status, or future vetted-community review.

The endpoint exists so clients and reviewers can inspect one stable evidence
surface before deciding what trust UX or review path should apply to a plugin.

## Trust Semantics

`ok: true` means all of the following are true for the selected plugin release:

- the release is not blocked from download by package or release trust checks
- the effective ClawScan status is `clean`
- the release trust summary is not stale

`ok: true` does not mean:

- the plugin is official
- the plugin is endorsed by OpenClaw maintainers
- the plugin has passed a manual vetted-community review
- the plugin is safe for every deployment or threat model

Community plugin releases that pass the evidence checks still return
`review.status: "unreviewed-community"` unless the package is already official.
Future vetted-community or trust-card work must add a separate review signal
rather than reusing `ok` as an endorsement badge.

## Evidence Included

The response may include:

- package and publisher identity
- selected version and resolution source
- artifact hashes and file inventory
- source-linked package metadata
- package provenance and trusted publisher metadata when available
- compatibility and capability metadata
- compact ClawScan, static analysis, VirusTotal, and SkillSpector status
- moderation/download block state and reason codes

The endpoint intentionally returns status-level scanner evidence. Detailed
scanner payloads remain on the package version, security audit, and install
trust endpoints that already expose those surfaces.

## Version Scope

Verification is version-scoped. Callers can request a specific `version`, a
`tag`, or the latest release. Clients should display the resolved version and
must not apply a clean result from one release to a different release.

## Security Boundary

This endpoint is public because it only aggregates information already suitable
for public install and review decisions. It must not expose private moderation
notes, private reporter identity, private scanner thresholds, API tokens, or
unredacted secrets.

Changes that alter `ok`, `decision`, `reasons`, or `review.status` semantics
are security-sensitive because install clients may automate on those fields.
