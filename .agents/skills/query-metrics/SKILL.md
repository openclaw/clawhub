---
name: query-metrics
description: Runs metrics queries against Axiom MetricsDB via scripts. Discovers available metrics, tags, and tag values. Use when asked to query metrics, explore metric datasets, check metric values, or investigate OTel metrics data.
---

# Querying Axiom Metrics

All script paths are relative to this skill's folder; invoke as `scripts/<name>`. The target dataset must be of kind `otel:metrics:v1`.

Setup, prerequisites, and `~/.axiom.toml` configuration: see `README.md`. Edge-deployment routing is automatic — the scripts read each dataset's `edgeDeployment` and route to the right regional endpoint without configuration.

## Workflow

1. `scripts/datasets <deploy> --kind otel:metrics:v1` — list metrics datasets.
2. `scripts/metrics-spec <deploy> <dataset>` — **required** before composing any query. MPL evolves; the spec is the source of truth.
3. `scripts/metrics-info <deploy> <dataset> metrics` — list metrics with `{type, temporality, unit}` metadata. Read this before writing the query (see [Choosing a Query Shape](#choosing-a-query-shape)).
4. `scripts/metrics-info <deploy> <dataset> tags [<tag> values]` — explore filter dimensions.
5. `scripts/metrics-query <deploy> '<MPL>' <start> <end>` — execute. Iterate.

If the user names a specific entity (service, host, …), `scripts/metrics-info <deploy> <dataset> find-metrics "<value>"` finds the metrics carrying it. `find-metrics` searches **tag values**, not metric names — don't use it for general discovery.

## Choosing a Query Shape

The `metrics-info` listing returns each metric's `{type, temporality, unit}`. Read these before composing — never assume a metric is a simple scalar.

| Field | Values | Drives |
|---|---|---|
| `type` | `Gauge`, `CounterMonotonic`, `CounterNonMonotonic`, `Histogram` | Required pre-aggregation operators. |
| `temporality` | `Cumulative`, `Delta`, `null` | Whether counter values are running totals or per-interval deltas. `null` is normal for Gauges. |
| `unit` | UCUM string (`Cel`, `kW.h`, `s`, `%`, `[ppm]`, …) or `null` | Display unit; preserve when reporting results. |

Rules per type (consult `metrics-spec` for exact operator names — they evolve):

- **Gauge** — instantaneous value. Align directly with `avg`/`min`/`max`/`sum`. Don't apply a rate; you'd be averaging meaningless deltas of an instantaneous value.
- **CounterMonotonic + Cumulative** — running total (resets aside). The raw values are rarely what you want. Convert to a per-second rate first, **then** align/aggregate.
- **CounterMonotonic + Delta** — already per-interval. Sum/align without a rate step.
- **CounterNonMonotonic** — can go up or down (queue depth, balance). Intent is ambiguous: rate, delta, or current value all make sense for different questions. **Ask the user** before picking one.
- **Histogram** — not a scalar. `align using avg` produces nonsense. Use the bucket/quantile operators from `metrics-spec`.
- **`temporality: null`** — "not applicable for this instrument type" (the norm for Gauges), not "missing data".

When surfacing numbers, attach the `unit` (treat `null` as unitless). If you combine metrics with mismatched units in arithmetic, warn rather than silently producing a meaningless number.

## Query Metrics

```bash
scripts/metrics-query <deploy> '<MPL>' <start> <end>
```

| Parameter | Notes |
|---|---|
| `deploy` | Name from `~/.axiom.toml` (e.g. `prod`). |
| `MPL` | Pipeline string. Dataset is parsed from the MPL itself. |
| `start` / `end` | RFC3339 (`2025-01-01T00:00:00Z`) or relative (`now-1h`, `now`). |

Examples:

```bash
scripts/metrics-query prod \
  '`my-dataset`:`http.server.duration` | align to 5m using avg' \
  now-1h now

scripts/metrics-query prod \
  '`my-dataset`:`http.server.duration`
   | where `service.name` == "frontend" and method == "GET"
   | align to 5m using avg
   | group by status_code using sum' \
  now-1d now
```

### Parameters

MPL can declare parameters (`param $svc: string;`). Pass values with repeated `-p name=value`. The script applies the API's `param__` prefix; values are forwarded verbatim as MPL literals (string literals include their quotes).

```bash
scripts/metrics-query \
  -p svc='"frontend"' \
  -p window='5m' \
  prod \
  'param $svc: string; param $window: Duration;
   `otel-metrics`:`http.server.duration` | where `service.name` == $svc | align to $window using avg' \
  now-1h now
```

Required parameters must be supplied; optional ones may be omitted. Resulting request body shape:

```json
{
  "apl": "param $svc: string; …",
  "startTime": "now-1h",
  "endTime": "now",
  "params": { "param__svc": "\"frontend\"", "param__window": "5m" }
}
```

Literal syntax per type lives in `metrics-spec`.

## Discovery (`metrics-info`)

Time range defaults to the last 24h; override with `--start` / `--end`.

| Command | Returns |
|---|---|
| `metrics-info <d> <ds> metrics` | All metrics, keyed by name, with `{type, temporality, unit}`. |
| `metrics-info <d> <ds> metrics --by-type` | Same listing grouped by `type` (client-side reshape). |
| `metrics-info <d> <ds> metrics --type Gauge --type Histogram` | Filtered listing (repeatable, OR semantics; composes with `--by-type`). |
| `metrics-info <d> <ds> metrics <metric> info` | Single metric's `{type, temporality, unit}`. Non-zero exit if absent. |
| `metrics-info <d> <ds> metrics <metric> describe` | Bundle: metadata + all tags + tag values in one call (replaces 1+1+N round trips). Flags: `--no-values` (tag names only), `--values-limit N` (cap per-tag values; default 50, 0 = unlimited). |
| `metrics-info <d> <ds> metrics <metric> tags` | Tags carried by a specific metric. |
| `metrics-info <d> <ds> metrics <metric> tags <tag> values` | Tag values for that metric. |
| `metrics-info <d> <ds> metrics <metric> tags <tag> type` | Probe whether the tag is `int`/`float`/`string`/`bool`. Returns `{type, present_types}`; `mixed` if multiple types coexist, `absent` if not present. |
| `metrics-info <d> <ds> tags` | All tags in the dataset. |
| `metrics-info <d> <ds> tags <tag> values` | All values for a tag (across metrics). |
| `metrics-info <d> <ds> find-metrics "<value>"` | Metrics that carry the given tag *value* (not metric name). |

## Error Handling

HTTP errors return JSON with `message`, `code`, and optional `detail`:

```json
{"message": "...", "code": 400, "detail": {"errorType": 1, "message": "raw error"}}
```

| Code | Cause |
|---|---|
| 400 | Invalid query syntax or bad dataset name |
| 401 | Missing/invalid auth |
| 403 | No permission |
| 404 | Dataset not found |
| 429 | Rate limited |
| 500 | Internal error |

On 500, re-run with `curl -v` to capture the `traceparent` / `x-axiom-trace-id` header and report it — the trace ID is what the backend team needs to debug.

## Scripts

| Script | Usage |
|---|---|
| `scripts/setup` | Check requirements and config. |
| `scripts/datasets <deploy> [--kind <kind>]` | List datasets with edge deployment. |
| `scripts/metrics-spec <deploy> <dataset>` | Fetch the MPL query spec. |
| `scripts/metrics-query <deploy> <mpl> <start> <end>` | Execute a query. |
| `scripts/metrics-info <deploy> <dataset> ...` | Discover metrics, tags, values. |
| `scripts/axiom-api <deploy> <method> <path> [body]` | Low-level API calls. |
| `scripts/resolve-url <deploy> <dataset>` | Resolve to the edge deployment URL. |

Run any script without arguments for full usage.
