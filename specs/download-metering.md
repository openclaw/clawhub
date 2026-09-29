# Download Metering

## Intent

Download metrics are collected without storing raw IP addresses and without
rewriting historical download counts.

New skill and package downloads use one shared metering path. The path records
one counted download per target, identity kind, identity hash, and UTC day.

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
