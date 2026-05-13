# Package Dry-Run Scans

Package dry-run scans let ClawHub admins test security scanner changes against
stored plugin releases before any result is promoted into normal moderation
state.

## Invariants

- Dry-run scans are admin-only. API tokens and Convex entrypoints must verify
  the actor is an admin before creating or reading jobs.
- Dry-run scans are read-only with respect to package moderation. They must not
  patch `packageReleases.staticScan`, package `scanStatus`, moderation queue
  state, or rescan request state.
- Jobs and results live in `packageDryRunScanJobs` and
  `packageDryRunScanResults`; they are operational evidence, not publisher or
  user-visible package state.
- Results are retained for 14 days. Pruning only deletes terminal jobs
  (`completed` or `failed`) and their result rows.
- Selectors must be explicit. `allActive` intentionally has no size limit, so
  CLI and HTTP callers must reject unused sizing fields instead of silently
  ignoring them.
- Seeded samples must be deterministic for the same release set, seed, limit,
  and candidate limit.
- Workers must use leases and claim tokens so stale attempts cannot complete,
  skip, or fail a result after another worker has requeued or claimed it.
- Scanner input reads are bounded by per-file and per-release byte caps.
- Filesystem evidence is heuristic static evidence. It is intended to find
  raw `fs` and `fs-safe` usage patterns for migration analysis, not to be an
  AST-complete security verdict.

## Operator Surface

`clawhub-mod plugins dry-run-scan` supports:

- `start`: create a job for explicit releases, package names, latest active
  releases, all active releases, or a deterministic seeded sample.
- `status`: read job counters and selector metadata.
- `watch`: poll status until terminal.
- `export`: export one JSON result page with `nextCursor`, or stream all result
  rows as JSONL.

`latestActive` and `seededSample` candidate selection use active package
`latestReleaseId` releases, not older active versions. `allActive` is the broad
operator sweep and can include all active plugin releases. JSON exports include
both pagination completion (`done`) and job completion metadata (`jobStatus`,
`jobDone`, `partial`) so partial exports, including failed broad-selection jobs
that did not finish target selection, cannot be mistaken for complete runs.

These commands are for admin validation runs only. They are not a replacement
for publish `--dry-run`, which previews a single upload before storage.
