# Download Metering

## Intent

Download metrics are collected without storing raw IP addresses and without
rewriting historical download counts.

New skill and package downloads use one shared metering path. The path records
one counted download per target, identity kind, identity hash, and UTC day.

## Committed Template download events

A newly counted package download for a public, undeleted Template schedules an
internal emitter in the same transaction as its existing `packageStatEvents`
insert. A rolled-back transaction therefore cannot emit a counted event. A
repeated download in the same target/identity/UTC-day bucket creates neither a
new stat nor a new scheduled emission. Counting paused before the stat mutation
runs leaves archive serving unchanged and creates neither; already committed
counts can still finish emitting after counting is paused.

The emitter reads the committed stat and rechecks that the package still exists,
is a Template, is not private, and is not soft-deleted. A queued event becomes a
no-op if those conditions no longer hold. Skill and non-Template package
downloads do not emit this event.

The log payload is an explicit eight-field allowlist: `event`
(`template_download_counted`), `schemaVersion` (`1`), `eventId` (the committed
package stat ID), `packageId`, `packageName`, `family` (`template`), `occurredAt`
(from the stat), and `dayStart` (the UTC dedupe bucket). Never include IPs, user
IDs, identity hashes, credentials, or other listing fields. This event is
recorded download telemetry, not an installation or unique-person count.

Delivery through the existing console log stream is best-effort, not exactly
once or guaranteed lossless. Retrying/replaying the emitter preserves
`eventId`; consumers must deduplicate that ID rather than count log lines.
Visibility suppression or missing logs can make observed events lower than
committed historical counters. Do not infer or backfill past events from those
counters. This adds no public telemetry endpoint, external scheduler, or new
counter pipeline.

## Identity Hashing

The identity hash input includes the identity kind:

```text
user:<user id>
ip:<client ip>
```

This keeps a user id and IP with the same visible string in separate hash
domains for dedupe and local diagnostics.

## Source-Attributed Counters

The dedupe table does not store user-vs-IP counters. It only gates whether a
download should emit the existing skill or package stat event. Public counters
for native ClawHub downloads still use the canonical skill download field:

```text
statsDownloads
```

Skills mirrored from skills.sh store the upstream lifetime install count
separately in `statsSkillsShInstalls`. Public skill Downloads remain scoped to
ClawHub artifact downloads:

```text
public Downloads:   statsDownloads
skills.sh installs: statsSkillsShInstalls (lifetime)
```

These values are never combined into one Downloads counter. Existing historical
ClawHub downloads remain intact, and canonical search gives lifetime downloads
and skills.sh lifetime installs zero ranking weight.

OpenClaw install telemetry remains in `statsInstallsCurrent` and
`statsInstallsAllTime`; it is not added to public Downloads. GitHub popularity
is stored in `statsGithubStars`. Existing `stars` rows and `statsStars` count
ClawHub Bookmarks and retain those storage/API names for compatibility.

Source refresh, adoption, content replacement, rollback, and GitHub
synchronization may update source metadata or newer observations, but must not
reset or rewrite any metric source. Publisher dashboards receive the attributed
source breakdown; ordinary public skill shapes expose ClawHub artifact downloads
as Downloads without manufacturing a cross-source total.

## Daily Package Graphs

Package graphs render the available `packageDailyStats` rows for the visible
30-day window and fill missing days with zero. Historical all-time counts are
not redistributed into daily rows, so the all-time total can exceed the sum of
the visible daily graph.

## Hosted archive streaming

When the Convex proxy rebuilds a zip from a signed archive manifest, the
download metric POST is best-effort. It must not be awaited on the path that
emits the first zip byte. A hung metric origin cannot stall the download.

A hosted skill archive is counted only after every declared entry has streamed
successfully and the ZIP completes. Missing storage URLs fail before signing;
storage failures during streaming abort the archive and do not emit a metric.
Cancellation before ZIP assembly completes does not emit a metric. The bounded
metric POST is registered with the request lifecycle so hosted execution can
finish it after the streamed response closes, without awaiting it on the ZIP path.

The metric capability retains its original 30-second lifetime. A healthy archive
can finish after that lifetime, but its best-effort metric is then rejected as
expired. Download completion never depends on metric acceptance; do not extend
the capability or reuse expired tokens to compensate for slow downloads.

Dashboard metrics require current publisher ownership. A personal publisher without
`linkedUserId` is accessible only when the authenticated active user's stored
`personalPublisherId` matches the requested publisher. Supplying the caller's ID
is not evidence of legacy ownership. A current `linkedUserId` takes precedence
over that legacy link, and organization access follows current membership.

## Native admin Template analytics

The authenticated admin dashboard, the new admin CLI downloads command, and
GET/POST /api/v1/admin/download-analytics share one native Convex report.
Session queries/mutations require a current active admin; HTTP uses existing
API-token authentication and rechecks the current actor role internally. No
ordinary user, moderator, anonymous caller, or caller-supplied identity can read
or refresh the report through a public API.

The rolling figure counts only download-kind packageStatEvents in the exact
[startedAt - 24 hours, startedAt) interval, including unprocessed events. Daily
buckets and completed-hour leaderboards cannot represent those boundaries.
Install/install_clear events and non-Template, private, deleted or missing
packages are excluded. Metering dedupe and its download hot path are unchanged.
Lifetime sums packages.stats.downloads over every eligible package, with no
leaderboard limit. It is not reconstructed from the seven-day retained event
window and does not rewrite existing counters or invent historical events.

A single replaceable downloadAnalyticsReports document holds the last completed
result and a bounded in-flight cursor. A 15-minute cron or authorized refresh
starts one build; concurrent refreshes coalesce, successful builds have a
one-minute manual-refresh cooldown, and revision/page checks make duplicate
scheduled delivery harmless. Each worker transaction scans one event page
(maximum ten events and at most ten distinct canonical package hydrations) or
one package page (100 rows, 1 MiB pagination read budget). Event hydration uses
canonical documents, avoiding reliance on digest backfill completeness. Package
pages have the same byte budget, so large documents can yield short pages.
There is no per-download report write, new aggregate component, migration,
unbounded in-memory package list, or on-demand table scan in an admin read.
The summary read is one indexed report lookup plus authentication.

Publish only after both scans complete; never expose partial sums as zeros or
completed totals. No report means pending with null numbers/timestamps. A
refresh failure/30-minute timeout preserves the previous completed report and
publishes a sanitized lastError; an absent baseline remains pending/null.
Consumers compare staleAfterAt (window end plus 30 minutes) and refreshExpiresAt
against their own clock; queries do not read wall time. countingPaused describes
the current emergency switch, not a claim that the historical window had no
pauses. Stored report/build state is overwritten, not retained as report history.

This is deliberately a **multi-page observation, not an atomic snapshot**.
Eligibility is current when each page hydrates a package; packages becoming
private/deleted after hydration can remain represented until a later refresh.
Late-arriving events and changes behind a cursor may only appear next time.
Lifetime counters are observed during the package scan, not frozen at the
event windowEndAt. Their existing 15-minute processing cadence/backlog plus
report cadence add lag, so the two figures need not reconcile at one timestamp.
Lifetime scope means all history of currently eligible listings; changes in
eligibility can reduce the scoped total. Counting pauses produce real gaps and
must not be backfilled from inferred traffic.

Completed reports expose eventsScanned, packagesScanned, eligiblePackages,
eligibilityReads and pages, and log those counters plus durationMs. Validate
these work counts and real Convex read bytes/latency before increasing page
sizes or introducing a heavier aggregation pipeline. Existing processed-event
cleanup keeps seven days after processing and does not delete unprocessed work.
