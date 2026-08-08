---
name: query-metrics
description: Runs metrics queries against Axiom MetricsDB via scripts. Discovers available metrics, tags, and tag values. Use when asked to query metrics, explore metric datasets, check metric values, or investigate OTel metrics data.
---

# Querying Axiom Metrics

All script paths are relative to this skill's folder; invoke as `scripts/<name>`. The target dataset must be of kind `otel:metrics:v1`.

Setup, prerequisites, and `~/.axiom.toml` configuration: see `README.md`. Edge-deployment routing is automatic — the scripts read each dataset's `edgeDeployment` and route to the right regional endpoint without configuration.

## Workflow

1. `scripts/datasets <deploy> --kind otel:metrics:v1` — list metrics datasets.
2. `scripts/metrics-spec` — **required** before composing any query. MPL evolves; the spec is the source of truth. Also use it to answer general MPL/metrics questions.
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
- **Histogram** — not a scalar. `align using avg` produces nonsense. Use `bucket … using` with the histogram functions from `metrics-spec`; quantiles are float specs to those functions, and `temporality` selects the variant (`Cumulative` vs `Delta` interpolation). Consult `metrics-spec` for the exact signatures.
- **`temporality: null`** — "not applicable for this instrument type" (the norm for Gauges), not "missing data".

When surfacing numbers, attach the `unit` (treat `null` as unitless). If you combine metrics with mismatched units in arithmetic, warn rather than silently producing a meaningless number.

## Query Metrics

```bash
scripts/metrics-query [-w pixels] [--pixel-per-point n] <deploy> '<MPL>' <start> <end>
```

| Parameter | Notes |
|---|---|
| `deploy` | Name from `~/.axiom.toml` (e.g. `prod`). |
| `MPL` | Pipeline string. Dataset is parsed from the MPL itself. |
| `start` / `end` | RFC3339 (`2025-01-01T00:00:00Z`) or relative (`now-1h`, `now`). |
| `-w` / `--chart-width <px>` | Optional. Target chart width in pixels; lets the server resolve `$__interval`. |
| `--pixel-per-point <n>` | Optional. Pixels per point (server default 10); with `-w` sets the bucket count. |

**Always single-quote the MPL string in the shell.** MPL is full of backticks; inside double quotes the shell executes them as command substitution, silently mangling the query (or running whatever the identifier names).

**Bound the output before grouping.** `group by <tag>` returns one series per tag value with no cap — on a high-cardinality tag this floods the output. Check cardinality first (`describe`, or `tags <tag> values`) and prefer plain `group using <agg>` while exploring.

Examples:

```bash
scripts/metrics-query prod -w 1200 \
  '`my-dataset`:`http.server.duration` | align to $__interval using avg' \
  now-1h now

scripts/metrics-query prod -w 1200 \
  '`my-dataset`:`http.server.duration`
   | where `service.name` == "frontend" and method == "GET"
   | align to $__interval using avg
   | group by status_code using sum' \
  now-1d now
```

### Adaptive resolution (`$__interval`)

Hardcoding a step (`align to 5m`) makes charts look wrong at other zoom
levels — too sparse zoomed in, too dense zoomed out. Prefer the system
parameter `$__interval` wherever a `Duration` is expected, and pass the chart
width so the server picks the step:

```bash
scripts/metrics-query prod -w 1200 \
  '`my-dataset`:`http.server.duration` | align to $__interval using avg' \
  now-7d now
```

The metrics service computes `$__interval` from the query's time range and the
target chart width, then snaps it **up** to a nice resolution from the ladder
`1s, 5s, 10s, 15s, 30s, 1m, 5m, 10m, 15m, 30m, 1h, 12h, 1d, 1w, 1M, 1Y`. It
never drops below a metric's stored resolution.

- **No declaration needed** — the server auto-registers `$__interval`; do *not*
  add `param $__interval: Duration;` (the edge forwards the query verbatim and
  the metrics service injects the parameter).
- **Bucket count** ≈ `chart-width / pixel-per-point` (`pixel-per-point` default
  10). Omit `-w` and the server targets ~500 buckets.
- Works anywhere a `Duration` is valid, e.g. `bucket to $__interval using
  histogram(0.5, 0.95)`.
- Set `-w` to your render width (e.g. the `metrics-chart` skill's plot width)
  so one bucket ≈ one pixel column. The value is forwarded under the request
  body's `queryOptions` (`chart-width`, `pixel-per-point`).

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

Time range defaults to the last 24h; override with `--start` / `--end`. Both accept RFC3339 (offsets allowed) or relative `now` / `now-<N><unit>` with `<unit>` in `s m h d w`, resolved to RFC3339 UTC client-side. This is **narrower** than `metrics-query`, which forwards times to the server unparsed and so also accepts forms like `now-1y`; in `metrics-info` anything outside `now` / `now-<N>[smhdw]` must already be RFC3339 or the request 400s.

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

HTTP errors return JSON with `code` and `message`; some include a `detail` object:

```json
{"code": 400, "message": "MPL syntax error: …"}
```

Syntax errors (400) include an annotated source pointer listing the valid operators at the failure position — read it, it usually names the fix.

| Code | Cause |
|---|---|
| 400 | Invalid query syntax or bad dataset name |
| 401 | Missing/invalid auth |
| 403 | No permission |
| 404 | Dataset not found |
| 429 | Rate limited — back off and retry; don't tight-loop |
| 500 | Internal error |

Requests time out client-side after 120s (`AXIOM_MAX_TIME` to override; `AXIOM_CONNECT_TIMEOUT` for the 10s connect timeout).

On 500, re-run with `curl -v` to capture the `traceparent` / `x-axiom-trace-id` header and report it — the trace ID is what the backend team needs to debug.

## Scripts

| Script | Usage |
|---|---|
| `scripts/setup` | Check requirements and config. |
| `scripts/datasets <deploy> [--kind <kind>]` | List datasets with edge deployment. |
| `scripts/metrics-spec` | Fetch the MPL query spec. |
| `scripts/metrics-query [-w px] [--pixel-per-point n] <deploy> <mpl> <start> <end>` | Execute a query; use `$__interval` + `-w` for adaptive resolution. |
| `scripts/metrics-info <deploy> <dataset> ...` | Discover metrics, tags, values. |
| `scripts/axiom-api <deploy> <method> <path> [body]` | Low-level API calls. |
| `scripts/resolve-url <deploy> <dataset>` | Resolve to the edge deployment URL. |

Run any script without arguments for full usage.
