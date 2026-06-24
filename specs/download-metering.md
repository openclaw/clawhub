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

## Counters

The dedupe table does not store user-vs-IP counters. It only gates whether a
download should emit the existing skill or package stat event. Public counters
still store one total:

```text
downloads
```

Existing historical counts are not estimated or rewritten in this phase.

## Daily Package Graph Rollout

Package daily rows start when the backend that writes `packageDailyStats` is
deployed. Production deploys are manual, so package graphs must not assume the
PR merge date is the first trustworthy daily-stat day.

Operators set the Convex env var `PACKAGE_DAILY_STATS_ROLLOUT_AT` to the actual
production backend rollout time, as an ISO timestamp or Unix epoch
milliseconds. Existing packages with all-time downloads or installs keep using
all-time metadata until the visible 30-day graph window starts on or after that
rollout time. If the env var is missing or invalid, those package daily graphs
stay hidden rather than showing an undercount.
