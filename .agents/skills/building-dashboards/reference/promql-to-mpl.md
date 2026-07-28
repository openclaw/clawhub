# PromQL → MPL Translation

Mechanical translation rules. The source PromQL carries the spec — translate, don't reinvent.

**Two rules:**

1. **Preserve structure.** Every `{label="x"}` selector → MPL `where`. Every `by(label1, label2)` → MPL `group by`. Never drop one because the metric "feels" scoped to it.
2. **Reverse-tag discovery for missing labels.** Apply OTel rename rules first, then use `metrics-info` to find the equivalent tag. Discovery is a validator, not a generator.

Run `scripts/metrics/metrics-spec <deploy> <dataset>` before authoring — operator names evolve and the spec is the source of truth.

---

## Pre-translation: Name shape

Before reaching for `metrics-info`, apply the deterministic Prometheus → OTel renaming rules. Most "missing metric" cases dissolve at this step.

| PromQL form                                                    | OTel form                              |
|:---------------------------------------------------------------|:---------------------------------------|
| `<metric>_total` (counter)                                     | `<metric>` (counter-ness in metadata)  |
| `<metric>_bucket` / `<metric>_sum` / `<metric>_count` (histogram derivatives) | `<metric>` (one Histogram metric) |
| `<metric>_seconds`, `<metric>_bytes`, `<metric>_milliseconds`  | sometimes preserved; sometimes only in `unit` metadata |

**Label names are not deterministic.** Prometheus label names do not round-trip cleanly to OTel attribute names — the OTel→Prom direction (dots in OTel attributes become underscores in Prom) is convention, but the reverse is a guess. A Prom label like `job` is *not* a renamed OTel attribute; a Prom label like `service_name` *might* be the OTel attribute `service.name`, or it might just be a Prom label called `service_name`. Treat label-name resolution as reverse-tag-discovery work (see below), not as a deterministic renaming step.

Full rules and order of operations are in [grafana-migration.md § Name Mapping](./grafana-migration.md#name-mapping-promql--otel-ingest).

---

## Selector translation: PromQL `{…}` → MPL `where`

Every label matcher in the PromQL `{…}` becomes a `where` clause on the MPL pipeline. Multiple matchers are conjunctive in PromQL and translate to a chain of `where` clauses (also conjunctive) — or one `where` with `and`.

**Fetch the tag type before translating.** PromQL stores every label as a string; MPL has typed tags (string/int/float/bool) and the right operator depends on the dataset's type, not on what PromQL did:

```bash
scripts/metrics/metrics-info <deploy> <dataset> metrics <metric> tags <tag> type
# -> {"type": "int", "present_types": ["int"]}
```

Don't infer from `metrics-info … tags <tag> values` alone — Prometheus-imported tags often stringify numerics; quoted values in JSON are inconclusive. The probe runs `filter <tag> is <T>` for each candidate type and reports which return non-empty series.

If `type` comes back `"mixed"`, the tag carries multiple types across rows. Use the defensive form:

```mpl
| filter (`tag` is int and `tag` == 200) or (`tag` is string and `tag` == "200")
```

### Translation by tag type

**String-typed tag** (most labels — `service.name`, `path`, `container`, etc.):

| PromQL matcher              | MPL `where` form                              |
|:----------------------------|:----------------------------------------------|
| `{label="value"}`           | `\| where label == "value"`                    |
| `{label!="value"}`          | `\| where label != "value"`                    |
| `{label=~"regex"}`          | `\| where label == #/regex/`                   |
| `{label!~"regex"}`          | `\| where label != #/regex/`                   |

MPL regex uses `#/…/` delimiters (no quotes). Forward slashes inside the pattern need escaping (`\/`).

**Numeric-typed tag** (`int` or `float` — common for HTTP status codes, ports, queue depths):

PromQL stored the value as a string and used regex to match ranges (`code=~"5.."`). When the same tag is `int`-typed in MPL, **translate to a typed comparison** — it's faster, clearer, and matches the user's intent.

| PromQL                       | MPL (when `code` is `int`)                  |
|:-----------------------------|:--------------------------------------------|
| `{code="500"}`               | `\| where code == 500`                       |
| `{code=~"5.."}`              | `\| where code >= 500 and code < 600`        |
| `{code!~"[1234].."}`         | `\| where code >= 500`                       |
| `{code=~"500\|502\|503"}`    | `\| where code == 500 or code == 502 or code == 503` |

**Bool-typed tag:** `{flag="true"}` → `| where flag == true`.

**Worked example:**

```promql
http_request_duration_seconds_count{
  container=~"api|web",
  path=~".*\/v1\/(traces|logs|metrics).*",
  code!~"[1234].."
}
```

Probe each tag's type before authoring:

```bash
scripts/metrics/metrics-info test test http_request_duration_seconds_count tags code type
scripts/metrics/metrics-info test test http_request_duration_seconds_count tags container type
scripts/metrics/metrics-info test test http_request_duration_seconds_count tags path type
```

If `code` comes back `"int"`, use the typed-comparison form below. If it comes back `"string"`, translate the regex instead (`| where code == #/[5-9]../`) — see the string-typed table above.

In MPL, with `container` and `path` confirmed as strings and `code` confirmed as int:

```mpl
test:http_request_duration_seconds_count
| where container == #/api|web/
| where path == #/.*\/v1\/(traces|logs|metrics).*/
| where code >= 500
```

The `code!~"[1234].."` regex (Prom's only way to express "5xx or higher") collapses to `where code >= 500` — a typed comparison the dataset can satisfy directly.

**Backticking non-identifier names.** MPL identifiers that contain dots (or other non-alphanumeric characters) must be backtick-escaped: `` `service.name` ``, `` `kubernetes.pod.name` ``. The metric name itself is also backtick-escaped when it contains dots: `` `http.server.duration` ``.

---

## Aggregation translation: `rate(...)` and friends

PromQL aggregation operators map onto MPL's `align`, `group`, and `bucket` operators. The translation preserves the semantic; idiomatic MPL is shorter than PromQL because MPL composes left-to-right instead of nesting.

### Rate

`rate(metric[5m])` becomes `align to 5m using prom::rate`. The Prom range vector duration becomes the `align` window.

```promql
rate(http_requests_total{path="/api"}[5m])
```

```mpl
test:http_requests_total
| where path == "/api"
| align to 5m using prom::rate
```

> **Why `prom::rate` and not `rate`?** `prom::rate` preserves Prometheus semantics (handles counter resets, extrapolates over the window). Use it for any translation from PromQL `rate()`. Plain `rate` exists for native MPL use cases where you do not want Prom's extrapolation. When in doubt, match the source: PromQL `rate(...)` → `prom::rate`. Confirm operator availability with `scripts/metrics/metrics-spec` before authoring.

### Other aggregations

| PromQL                          | MPL                                                |
|:--------------------------------|:---------------------------------------------------|
| `sum(metric)`                   | `\| group using sum`                               |
| `sum by (a, b) (metric)`        | `\| group by a, b using sum`                       |
| `avg by (a) (rate(metric[5m]))` | `\| align to 5m using prom::rate \| group by a using avg` |
| `max_over_time(metric[7d])`     | `\| group using max \| align to 7d using avg`      |
| `min by (a) (metric)`           | `\| group by a using min`                          |
| `count by (a) (metric)`         | `\| group by a using count`                        |

### `by(...)` is mandatory to preserve

Most common translation bug: dropping a `by(...)` dimension because the metric "feels" scoped to one. Never do this — the dimension was specified deliberately. Drop one and the chart has the wrong shape.

```promql
sum by (instance, name) (workqueue_depth)   // two dimensions, both required
```

```mpl
test:workqueue_depth
| group by instance, name using sum         // both dimensions preserved
```

---

## Histogram translation: `histogram_quantile(...)` → `bucket … using interpolate_*_histogram(...)`

PromQL histograms are three derived series (`_bucket`, `_sum`, `_count`); a histogram_quantile pipeline reduces them via a sum-by-le, then computes a quantile. MPL collapses this into a single `bucket` operator that takes the quantile as a function argument.

```promql
histogram_quantile(0.90,
  sum by (method, path, le) (
    rate(http_request_duration_seconds_bucket{service="api"}[5m])
  )
)
```

```mpl
test:http_request_duration_seconds_bucket
| where service == "api"
| bucket by method, path to 5m using interpolate_cumulative_histogram(rate, 0.90, 0.99)
```

**Two things drop out** of the literal translation, structurally:

1. **The `le` dimension drops from the `by` list.** MPL handles bucket boundaries internally; surfacing `le` would be redundant. The `by(method, path, le)` becomes `bucket by method, path` — `le` is gone.
2. **The outer `rate(...)` collapses into the bucket call** as the rate argument: `interpolate_cumulative_histogram(rate, 0.90, …)`. The `[5m]` Prom range becomes the `bucket … to 5m` window.

**Pick the right histogram operator** for the metric's temporality. Cumulative histograms (the OTel default) use `interpolate_cumulative_histogram`. Delta histograms use `interpolate_delta_histogram`. Read the metric's `temporality` from `scripts/metrics/metrics-info <deploy> <dataset> metrics <metric> info` before choosing — this is part of the metric metadata, not a guess.

---

## Boolean step functions: `<bool` and friends

PromQL's `<bool 0.4` expression returns 0 or 1 per timestamp depending on whether the value is below the threshold. MPL expresses this with `map is::lt(0.4)` (and analogous predicates).

```promql
(metric <bool 0.4)
```

```mpl
| map is::lt(0.4)
```

Common predicates: `is::lt`, `is::le`, `is::gt`, `is::ge`, `is::eq`, `is::ne`. Confirm names against `metrics-spec` for the dataset — operator availability evolves.

---

## Ratios and division: `compute … using /`

PromQL ratio expressions — `sum(rate(errors[5m])) / sum(rate(total[5m]))` — translate to MPL `compute` blocks that join two parenthesized branches.

```promql
sum(rate(http_requests_total{outcome="failure"}[5m]))
/
sum(rate(http_requests_total[5m]))
```

```mpl
(
  test:http_requests_total
  | where outcome == "failure"
  | align to 5m using prom::rate
  | group using sum,
  test:http_requests_total
  | align to 5m using prom::rate
  | group using sum
)
| compute error_rate using /
```

**Two notes for translators:**

1. **Both branches must have the same shape** — same `align` window, same grouping. If one has `group by service` and the other doesn't, the join will not line up.
2. **Ratios are 0–1 fractions, not percentages.** Multiply by 100 in MPL before passing to `chart-add --unit "%"`: `| map * 100`. See [metrics-mpl.md § Percentages and ratios](./metrics-mpl.md#percentages-and-ratios-otel-01-fractions).

For naming a branch in `compute`, use the `as` keyword: `test:http_requests_total as failure`. Helpful when the same metric appears twice with different filters.

---

## Reverse-Tag Discovery for Missing Labels

When a PromQL label name does not exist verbatim in the MPL dataset *after* applying OTel rename rules — e.g. PromQL has `{job="ingest-worker"}` but the dataset has no `job` tag — **do not drop the selector**. The selector was authored deliberately; the dataset just spells the dimension differently.

### Workflow

1. **List all tags in the dataset.**
   ```bash
   scripts/metrics/metrics-info <deploy> <dataset> tags
   ```
2. **Inspect candidate values.** Pick the most likely candidate (often `service.name` for `job`, `k8s.pod.name` for `instance`, etc.) and confirm:
   ```bash
   scripts/metrics/metrics-info <deploy> <dataset> tags <candidate> values
   ```
   Look for the value the PromQL selector matched on.
3. **Map the selector** to the equivalent tag.
   ```promql
   {job="ingest-worker"}
   ```
   ```mpl
   | where `service.name` == "ingest-worker"
   ```
4. **If no equivalent exists,** surface the mismatch to the user as a blocker. Document the panel as deferred. **Never silently drop the selector** — that ships a wrong-shape dashboard.

### Discovery cap

Cap reverse-search at **two candidates** before surfacing a question. If two reasonable candidate tags don't carry the expected value, the dataset probably doesn't model the dimension and the user has to decide. Burning ten discovery calls on a hunch is a smell, not diligence.

### What discovery does NOT do

Discovery validates that the spec'd subset exists in the dataset. It **does not** invent a subset. If you find yourself running `metrics-info` to *decide* what the panel should filter on, stop — the source dashboard already wrote that down. (See also [grafana-migration.md § Common Migration Pitfalls](./grafana-migration.md#common-migration-pitfalls).)

---

## Selector Values Absent from the Dataset Are Aliases — Cite the Source

When a PromQL selector value isn't in `metrics-info … tags <label> values`, the value is a recording-rule alias defined elsewhere, not a literal to translate. The alias expands to a subset of the dataset's values — but that subset is defined *outside* the dashboard JSON.

Resolve by citing a **written source**:

- the panel's `description` field (often enumerates the subset in prose), or
- the upstream rule library file + line (e.g. `<rule-library>.<ext>:L<n>`).

**Memory is not a source.** Agents recall the *shape* of rule definitions more confidently than the exact contents, and rule libraries change over time. No citation → defer the panel with a Note.

Detection trigger: the value isn't in `metrics-info … tags <label> values`. From that point on, no prior-knowledge expansion is allowed.

---

## Translation Checklist

Per panel:

- [ ] Applied OTel metric-name rename rules to every metric in `expr` (drop `_total`, decompose histogram derivatives, normalize unit suffixes).
- [ ] Validated each renamed metric name with `metrics-info` (or marked the chart blocked).
- [ ] Resolved label names via `metrics-info … tags` — not via assumed renaming. Reverse-search if absent (capped at 2 candidates).
- [ ] **For every PromQL selector value not present in `metrics-info … tags <label> values`: cited a written source for the expansion** (panel `description`, or upstream rule library file + line). Memory-as-source is forbidden; no citation → defer the panel. See [§ Selector Values Not in the Dataset Are Aliases](#selector-values-not-in-the-dataset-are-aliases--cite-the-source).
- [ ] For each PromQL `{…}` matcher: produced a corresponding MPL `where` clause (regex `=~` → `== #/…/`, etc.).
- [ ] For each PromQL `by(…)` dimension: included it in the MPL `group by` (or `bucket by` for histograms).
- [ ] For each `rate(metric[X])`: produced `align to X using prom::rate`.
- [ ] For each `histogram_quantile(...)`: chose `interpolate_cumulative_histogram` or `interpolate_delta_histogram` based on the metric's `temporality` metadata.
- [ ] For each ratio: built a `compute … using /` block, branches with matching shape; multiplied by 100 if the chart is `Percent100`.
- [ ] For each missing label: ran reverse-tag discovery (capped at 2 candidates), surfaced a blocker rather than dropping the selector.
- [ ] No inline time ranges on the MPL source.
- [ ] Tested via `scripts/metrics/metrics-query`, preserving `$__interval` (with `param` declaration and `-p __interval=…`).
- [ ] Spot-checked: does each translated panel filter the same subset and group by the same dimensions as the original?
