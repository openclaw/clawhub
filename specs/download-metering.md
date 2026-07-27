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

Skills mirrored from skills.sh store the upstream install count separately in
`statsSkillsShInstalls`. Public skill Downloads are computed at serialization:

```text
native skill:        statsDownloads
skills.sh indexed:   statsDownloads + statsSkillsShInstalls
```

The combined value is never written back into `statsDownloads`. Existing
historical ClawHub downloads remain intact, and search ranking continues to use
the native field.

OpenClaw install telemetry remains in `statsInstallsCurrent` and
`statsInstallsAllTime`; it is not added to public Downloads. GitHub popularity
is stored in `statsGithubStars`. Existing `stars` rows and `statsStars` count
ClawHub Bookmarks and retain those storage/API names for compatibility.

Source refresh, adoption, content replacement, and GitHub synchronization may
update source metadata or upstream counters, but must not reset or rewrite any
other metric source. Publisher dashboards receive the source breakdown while
ordinary public skill shapes expose only the combined Downloads value.

## Daily Package Graphs

Package graphs render the available `packageDailyStats` rows for the visible
30-day window and fill missing days with zero. Historical all-time counts are
not redistributed into daily rows, so the all-time total can exceed the sum of
the visible daily graph.
