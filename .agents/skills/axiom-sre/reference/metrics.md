# MetricsDB Reference

## MetricsDB vs EventDB

Axiom has two query engines with distinct query languages and endpoints.

| | EventDB | MetricsDB |
|--|---------|-----------|
| **Data** | Logs, traces, spans | OTel metrics (counters, gauges, histograms) |
| **Datasets** | Standard datasets | `otel-metrics-v1` datasets |
| **Query language** | APL | MPL |
| **Query script** | `scripts/axiom-query` | `scripts/axiom-metrics-query` |
| **API endpoint** | `POST /v1/datasets/_apl` | `POST /v1/query/_metrics` |
| **Time expressions** | `ago()`, `now()`, absolute | RFC3339 timestamps only — no relative expressions |

EventDB is general-purpose event storage. MetricsDB is purpose-built for time-series metrics — optimized for aggregation, alignment, and high-cardinality tag queries on counter/gauge/histogram data.

Do not query MetricsDB datasets with APL. Do not query EventDB datasets with MPL. They are separate systems.

---

## MPL Basics

### Self-Describing Spec

MPL's query endpoint documents itself. Always fetch the spec before writing queries:

```bash
scripts/axiom-metrics-query <env> --spec
```

This calls `OPTIONS /v1/query/_metrics` and returns the complete MPL language specification — syntax, operators, and examples.

### Query Format

```
DATASET_NAME:METRIC_NAME | operator1 | operator2 | ...
```

The dataset and metric are specified as a single identifier separated by `:`, followed by a pipeline of operators.

### Key Operators

| Operator | Purpose | Example |
|----------|---------|---------|
| `align` | Align data to time buckets | `align to 5m using avg` |
| `group` | Group by tag values | `group by service.name` |
| `filter` | Filter by tag values | `filter service.name == "api"` |
| `map` | Transform values | `map value * 100` |
| `bucket` | Histogram bucket operations | `bucket percentile(0.99)` |

### Time Constraint (CRITICAL)

MPL requires RFC3339 timestamps. Relative expressions like `ago()`, `now()`, or `now-1h` are **not supported**.

```bash
# Correct: RFC3339 timestamps
scripts/axiom-metrics-query prod --start "2025-06-01T00:00:00Z" --end "2025-06-01T01:00:00Z" <<< "my-dataset:cpu.usage | align to 5m using avg"

# Wrong: relative time (will fail)
scripts/axiom-metrics-query prod --start "now-1h" <<< "my-dataset:cpu.usage | align to 5m using avg"
```

Always use `--range` or explicit `--start`/`--end` with the query script.

---

## Discovery

Use `scripts/axiom-metrics-discover` to explore metrics, tags, and tag values. Defaults to last 1 hour.

```bash
# List all metrics
scripts/axiom-metrics-discover <env> <dataset> metrics

# List all tags
scripts/axiom-metrics-discover <env> <dataset> tags

# List values for a tag
scripts/axiom-metrics-discover <env> <dataset> tag-values service.name

# List tags for a specific metric
scripts/axiom-metrics-discover <env> <dataset> metric-tags http.server.request.duration

# List tag values for a specific metric+tag
scripts/axiom-metrics-discover <env> <dataset> metric-tag-values http.server.request.duration service.name

# Find metrics matching a tag value (fastest path from "I know the service" to "what metrics exist")
scripts/axiom-metrics-discover <env> <dataset> search "api-gateway"

# Custom time range
scripts/axiom-metrics-discover <env> <dataset> --range 24h metrics
scripts/axiom-metrics-discover <env> <dataset> --start 2025-06-01T00:00:00Z --end 2025-06-02T00:00:00Z tags
```

Under the hood this calls `/v1/query/metrics/info/` endpoints via `scripts/axiom-api`. For raw access, see the API paths in the script header.

---

## Query Patterns

### CPU usage by service

```mpl
otel-metrics:system.cpu.utilization | align to 5m using avg | group by service.name
```

### Request rate

```mpl
otel-metrics:http.server.request.duration | align to 1m using count | group by service.name
```

### Error rate from metrics

```mpl
otel-metrics:http.server.request.duration | filter http.status_code >= 500 | align to 5m using count | group by service.name
```

### Memory utilization

```mpl
otel-metrics:process.runtime.go.mem.heap_alloc | align to 5m using avg | group by service.name
```

### Histogram percentiles (p99 latency)

```mpl
otel-metrics:http.server.request.duration | align to 5m using avg | bucket percentile(0.99) | group by service.name
```

### Filter by service.name

```mpl
otel-metrics:http.server.request.duration | filter service.name == "api-gateway" | align to 1m using avg
```

### Combine filter and group

```mpl
otel-metrics:http.server.request.duration | filter service.namespace == "production" | align to 5m using count | group by service.name, http.method
```

Note: Metric and tag names depend on the OTel instrumentation. Use the discovery endpoints to find the actual names in your datasets.

---

## Error Handling

| Code | Meaning | Action |
|------|---------|--------|
| 400 | Bad query syntax or invalid dataset | Check MPL syntax via `--spec` flag |
| 401 | Missing or invalid authentication | Verify `AXIOM_TOKEN` is set and valid |
| 403 | No permission to query this dataset | Check token scopes |
| 404 | Dataset not found | Verify dataset name via `scripts/init` |
| 429 | Rate limited | Back off and retry |
| 500 | Internal server error | Report `x-axiom-trace-id` to backend team |

On **500 errors**: the query script captures the `x-axiom-trace-id` response header automatically. Report this trace ID — it is essential for backend debugging.

On **400 errors**: the most common cause is invalid MPL syntax. Fetch the spec (`--spec`) and compare your query against it. Common mistakes:
- Using relative time expressions (`ago()`, `now()`)
- Missing `align` operator (most queries need one)
- Wrong metric or tag names (use discovery endpoints to verify)

---

## Workflow

1. **Identify metrics datasets.** Run `scripts/init` — Axiom deployments list their datasets, including `otel-metrics-v1` types.

2. **Learn MPL syntax.** Run `scripts/axiom-metrics-query <env> --spec` to get the full language specification. Read it before writing queries.

3. **Discover available metrics.** Use info endpoints via `scripts/axiom-api` to list metrics and tags in the target dataset. If you know a service name, use the search endpoint to find matching metrics.

4. **Compose and execute MPL query.** Build the query incrementally — start with the metric, add `align`, then `filter`/`group` as needed.

5. **Iterate.** Refine filters, aggregations, and time ranges based on results. Narrow the time window for faster responses.
