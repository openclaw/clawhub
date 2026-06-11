# Install Telemetry, Ranking, and Abuse Signals

## Intent

Install counts are a display, ranking, and abuse-review signal.

Installs and stars are the popularity inputs for search/recommended ranking.
Downloads remain visible and sortable, but they must not make a skill rank
higher in default public discovery.

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

## CLI Compatibility

A bare logged-in `clawhub` invocation remains a sync shortcut for existing
users and automation. Users without a stored token get help output.

`sync --bump` accepts only `patch`, `minor`, or `major`, and should reject
invalid values before scanning local roots.

## Ranking

Search and recommended popularity boosts can use:

```text
stars
installsAllTime
```

They must not use:

```text
downloads
installsCurrent
```

Call shapes that still include download fields for compatibility should ignore
those fields when ranking.

## Publisher Abuse

Publisher abuse scoring is a staff review signal. It must not directly hide,
ban, or remove publishers.

Official org publishers are excluded from publisher abuse scoring. They must
not contribute to cohort statistics, receive a publisher abuse score, create or
update abuse nominations, appear in abuse dashboard state, or be actionable
through stale nomination ids.

Temporal abuse scoring watches both sides of install/download behavior:

- high downloads with flat installs can indicate artificial download inflation
  or non-install traffic;
- high-volume installs tracking downloads too closely can indicate artificial
  conversion behavior.

Close install/download ratio signals must be gated by enough volume. Low-volume
ratios are too noisy to be useful.
