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

## Daily Package Graphs

Package graphs render the available `packageDailyStats` rows for the visible
30-day window and fill missing days with zero. Historical all-time counts are
not redistributed into daily rows, so the all-time total can exceed the sum of
the visible daily graph.
