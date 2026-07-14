# Metrics/MPL Chart Contract

Reference for metrics-backed chart queries. Authoring through `chart-add --mpl '<MPL>' --dataset <name>` handles the JSON-shape rules (sets both `query.apl` and `query.metricsDataset`); the rest of this file covers the **MPL pipeline** and **unit handling** that the agent still owns.

## JSON Shape

```json
{
  "type": "TimeSeries",
  "query": {
    "apl": "`otel-metrics`:`http.server.duration`\n| where `service.name` == \"api\"\n| align to $__interval using avg\n| group by `service.name` using avg",
    "metricsDataset": "otel-metrics"
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `query.apl` | Yes | The MPL pipeline. Same field name as APL queries. |
| `query.metricsDataset` | Yes | The discriminator that flags MPL. Without it the backend treats `apl` as APL. |
| `query.mpl` | — | Rejected on create. GET returns it on existing UI-authored charts; ignore. |
| `query.metricsMetric`, `metricsFilter`, `metricsTransformations` | — | UI/editor metadata. Not needed for hand-authored or `chart-add` output. |

## Authoring Checklist

1. Confirm dataset kind is `otel:metrics:v1`: `scripts/metrics/datasets <deploy>`.
2. Run `scripts/metrics/metrics-spec <deploy> <dataset>` — required before composing any MPL query.
3. Discover metrics and tags: `scripts/metrics/metrics-info`. Empty results → retry with `--start` 7 days ago.
4. Read each metric's `{type, temporality, unit}` via `metrics-info … metrics <m> info`. Drives query shape (below) and unit configuration.
5. Use `align to $__interval using …`, never a fixed window. The runtime injects `param $__interval: Duration;`; don't add it to the chart string.
6. Validate the pipeline with `scripts/metrics/mpl-validate-chart` (auto-injects the param for the validator only; rejects inline time ranges).
7. Pass to `chart-add --mpl '<query>' --dataset <name>`.

`find-metrics <value>` searches tag *values*, not metric names — only useful with a known entity name.

## Choosing a Query Shape

The `{type, temporality, unit}` block from `metrics-info` drives the pipeline:

| `type` | `temporality` | Pipeline |
|---|---|---|
| `Gauge` | `null` | Align directly with `avg`/`min`/`max`/`sum`. No rate. |
| `CounterMonotonic` | `Cumulative` | Convert to per-second rate (`align using prom::rate`), then aggregate. |
| `CounterMonotonic` | `Delta` | Already per-interval. Sum/align directly. |
| `CounterNonMonotonic` | either | Ambiguous (rate? delta? current value?). Ask the user. |
| `Histogram` | either | Use `bucket … using interpolate_cumulative_histogram` (cumulative) or `interpolate_delta_histogram` (delta). Plain `align using avg` produces nonsense. |

`temporality: null` means "not applicable" (the norm for Gauges), not "missing data".

If a chart combines metrics with mismatched units in arithmetic, surface the units in the chart description; `unit-for` doesn't infer derived units.

## Unit Handling

`chart-add --unit` accepts a friendly string and maps via `scripts/metrics/unit-for` (same script does the OTel → Axiom enum translation on its own). The chart-level rendering rules — which fields each chart kind accepts, the `Percent`/`Percent100` trap — live in [`chart-config.md`](./chart-config.md). This section covers the metrics-specific path.

### Workflow

1. Fetch the metric's metadata:
   ```bash
   scripts/metrics/metrics-info <deploy> <dataset> metrics <metric> info
   # -> {"type":"Gauge","temporality":null,"unit":"Cel"}
   ```
2. Map (or pass through to `chart-add --unit`):
   ```bash
   scripts/metrics/unit-for "Cel"   # -> {"unit":"Auto","customUnits":"Cel"}
   scripts/metrics/unit-for "ms"    # -> {"unit":"TimeMS"}
   scripts/metrics/unit-for "%"     # -> {"unit":"Percent100","customUnits":"%"}
   ```
3. For `Statistic`, `chart-add --unit` writes both fields. For other chart types, only `customUnits` — also encode the unit in `--name` (`"P95 Latency (ms)"`).

### Mapping reference

`unit-for` recognises these UCUM/OTel codes; everything else falls through to `customUnits`:

| Input | Axiom enum |
|---|---|
| `s`, `seconds`, `sec` | `TimeSec` |
| `ms`, `milliseconds` | `TimeMS` |
| `us`, `µs`, `microseconds` | `TimeUS` |
| `ns`, `nanoseconds` | `TimeNS` |
| `min`, `h`, `hour`, `d`, `day` | `TimeMin`/`TimeHour`/`TimeDay` |
| `By`, `bytes`, `KBy`/`MBy`/`GBy` | `Byte`/`Kilobyte`/`Megabyte`/`Gigabyte` |
| `By/s`, `bit/s` | `BytesSec`/`BitsSec` |
| `%` | `Percent100` (+ `customUnits: "%"`) |
| `USD`/`EUR`/`GBP`/`JPY`/`INR`/`CAD`/`AUD`/`CZK`/`PLN` | `Currency<XXX>` |

Deliberately not auto-mapped (ambiguous): `m` (metres or minutes), `B` (Bel — bytes are `By`), `1` (OTel "dimensionless" — could be ratio or count), empty/null. These fall through to `customUnits` verbatim or `Auto`.

### Percentages and ratios (OTel 0–1 fractions)

OTel ratios (availability, error rate, saturation, hit ratio) are emitted as 0–1 fractions. `Percent100` does NOT auto-multiply — convert in MPL:

```mpl
(
  `<dataset>`:requests_total | where code != #/5../ | map rate | group using sum,
  `<dataset>`:requests_total                          | map rate | group using sum
)
| compute availability using /
| map * 100
| align to $__interval using avg
```

Then pass `chart-add --unit "%"`.
