# ClawHub Scan Command Design

- Date: 2026-06-03
- Status: Approved for implementation
- Scope: authenticated ClawScan job API, public CLI scan command, admin CLI rescan routing, and scan report export shape

## Problem

ClawHub runs ClawScan for published artifacts, but users do not have a first-class way to ask ClawHub to scan a local skill bundle before publishing. The existing `skill verify` command is read-only: it checks stored verification state for a published skill version and does not create fresh scan results.

Publishers and power users need a command like:

```sh
clawhub scan <path>
```

The command should upload a local skill bundle, run ClawHub's scan pipeline, wait until results are ready, print the results in the terminal, and optionally save the full scan report to a file. It should also support fresh scans of already-published skills, with strict ownership checks and an explicit update mode.

## Goals

1. Add `clawhub scan` as a power-user and publisher command.
2. Support ephemeral local skill scans for any authenticated user.
3. Support owner-only published-skill scans.
4. Keep local uploads ephemeral. They must not create or update public registry state.
5. Let published-skill scans run read-only by default and update stored ClawScan state only with an explicit `--update`.
6. Use submit-and-poll behavior so the CLI feels synchronous without holding one long HTTP request open.
7. Reuse the security-audit download shape: `manifest.json`, `clawscan.json`, `skillspector.json`, `static-analysis.json`, `virustotal.json`, and `README.md`.
8. Update `clawhub-admin` to use the canonical scan API for staff rescans while preserving moderator/admin semantics.
9. Update schema and docs so the scan API routes are canonical and the older rescan routes are either compatibility aliases or clearly deprecated.

## Non-Goals

1. No anonymous scans.
2. No scanning of unpublished plugin packages in this slice; start with skill bundles.
3. No automatic publish after a clean local scan.
4. No local writes for ephemeral scans other than optional CLI output files.
5. No change to `clawhub skill verify`; it remains a read-only stored-state verification command.

## API Direction

Use a canonical scan job group:

```txt
POST /api/v1/skills/-/scan
GET  /api/v1/skills/-/scan/{scanId}
GET  /api/v1/skills/-/scan/{scanId}/download
```

`POST /api/v1/skills/-/scan` creates a scan job and returns a `scanId`. The caller then polls the status endpoint until the scan reaches a terminal state.

### Submit Modes

Local ephemeral scan:

```json
{
  "source": { "kind": "upload" },
  "update": false
}
```

This request is multipart. The payload carries the JSON metadata, and file parts carry the local skill bundle files.

Published skill scan:

```json
{
  "source": { "kind": "published", "slug": "demo", "version": "1.2.3" },
  "update": false
}
```

Published skill update scan:

```json
{
  "source": { "kind": "published", "slug": "demo", "version": "1.2.3" },
  "update": true
}
```

If `version` is omitted for a published scan, the backend scans the latest version.

### Authorization

All scan endpoints require a valid API token.

Local upload scans:

- allowed for any authenticated account in good standing
- always ephemeral
- cannot set `update: true`
- do not write skill, version, moderation, or public security state

Published skill scans:

- allowed only for the skill owner or a publisher member with management rights
- `update: false` runs a fresh scan and returns the result without writing it back
- `update: true` writes the final ClawScan result back to the selected published version
- moderators/admins may use the same backend through `clawhub-admin`, preserving the existing operator capability

### Existing Route Cleanup

The current `POST /api/v1/skills/{slug}/rescan` route should move behind the canonical scan API. For compatibility, it can remain as an alias that submits a published scan with `update: true`.

The current admin batch routes:

```txt
POST /api/v1/skills/-/rescan-batch
POST /api/v1/skills/-/rescan-batch/status
```

should move to scan group routes:

```txt
POST /api/v1/skills/-/scan/batch
POST /api/v1/skills/-/scan/batch/status
```

The existing `GET /api/v1/skills/{slug}/scan` route currently reads stored scan details. Because this name conflicts with new scan-job creation, keep it as a legacy detail route for now and document the distinction. A later API cleanup can rename stored details to a security-audit route.

## CLI Direction

Add a top-level public CLI command:

```sh
clawhub scan <path>
clawhub scan <path> --output report.zip
clawhub scan --slug demo
clawhub scan --slug demo --version 1.2.3
clawhub scan --slug demo --update
clawhub scan --slug demo --output report.zip
```

Rules:

- Exactly one scan source is required: either `<path>` or `--slug`.
- `<path>` must resolve to a local skill folder containing `SKILL.md` or `skill.md`.
- `--update` is valid only with `--slug`.
- `--output <file.zip>` writes the report ZIP to that exact file path.
- The default terminal output should be a full report, similar to the security-audit UI, not a terse pass/fail summary.
- `--json` should print the terminal report data as JSON for automation. It does not replace `--output`, which always writes the ZIP report.

## Terminal Report

The terminal report should mirror the security audit UI enough that a publisher can make the same judgment from the CLI:

1. artifact identity and scan metadata
2. ClawScan verdict, confidence, summary, guidance, and findings
3. agentic risk buckets and concrete evidence when available
4. SkillSpector status, score/severity, issue count, and issues
5. static analysis status, reason codes, summary, and findings
6. VirusTotal telemetry, including engine counts when present
7. update/writeback status for published scans

The CLI should exit non-zero for failed scan jobs. A clean, suspicious, or malicious completed scan is still a successful command execution; policy interpretation belongs in the printed result and JSON.

## Report ZIP

Reuse the security-audit Download button archive shape:

```txt
manifest.json
clawscan.json
skillspector.json
static-analysis.json
virustotal.json
README.md
```

The ZIP should be available through `GET /api/v1/skills/-/scan/{scanId}/download` and should match the bytes written by `clawhub scan --output <file.zip>`.

`manifest.json` should include:

- scan id
- source kind
- update mode
- artifact identity
- user-facing timestamps
- terminal status
- whether the scan result was written back

## Backend Shape

The existing ClawScan worker is currently built around stored `securityScanJobs` that target published skill versions or package releases. This feature needs a scan-job abstraction that can also represent ephemeral uploaded skills.

Recommended implementation:

1. Add a persisted scan request/job record for user-submitted scans.
2. Store uploaded local files in Convex storage with ownership and expiry metadata.
3. Materialize ephemeral jobs into the same worker workspace shape used by published scans.
4. Store final scan result payloads on the scan job record.
5. For published `update: true`, also patch the selected version through the existing ClawScan result update path.
6. Expire or clean up ephemeral uploaded files and completed ephemeral scan records after a bounded retention window.

This keeps worker behavior shared while preventing local uploads from leaking into public artifact state.

## Admin CLI

Update `clawhub-admin skills rescan <slug>` to call the canonical scan API in published update mode, using moderator/admin authorization. Keep its existing prompt, `--version`, `--yes`, and `--json` behavior.

Update `clawhub-admin skills rescan-all` to call the new canonical batch route. Tests should prove the admin CLI uses the canonical route.

## Tests

Backend tests should cover:

1. local upload scan requires auth
2. local upload scan rejects `update: true`
3. published scan rejects non-owners
4. published scan allows owners
5. moderator/admin path allows operator rescans
6. polling returns queued/running/complete/failed states
7. download endpoint returns the expected ZIP entries
8. `update: true` writes back only for published scans
9. `update: false` does not mutate published version scan fields

CLI tests should cover:

1. `clawhub scan <path>` uploads multipart and polls
2. `clawhub scan --slug demo` submits read-only published scans
3. `clawhub scan --slug demo --update` sends update mode
4. `--output report.zip` writes the downloaded ZIP bytes
5. invalid combinations fail clearly
6. `clawhub-admin skills rescan` uses the canonical route

## Rollout Notes

This is a behavior and API change, so update:

- `packages/schema`
- `packages/clawhub`
- `packages/clawhub-admin`
- `docs/cli.md`
- `docs/http-api.md`
- `specs/security-moderation.md`

Keep the first implementation narrowly skill-focused. Plugin/package scan support can reuse the same scan-job API later once the skill path is stable.
