# ClawHub Admin CLI

Private operator CLI for ClawHub platform moderation and staff-only package operations.

This package is intentionally marked `private: true`. Do not publish it to npm.
Run it from a checked-out ClawHub repo so maintainers always use the current
repo code.

`clawhub-admin` reuses the public CLI's auth, config, HTTP, and schema helpers,
but it is a separate maintainer command surface. Commands call the existing
RBAC-gated entity endpoints, such as `/api/v1/users/*` and `/api/v1/packages/*`;
there is no separate moderator API namespace.

## Run

From the repo root:

```bash
bun install
bun run admin -- --help
```

Example:

```bash
bun run admin -- skills unhide maxhub-pipixia --reason "VT false positive; reanalysis clean" --yes
```

## Build and Verify

```bash
bun run --cwd packages/clawhub-admin build
bun run --cwd packages/clawhub-admin verify
```

For full package coverage from the repo root:

```bash
bun run ci:packages
```

## Local E2E

Use an isolated config path so admin testing never overwrites your normal
`clawhub` CLI login:

```bash
export CLAWHUB_CONFIG_PATH=/tmp/clawhub-admin-local-config.json
```

Point `--registry` at the Convex HTTP actions URL, usually
`VITE_CONVEX_SITE_URL`, not the Vite frontend URL:

```bash
bun run admin -- --registry http://127.0.0.1:3211 login --token <local-token> --no-browser
bun run admin -- --registry http://127.0.0.1:3211 whoami
bun run admin -- --registry http://127.0.0.1:3211 plugins queue --json
```

For a fresh anonymous local Convex deployment in a disposable worktree:

```bash
CONVEX_AGENT_MODE=anonymous bunx convex dev --local --typecheck=disable
```

In another shell, seed the local role fixture and use the returned admin token
for admin commands:

```bash
CONVEX_AGENT_MODE=anonymous bunx convex run --no-push devSeed:seedCliRoleHelpFixtures
```

## Commands

Authentication uses the same ClawHub token/config path as the public CLI:

```bash
bun run admin -- login
bun run admin -- whoami
```

User administration:

```bash
bun run admin -- users ban <handleOrId> [--id] [--fuzzy] [--reason <text>] [--yes]
bun run admin -- users unban <handleOrId> [--id] [--fuzzy] [--reason <text>] [--yes]
bun run admin -- users lift-moderation-hold <handleOrId> --reason <text> [--id] [--fuzzy] [--yes] [--json]
bun run admin -- users set-role <handleOrId> <user|moderator|admin> [--id] [--fuzzy] [--yes]
bun run admin -- users reclassify-ban <handleOrId> --reason <text> [--id] [--fuzzy] [--dry-run|--apply] [--yes] [--json]
bun run admin -- users recover-publisher <handle> --to <handle> --previous-github-id <id> --next-github-id <id> --reason <text> [--retired-handle <handle>] [--verified] [--apply] [--yes] [--json]
```

Org publisher administration:

```bash
bun run admin -- org create <handle> --member <handle> [--display-name <name>] [--role owner|admin|publisher] [--trusted] [--json]
bun run admin -- org profile update <handle> [--bio <text>] [--logo-file <path>] --reason <text> [--yes] [--json]
```

`org create` requires `--member` and defaults that member to `owner`; it does
not add the admin running the command as an org member.
`org profile update` requires a bio, a PNG/JPEG/WebP logo under 2 MB, or both,
and records the supplied audit reason.

Publisher administration:

```bash
bun run admin -- publisher official list [--json]
bun run admin -- publisher official add <handle> --reason <text> [--yes] [--json]
bun run admin -- publisher official remove <handle> --reason <text> [--yes] [--json]
```

`org official ...` is retained as a compatibility alias for existing operator
scripts.

Package moderation and operations:

```bash
bun run admin -- skills reports [--status open|confirmed|dismissed|all]
bun run admin -- skills feature <slug|@owner/slug> [--json]
bun run admin -- skills unfeature <slug|@owner/slug> [--json]
bun run admin -- skills hard-delete @owner/slug --reason <text> [--apply --confirm <token> --yes] [--json]
bun run admin -- skills rescan <slug> [--version <version>] [--yes] [--json]
bun run admin -- skills unhide <slug> --reason <text> [--yes]
bun run admin -- skills triage-report <report-id> --status open|confirmed|dismissed [--note <text>] [--action none|hide] [--yes]

bun run admin -- plugins moderate <name> --version <version> --state approved|quarantined|revoked --reason <text>
bun run admin -- plugins feature <name> [--json]
bun run admin -- plugins unfeature <name> [--json]
bun run admin -- plugins rescan-all [--batch-size 10] [--max-packages <n>] [--cursor <cursor>] [--dry-run] [--poll-interval 30] [--fail-fast] [--yes] [--json]
bun run admin -- plugins status <name>
bun run admin -- plugins queue [--status open|blocked|manual|all]
bun run admin -- plugins reports [--status open|confirmed|dismissed|all]
bun run admin -- plugins triage-report <report-id> --status open|confirmed|dismissed [--note <text>] [--action none|quarantine|revoke] [--yes]

bun run admin -- packages validation-report --json > plugin-validation-report.json
bun run admin -- plugins migrations [--phase <phase>]
bun run admin -- plugins set-migration <bundled-plugin-id> --package <name>
bun run admin -- plugins hard-delete <name> --owner <handle> --reason <text> [--apply --confirm <token> --yes] [--json]
bun run admin -- plugins repair-name <name> --next-name <name> --reason <text> [--retire-target] [--owner <handle>] [--apply]
bun run admin -- plugins trusted-publisher get <name>
bun run admin -- plugins trusted-publisher set <name> --repository <owner/repo> --workflow-filename <file>
bun run admin -- plugins trusted-publisher delete <name>
```

All skill and plugin commands accept `--json` where the underlying endpoint supports machine-readable output.

`packages validation-report --json` exhaustively fetches the current validation state for every
plugin and writes exactly one JSON document to stdout. Redirect stdout to archive the report;
authentication, registry, and request failures are written to stderr by the CLI error handler.

`plugins rescan-all` (also `packages rescan-all`) requires an admin token. It
rescans each active code/bundle plugin's latest release, including releases with
existing successful scanner results. Deleted packages/releases, revoked releases,
non-plugin packages, and missing latest releases are skipped; historical releases
are never scanned. Existing queued/running jobs are preserved and awaited. New
jobs use the lowest-priority `bulk-rescan` source.

The CLI waits for each batch to finish before paging again. The default and
backend cap are 10 packages to keep large release records within transaction
limits. `--max-packages` bounds visited package rows, including skips; `--cursor`
resumes the reported next page. `--dry-run` reports would-queue counts without
creating jobs or batch audit entries. `--json` emits batch/status/summary events;
failed or missing jobs produce a nonzero exit, and `--fail-fast` stops after the
first failed batch drains.

### Local bulk scan assignments

`skills plan-scan-workers` prepares workflow inputs locally from **existing admitted
job IDs**, split across nine shared shards by default. `--shared-workers 18`
spreads them across eighteen machines independently of `--batch-limit`, which
controls concurrent scans on each machine. It does not admit scans, dispatch
workers, change capacity automatically, or store campaign state on the server.
Assigned shared workers use separate concurrency groups from ordinary queue
workers. The reserved priority shard keeps its existing group and normal queue.
When upgrading from a worker release that shared the ordinary groups, drain
assigned workers and pending assigned dispatches before switching releases.

```sh
bun run admin -- skills plan-scan-workers queued-job-ids.json --batch-limit 32 > worker-plan.json
# After validating the worker/backend release and the capacity probe:
jq '.inputs' worker-plan.json | gh workflow run security-scan-codex.yml --repo openclaw/clawhub --ref main --json
```

To compare machine fan-out without doubling total scan concurrency, compare
nine workers at `--batch-limit 64` with eighteen at `--batch-limit 32`.
Drain the old shared worker pool and stop pending old-pool dispatches before
changing the worker count: changing the pool changes job-to-shard ownership.
Keep admission receipts and queued IDs, then refresh status and generate the
new plan. Use the plan's complete `inputs` object with a matching worker release;
mismatched assignment and worker counts fail before any shared job is claimed.
The priority worker remains independent of bulk assignment validation.

The input is a JSON array of 1–10000 `securityScanJobs` IDs from saved admission
receipts. Refresh their status first using the admin batch-status API and collect
its `queuedJobIds` for the intended bulk skill campaign. Older servers omit this
field; wait for the backend release instead of assigning all tracked IDs. Running,
completed, failed and missing jobs must not occupy the bounded dispatch payload. The output contains workflow `inputs` and explicit `deferredJobIds` for jobs
that do not fit this dispatch. Keep these IDs in the local backlog for later
dispatches; never replace or discard them. A dispatch selects at most 1,728 IDs
in input order across the selected number of disjoint assignments (fewer if longer IDs reach the
workflow input payload limit),
with stable job-to-shard ownership across dispatches and at most 512 IDs per shard, and a twelve-minute claim window. An explicitly
empty shard stays empty; it never falls back to unrelated jobs. Without assignments,
the worker retains its usual queue behavior.

The local orchestrator owns the admission cursor, exact-version baselines and
hashes, receipts, dispatch history, capacity policy, and reconciliation. It must
save workflow inputs before dispatch and retain them if dispatch acknowledgement
is uncertain. Backend lease/status checks prevent duplicate active leases;
redispatching a stale plan cannot retry a permanent failure or create new jobs.
Automatic retries keep their existing IDs and become eligible in a later dispatch
once their normal retry delay expires. Keep the five-minute dispatch interval,
original scope exclusions and scanner settings; qualify capacity using actual
completed scans and raw claim errors, rather than treating assignment count as
throughput. A 32 setting is a probe, not a claim of qualified capacity.

### Search intelligence

Admins and moderators can read the same aggregate report as Management → Search
intelligence. This is read-only and does not change Featured or Trending.

```sh
clawhub-admin search-insights
clawhub-admin search-insights --source openclaw-control-ui --window 30 --official-gap
clawhub-admin search-insights --intent-kind company_product --json
clawhub-admin search-insights --end-day 2026-09-07 --limit 100 --json
clawhub-admin search-insights --view recommendations --artifact-kind plugin --json
clawhub-admin search-insights --view recommendations --artifact-kind skill --json
```

Windows contain complete UTC days before `--end-day` (exclusive; defaults to today).
Every response includes seven-day, previous-seven-day and 30-day counts. Source can
be `clawhub-web` or `openclaw-control-ui`; omit it to combine them. `--window 7|30`
selects ranking. `--intent-kind` accepts `company_product`, `generic_capability`, or
`ambiguous`; company opportunities require fresh weekly confidence of at least 80%
and three official-gap searches. Missing or failed classification is unavailable,
not inferred from package names. The data-through/coverage fields expose refresh
lag or lost coverage. Current package metadata is freshness-labeled separately.

Use `--artifact-kind plugin|skill` to select the catalog and `--scope catalog|shelf|legacy`
to distinguish whole-catalog searches, filtered shelves, and older observations whose
scope is unknown. Only whole-catalog searches qualify for company opportunities.

The recommendations view joins current search matches with the existing catalog's
Trending snapshot. It shows candidates supported by both signals, search only, or
adoption only; within those groups it orders by search counts and then existing
Trending rank. There is no new blended score or cross-catalog score comparison.
Counts are matched queries, not unique users or installs of the candidate. Search
filters affect demand evidence; adoption evidence remains the catalog-wide snapshot.
Gap and intent filters apply only to the demand view.

Adoption keeps its own exact period, generation time and original ranking. Package
Trending includes a partial current UTC day; native skill Trending uses completed
hours. Unknown source periods and unavailable metrics remain null. Both views expose
coverage limits and current metadata freshness. Candidate eligibility uses current
public releases and security status. Channels, model providers and agent runtimes
are excluded from plugin discovery using their canonical category; official and
community workflow tools remain eligible. Current Featured entries are reassessed;
external skills without a ClawHub Featured owner remain explicit exclusions.

Every iteration proposes the complete set of up to eight plugins and eight skills,
including retained selections, additions, removals, the current membership baseline,
and any unfilled places. Current Featured members are checked even outside the
inspected Trending/search cohort. Eligible members with no observed window evidence
are labeled `current-only` and can fill remaining places; their missing evidence
is not zero demand. An evidence-ranked replacement is not a safety finding.
The quality floor is never lowered to fill eight places. The Emerging label reuses
the public New tab's 14-day publication window with observed adoption, or the
existing skill Rising feed with adoption; it does not claim accelerating growth.

The weekly digest carries the same complete proposed membership. It shortens query
details and other sections before dropping any selected identity; an unrepresentable
selection fails explicitly. Publication remains a separate moderator action requiring
Patrick's approval. Publishing a newly Featured skill can trigger its existing
Featured notification; reading this report does not send it.

For the first production dry run, use these read-only commands or Management →
Search intelligence → Featured selection. Do not invoke delivery, backfill request
logs, or change Featured. Review usefulness, quality, security and category coverage
with Patrick before publishing a selection. An empty search window can still have
adoption candidates; missing evidence is never replaced with sample recommendations.
