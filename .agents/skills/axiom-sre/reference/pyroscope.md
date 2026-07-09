# Pyroscope Reference

Query Grafana Pyroscope for continuous profiling data.

## Configuration

Configured via `~/.config/axiom-sre/config.toml`:

```toml
[pyroscope.deployments.prod]
url = "https://myorg.grafana.net"
token = "glsa_xxxx"  # API token for cloud

[pyroscope.deployments.internal]
url = "https://pyroscope.internal.example.com"
access_command = "cloudflared access curl"  # Custom auth wrapper

[pyroscope.deployments.cloudflare]
url = "https://pyroscope.cloudflare-protected.example.com"
cf_access_client_id = "abcd1234"
cf_access_client_secret = "efgh5678"
```

## Quick Start

```bash
# List available deployments
scripts/pyroscope-config

# List services with profiling data
scripts/pyroscope-services prod

# List available profile types
scripts/pyroscope-profiles prod

# Get CPU flame graph for a service (last 10 minutes)
scripts/pyroscope-flamegraph prod axiom-db

# Get flame graph with options
scripts/pyroscope-flamegraph prod axiom-db --range 30m --type memory

# Absolute time range (for incident investigation)
scripts/pyroscope-flamegraph prod axiom-db --start 2026-01-17T04:00:00Z --end 2026-01-17T06:00:00Z

# Raw JSON output
scripts/pyroscope-flamegraph prod axiom-db --range 10m --json

# Filter by additional labels (e.g., profile_id for debug profiles)
scripts/pyroscope-flamegraph prod axiom-db --label profile_id=debug-conor

# Compare baseline vs problem period
scripts/pyroscope-diff prod axiom-db -2h -1h -30m now

# Diff with label filter
scripts/pyroscope-diff prod axiom-db --label profile_id=debug-conor -2h -1h -30m now
```

## Integration with Axiom

When investigating performance issues found via Axiom logs:

1. **Identify the problem window** from Axiom latency/error queries
2. **Get flame graph** for that service and time range
3. **Compare** against a baseline period if regression suspected

```bash
# After finding high latency in axiom-db from 14:00-14:30 via axiom-query:
scripts/pyroscope-flamegraph prod axiom-db 30m

# Compare against earlier baseline (13:00-13:30 vs 14:00-14:30):
scripts/pyroscope-diff prod axiom-db -90m -60m -30m now
```

## Scripts

| Script | Usage |
|--------|-------|
| `scripts/pyroscope-config` | Show available deployments |
| `scripts/pyroscope-services <env>` | List services with profiling data |
| `scripts/pyroscope-profiles <env>` | List available profile types |
| `scripts/pyroscope-labels <env> [label] [--range]` | List label names or values |
| `scripts/pyroscope-flamegraph <env> <service> [options]` | Get flame graph |
| `scripts/pyroscope-diff <env> <service> [options] <times>` | Compare periods |
| `scripts/pyroscope-query <env> <endpoint> [json]` | Raw API queries |

## Profile Types

| ID | Use Case |
|----|----------|
| `process_cpu:cpu:nanoseconds:cpu:nanoseconds` | CPU hotspots, slow functions |
| `memory:inuse_space:bytes:space:bytes` | Memory leaks, high memory usage |
| `memory:alloc_space:bytes:space:bytes` | Allocation pressure, GC issues |
| `goroutine:goroutine:count:goroutine:count` | Goroutine leaks, deadlocks |
| `mutex:delay:nanoseconds:contentions:count` | Lock contention |
| `block:delay:nanoseconds:contentions:count` | Blocking operations |

## Common Workflows

### CPU Regression Investigation

```bash
# 1. Get current flame graph
scripts/pyroscope-flamegraph prod axiom-db 10m

# 2. Compare against yesterday (assuming same time of day)
scripts/pyroscope-diff prod axiom-db -25h -24h -1h now
```

### Memory Leak Investigation

```bash
# 1. Check current memory profile
scripts/pyroscope-flamegraph prod axiom-db 1h memory:inuse_space:bytes:space:bytes

# 2. Check allocation patterns
scripts/pyroscope-flamegraph prod axiom-db 1h memory:alloc_space:bytes:space:bytes
```

### Goroutine Leak Investigation

```bash
scripts/pyroscope-flamegraph prod axiom-db 30m goroutine:goroutine:count:goroutine:count
```

### Lock Contention Investigation

```bash
# Mutex contention
scripts/pyroscope-flamegraph prod axiom-db 10m mutex:delay:nanoseconds:contentions:count

# Block contention  
scripts/pyroscope-flamegraph prod axiom-db 10m block:delay:nanoseconds:contentions:count
```

## Raw API Access

For advanced queries, use `scripts/pyroscope-query`:

```bash
# Get label names
scripts/pyroscope-query prod LabelNames '{"start": 1700000000000, "end": 1700100000000}'

# Get time series
scripts/pyroscope-query prod SelectSeries '{
  "profileTypeID": "process_cpu:cpu:nanoseconds:cpu:nanoseconds",
  "labelSelector": "{service_name=\"axiom-db\"}",
  "start": 1700000000000,
  "end": 1700100000000,
  "step": 60.0,
  "groupBy": ["service_name"]
}'
```

## API Endpoints

All endpoints use gRPC-web via POST to `querier.v1.QuerierService/<Method>`:

| Endpoint | Description |
|----------|-------------|
| `ProfileTypes` | List available profile types |
| `LabelNames` | Get label names for filtering |
| `LabelValues` | Get values for a specific label |
| `Series` | Query series matching selectors |
| `SelectMergeStacktraces` | Get merged flame graph |
| `SelectSeries` | Get time series data |
| `Diff` | Compare two time ranges |
| `GetProfileStats` | Get ingestion statistics |

## Time Formats

- Scripts accept human-readable durations: `10m`, `1h`, `6h`, `24h`
- For diff: relative times like `-2h`, `-30m`, `now`, or ISO timestamps
- Raw API uses milliseconds since epoch

## Label Selectors

PromQL-style syntax:

```
{service_name="axiom-db"}
{service_name="axiom-db", namespace="production"}
{service_name=~"axiom-.*"}
```

## Authentication

Auth is configured per-deployment in `~/.config/axiom-sre/config.toml`. Three methods supported:

1. **API Token** (Grafana Cloud): `token = "glsa_xxxx"`
2. **Basic Auth**: `username` + `password`
3. **Access Command**: `access_command = "cloudflared access curl"` (tunneled access)

If using `access_command`, ensure you're logged in:

```bash
cloudflared access login https://your-pyroscope-host.example.com
```
