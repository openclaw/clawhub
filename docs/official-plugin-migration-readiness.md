---
summary: "ClawHub-only readiness tracking for future OpenClaw bundled plugin externalization."
read_when:
  - Planning OpenClaw plugin externalization
  - Reviewing ClawPack migration readiness
  - Exporting operator status reports
---

# Official Plugin Migration Readiness

ClawHub can track whether bundled OpenClaw plugins are ready to become external
ClawHub-hosted packages. This tracker is informational and operational. It does
not mutate `openclaw/openclaw`, remove bundled plugins, or claim install support
before the downstream OpenClaw work exists.

Use:

```text
/management/migrations
```

CLI:

```bash
clawhub package clawpack-admin readiness --json
```

## Readiness Object

Each candidate should track:

- bundled plugin id
- desired ClawHub package name
- publisher or owner
- source repository
- source path
- source commit or ref
- current ClawHub package id
- latest release id and version
- ClawPack digest
- host matrix completeness
- environment metadata completeness
- scan state
- moderation state
- docs status
- runtime bundle decision
- API visibility
- blockers
- readiness decision

## Gates

A candidate is not ready until all gates are green:

- package exists
- latest release exists
- active ClawPack exists
- digest-addressed download works
- source repo, path, and commit are recorded
- host targets are complete
- environment metadata is complete
- scan is clean or manually approved
- moderation is approved
- docs link exists where required
- runtime bundle decision is recorded

Readiness should be conservative. Unknown is blocked.

## States

Use explicit states:

```text
planned
package-missing
release-missing
clawpack-missing
metadata-incomplete
scan-blocked
moderation-blocked
runtime-bundle-blocked
docs-blocked
ready-for-openclaw
```

Do not show `ready-for-openclaw` unless every required gate is satisfied.

## Operator Workflow

1. Open `/management/migrations`.
2. Review each candidate state.
3. Open the package or release links where available.
4. Fix ClawHub-side metadata, publishing, ClawPack, moderation, or docs gaps.
5. Export readiness for planning.
6. Use the export as input to future OpenClaw work.

The export is a planning artifact, not an OpenClaw change request by itself.

## What This Tracker Must Not Do

- edit `openclaw/openclaw`
- open OpenClaw pull requests
- remove bundled plugin code
- auto-publish packages without human-owned source attribution
- mark a candidate ready while ClawPack or moderation is missing
- hide blockers behind a single percentage score

## Suggested Blocker Codes

- `package-missing`
- `release-missing`
- `clawpack-missing`
- `digest-download-failed`
- `source-metadata-missing`
- `host-matrix-incomplete`
- `environment-metadata-incomplete`
- `scan-blocked`
- `moderation-blocked`
- `docs-missing`
- `runtime-decision-missing`

Blockers should include an owner or next action when known.
