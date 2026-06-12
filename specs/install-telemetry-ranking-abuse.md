# Install Telemetry, Ranking, and Abuse Signals

## Intent

Install counts are a display, search-ranking, browse-recommendation, and
abuse-review signal.

Skill search uses installs and stars as popularity inputs. Browse recommended
ranking uses the current weighted recommendation score. Downloads remain
visible and sortable.

## CLI Telemetry

`clawhub install` is the canonical install telemetry source. It sends one
best-effort event after a local install succeeds:

```text
{ event: "install", slug, version?, rootId?, rootLabel? }
```

Telemetry failures must not fail the local install command.

Install telemetry is deduped by user, skill, root id, and UTC day before it
touches root/install state. A duplicate same-day report for the same root is
ignored. A different root for the same skill is still recorded.

`clawhub sync` is a publishing/catalog workflow. It must not report install
telemetry, because a scanned local root is not proof of a fresh install.

The deprecated `/api/cli/telemetry/sync` route may remain as a compatibility
no-op for old clients and schema consumers. It must return a normal telemetry
success response for valid legacy roots-shaped payloads, but it must not update
install counters or root-install state.

The `/api/cli/telemetry/install` route is strict. It accepts only the explicit
install event shape and rejects legacy roots-shaped sync snapshots.

## Ranking

Search popularity boosts can use:

```text
stars
installsAllTime
```

Search popularity boosts must not use:

```text
downloads
installsCurrent
```

Call shapes that still include download fields for compatibility should ignore
those fields when ranking.
