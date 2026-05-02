---
summary: "Staff runbook for ClawPack migration, moderation, retry, and revocation."
read_when:
  - Operating ClawPack backfills
  - Moderating plugin artifacts
  - Debugging failed package artifact builds
---

# ClawPack Operations

ClawPack operations are staff-only surfaces for migration, moderation,
artifact recovery, and revocation. They exist so operators do not have to edit
Convex documents manually.

Current management entry points:

```text
/management
/management/clawpacks
/management/moderation
/management/migrations
```

Unauthorized users should see the required role and their current auth state,
not a generic broken page.

## Roles

- moderators can review plugin risk and revoke ClawPack artifacts
- admins can run migration and backfill operations
- normal publishers can publish their own plugins but cannot mutate staff state

Live Convex mutations and deploys should be confirmed before running in a
shared or production deployment.

## ClawPack Ops Dashboard

Use:

```text
/management/clawpacks
```

The dashboard should answer:

- how many plugin releases exist
- how many have ClawPack artifacts
- how many are missing artifacts
- how many artifacts are revoked
- how many builds failed
- how many search index rows exist
- which sample rows need attention

Admin actions:

- preview migration candidates without writing
- create persistent migration runs
- execute one bounded batch at a time
- build missing ClawPack artifacts in bounded repair batches
- rebuild ClawPack host/environment index rows
- retry failed builds
- inspect failed release ids and reason codes

Every batch must be bounded and tied to a visible run record when the operation
is part of a coordinated migration. Avoid unbounded table scans and avoid any
operation that makes a partial migration silently look complete.

## CLI Admin Commands

Status:

```bash
clawhub package clawpack-admin status --json
```

Preview a coordinated migration:

```bash
clawhub package clawpack-admin dry-run --operation artifact-backfill --limit 25
```

Create and continue a durable run:

```bash
clawhub package clawpack-admin create-run --operation artifact-backfill --limit 25
clawhub package clawpack-admin continue-run <run-id>
```

List run history:

```bash
clawhub package clawpack-admin runs --status failed --json
```

Direct repair for missing artifacts:

```bash
clawhub package clawpack-admin backfill --limit 25
```

Direct search-index repair:

```bash
clawhub package clawpack-admin index-backfill --limit 100
```

Direct failure retry:

```bash
clawhub package clawpack-admin retry-failures --limit 25
```

Revoke an artifact:

```bash
clawhub package clawpack-admin revoke <name> <version> --reason "reason code or note"
```

Use `--json` for automation and audit capture. For production-sized work, prefer
`dry-run` -> `create-run` -> repeated `continue-run` over the direct repair
commands.

## Moderation Console

Use:

```text
/management/moderation
```

Moderators should see plugin releases by risk and operational state:

- pending review
- suspicious scan
- malicious scan
- missing ClawPack
- failed ClawPack build
- revoked
- official review
- metadata incomplete

The queue should show source facts, ClawPack digest, scan summaries, LLM/static
verdicts, VirusTotal status where present, and latest release state.

Destructive actions require a reason. Revocation reason should be visible to
staff and exposed safely through API responses where useful.

## Revocation

Revocation makes the stored artifact non-downloadable. It is separate from
package deletion and separate from hiding a package.

Revocation must update:

- artifact status
- release summary fields
- revocation timestamp
- revoking user id
- reason text

All ClawPack download paths must block revoked artifacts.

## Retry and Recovery

Retry is safe for transient storage/build failures and search index failures.
Retry is not a substitute for fixing publisher metadata. If validation failed
because metadata is incomplete or unsafe, ask the publisher for a corrected
release.

Operators should record:

- failed release id
- package name
- version
- failure code
- failure message
- retry count
- last attempted time

## Integrity Sampling

Integrity checks should compare:

- stored archive digest
- release summary digest
- artifact row digest
- generated manifest digest
- archive availability in Convex storage

Digest mismatch is a serious incident. Revoke first if public downloads could
serve corrupted or substituted artifacts, then rebuild from trusted source if
available.

## Production Safety

Before production operations:

1. Check current deployment health.
2. Dry-run or status-read first.
3. Use small bounded limits.
4. Capture command output.
5. Confirm before any write action.
6. Recheck status after the batch.

Do not run ClawPack migrations as a single unbounded backfill.
