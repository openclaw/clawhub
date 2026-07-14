# Grafana Dashboard Migration

Guide for converting Grafana dashboards (Prometheus-backed) to Axiom dashboards on a metrics dataset.

> **Headline rule.** A Grafana panel's spec is the **union of five fields**. No single field is the whole spec. Pull them together in your *first* projection and use their conjunction when authoring the MPL equivalent. The most common failure mode in this migration is reading one field and silently ignoring another — the resulting dashboard filters or groups on a different subset than the original, however honestly it claims to "match".

---

## Migration Workflow

1. **Export the Grafana dashboard JSON** (Share → Export, or Grafana HTTP API).
2. **Project the canonical panel spec** for every panel — `expr`, `legendFormat`, `unit`, `title`, `description`. Use the `jq` recipe below. Skipping this step is the most common failure mode.
3. **Reconcile prose against `expr`** — more-restrictive wins. See [Reconciling description and expr](#reconciling-description-and-expr).
4. **Map visualization types** (table below).
5. **Translate PromQL → MPL** preserving every selector and grouping. Full rules: [`promql-to-mpl.md`](./promql-to-mpl.md).
6. **Resolve metric/label name mismatches** by applying OTel renaming rules first, then validating with `metrics-info`. Escalate only after both fail.
7. **Validate each query** with `scripts/metrics/mpl-validate-chart` (preserves `$__interval`).
8. **Compose the Axiom dashboard** with `chart-add` + `layout-pack` + `dashboard-assemble`. For top-level field mappings (`refresh` → `refreshTime`, `time.from` → `timeWindowStart` with `qr-` prefix, etc.) see [Top-Level Dashboard Fields](#top-level-dashboard-fields).
9. **Deploy** with `dashboard-create`; URL via `dashboard-link`.

---

## Canonical Panel Spec — Pull Every Field

A Grafana panel carries spec information across multiple top-level fields. Each one carries something the others do not:

| Field                              | What it carries                                                                                              |
|:-----------------------------------|:-------------------------------------------------------------------------------------------------------------|
| `targets[*].expr`                  | The PromQL — selectors (`{label="x"}`), groupings (`by(label, …)`), aggregations, math.                      |
| `targets[*].legendFormat`          | Per-series labelling. `{{ resource }}` reveals "this panel groups by `resource`" even when the PromQL hides it. |
| `fieldConfig.defaults.unit`        | Display unit (Grafana enum — `s`, `bytes`, `percentunit`, etc.). Maps to Axiom `unit`/`customUnits`.          |
| `title`                            | Human-facing label. Often names the quantity ("p95 read request latency") that the PromQL implements.        |
| `description`                      | **Narrative constraints.** Often enumerates subsets, references, or intent in prose that does not appear verbatim in `expr` (e.g. "failed checkout attempts in the EU region over the last 24h, grouped by payment provider"). |

### `jq` projection

Run this against the exported dashboard JSON before authoring any MPL:

```bash
jq '
  .panels[]?
  | {
      title,
      description,
      unit: .fieldConfig.defaults.unit,
      targets: ((.targets // []) | map({expr, legendFormat, refId}))
    }
' grafana-dashboard.json
```

**Multi-target panels are normal.** A single panel can have several `targets` (e.g. one for `total`, one for `errors`, so the panel can compute a ratio in Grafana's transform layer). Iterate `targets[]`, not `targets[0]`. Translate every entry. Dropping the second target loses half the panel.

**Nested rows.** Grafana groups panels under "row" panels with their own `panels` array. If your dashboard uses rows, recurse:

```bash
jq '
  [ .panels[]?, (.panels[]? | .panels[]?) ]
  | map(select(.type != "row"))
  | .[]
  | { title, description, unit: .fieldConfig.defaults.unit,
      targets: ((.targets // []) | map({expr, legendFormat, refId})) }
' grafana-dashboard.json
```

### The conjunction rule

The five fields together **are** the spec. Author the MPL from their conjunction:

- `description` adds narrative constraints — does not replace `expr`.
- `expr` carries machine-readable structure — does not replace `description`.
- `legendFormat` reveals grouping intent often hidden in `expr`.
- `unit` + `title` drive chart unit configuration on the Axiom side.

---

## Reconciling description and expr

When `description` and `expr` *appear* to disagree on what the panel measures, both were deliberate authoring choices. The rule:

| Situation                                                        | Resolution                                                                                                       |
|:-----------------------------------------------------------------|:-----------------------------------------------------------------------------------------------------------------|
| `description` enumerates a *narrower* subset than `expr` filters | **Prose wins.** The narrower constraint was intentional; the `expr` may have been left broader for tooling reasons. |
| `description` enumerates a *broader* concept than `expr` filters | **`expr` wins.** Concrete machinery beats aspirational prose; the panel was deployed in the narrower form.        |
| `description` is missing or empty                                | Use `expr` + `legendFormat` alone. **Do not widen the subset via discovery to fill the gap.** Absence is not authorization. |
| `description` and `expr` agree                                   | The conjunction is the spec. Translate both.                                                                     |

Rule of thumb when both are present and disagree: **the more-restrictive constraint wins**. Both fields were authored deliberately; the prose constraint was put there for a reason.

---

## Visualization Type Mapping

| Grafana panel type | Axiom chart type      | Notes                                                                                              |
|:-------------------|:----------------------|:---------------------------------------------------------------------------------------------------|
| `timeseries`       | TimeSeries            | Direct mapping. Preserve grouping dimensions in MPL `group by`.                                    |
| `stat`             | Statistic             | Requires `customUnits`, not `unit` (the create API rejects `unit` on Statistic). See `chart-config.md`. |
| `gauge`            | Statistic             | Map thresholds to `warningThreshold` / `errorThreshold`. Statistic does not draw a dial; the value + threshold colour is the equivalent signal. |
| `bargauge`         | Statistic or Table    | Single value → Statistic. Multi-row → Table sorted by the value column.                            |
| `table`            | Table                 | Direct. Preserve column projections.                                                               |
| `heatmap`          | Heatmap               | Histograms map to `summarize histogram(...) by bin_auto(_time)` on APL datasets; for OTel histogram metrics, see `metrics-mpl.md`. |
| `piechart`         | Pie                   | Pie is for ≤6 slices — refuse to translate a pie of unbounded cardinality, switch to Table.        |
| `text`             | Note                  | `chart-add --type Note --text "<md>"` handles the shape (top-level `text`, no `options{}` wrapper). Strip Grafana's chart-level `description` — universally rejected. |
| `logs`             | LogStream             | Only when the source data is logs (events dataset), not a metrics dataset.                         |
| `barchart`, `histogram` | TimeSeries (variant `bars`) or Table | Choose by whether the x-axis is `_time` (TimeSeries with bar variant) or a category (Table). |
| `row`              | (none — recurse)      | A row groups child panels; project its `panels` array.                                             |

---

## Top-Level Dashboard Fields

Grafana and Axiom dashboard wrappers use different field names, types, and value formats. Carrying the Grafana wrapper through verbatim fails: `refreshTime` rejects the string form, `schemaVersion: 0` is promoted to a strict-mode failure by `dashboard-validate`, and Grafana's `time` block has no Axiom equivalent.

The canonical move is to start from [`reference/templates/blank.json`](./templates/blank.json) and only translate the Grafana fields you actually want to preserve.

| Grafana field | Axiom field | Translation |
|:---|:---|:---|
| `title` | `name` | Direct copy. |
| `description` (dashboard-level) | `description` (dashboard-level) | Direct copy. Chart-level `description` is rejected on every chart kind — see [chart-config.md § Fields Rejected on Create](./chart-config.md#fields-rejected-on-create). |
| `refresh` (string, e.g. `"10s"`, `"5m"`) | `refreshTime` (integer seconds) | Convert: `"10s"` → `10`, `"30s"` → `30`, `"1m"` → `60`, `"5m"` → `300`. Sending the string form fails with `unmarshal dashboard document: json: cannot unmarshal string into Go struct field Dashboard.refreshTime of type int64`. Default in `blank.json` is `60`. |
| `schemaVersion` (integer, often `0` or Grafana's current version like `39`) | `schemaVersion` | Always set to `2` — the Axiom dashboard schema is unrelated to Grafana's. `schemaVersion: 0` triggers a `dashboard-validate --strict` failure. |
| `time.from`, `time.to` (e.g. `"now-6h"`, `"now"`) | `timeWindowStart`, `timeWindowEnd` | Prefix with `qr-`: `"now-6h"` → `"qr-now-6h"`, `"now"` → `"qr-now"`. The bare `"now"` form fails with `[timeWindowStart]: expected string, received null` if omitted. Defaults in `blank.json`: `"qr-now-1h"` / `"qr-now"`. |
| `panels` (array of panel specs) | `charts` (array) + `layout` (array) | Per-panel translation, plus a separate layout array. Grafana's `gridPos` becomes layout entries with `i`, `x`, `y`, `w`, `h`. |
| `templating.list` (variables) | SmartFilter chart (separate kind) | Not a direct field copy. See `reference/smartfilter.md` if the source uses dashboard variables. |
| `tags`, `uid`, `id`, `version`, `iteration`, `weekStart`, `style`, `editable`, `graphTooltip`, `liveNow`, `timezone`, `fiscalYearStartMonth`, `annotations`, `links` | — | Drop. No Axiom equivalent. (Annotations on individual charts use a different mechanism — see [chart-config.md § Annotations](./chart-config.md#annotations).) |
| `datasource` (per-panel or default) | `datasets` (top-level array) + `query.metricsDataset` (per-chart) | Resolve the Prometheus datasource name to the Axiom metrics dataset hosting the OTel-ingested data; populate the dataset name in both places. |

The `owner` field has no Grafana equivalent — set it to `"X-AXIOM-EVERYONE"` (or a specific org/user/team identifier) as the blank skeleton does.

---

## PromQL → MPL: Preserve Every Selector and Grouping

Full rules: [reference/promql-to-mpl.md](./promql-to-mpl.md). Headline guarantees you must enforce regardless:

- **Every PromQL `{label="x"}` becomes an MPL `where` clause.** Never drop a selector because the metric name "feels" scoped to the right thing — the selector was an authoring decision.
- **Every PromQL `by(label1, label2)` dimension becomes an MPL `group by`.** Drop one and the chart shape changes.
- **Aggregations** (`rate()`, `sum()`, `histogram_quantile()`) translate to MPL operators — consult `scripts/metrics/metrics-spec` for the operator names per metric type before authoring. The `promql-to-mpl.md` doc covers the common operator mappings (rate → `align using prom::rate`, histogram_quantile → `bucket … using interpolate_*_histogram`, etc.).

**Discovery is a validator, not a generator.** Discovery (`metrics-info`, `metrics-query`) confirms that the subset described by `expr`+`description` exists in the dataset. It does not invent a subset for you. If you find yourself running discovery to *decide* what the panel should filter on, stop — the source dashboard already wrote that down.

---

## Name Mapping: PromQL ↔ OTel Ingest

When a metric or label name from `expr` does not appear verbatim in the Axiom dataset, the **first** move is not trial-and-error and not "metrics-info to look for similar names". The first move is applying the deterministic Prometheus → OTel renaming rules.

### Common transformations

These rules are stable; the canonical reference (the OpenTelemetry specification's "Prometheus and OpenMetrics Compatibility" page) carries the full table and any newer additions.

| PromQL form                                       | OTel form (post-ingest)                                  | Notes                                                                                                                            |
|:--------------------------------------------------|:---------------------------------------------------------|:---------------------------------------------------------------------------------------------------------------------------------|
| `<metric>_total`                                  | `<metric>` (counter type)                                | The `_total` suffix is dropped on OTel ingest; counter-ness is carried as metric metadata, not as a name suffix.                 |
| `<metric>_bucket`, `<metric>_sum`, `<metric>_count` | `<metric>` (Histogram type)                              | A Prometheus histogram's three derived series collapse into one OTel `Histogram` metric. Use the Histogram-type MPL operators.   |
| `<metric>_seconds`, `<metric>_bytes`, `<metric>_milliseconds` | Often unchanged; sometimes carried in `unit` metadata | Unit suffixes are sometimes preserved in the metric name and sometimes only in the metric's `unit` metadata. Validate both ways. |

These metric-name rules are stable. **Label names are different.** The OTel→Prom direction (OTel attribute `foo.bar` exposed as Prom label `foo_bar`) is convention, but the reverse is not safe to assume. A Prom label like `job` is *not* a renamed OTel attribute. A Prom label like `service_name` *might* be the OTel attribute `service.name`, or it might just be a Prom label called `service_name`. Resolve label names through reverse-tag discovery (next section), not through assumed renaming. When you do try a dotted form (`service.name`) as a candidate, back-tick it in MPL: `` `service.name` ``.

### Order of operations

1. **For metric names:** apply the rename rules (deterministic, free, first).
2. **Validate with `metrics-info`:**
   - `scripts/metrics/metrics-info <deploy> <dataset> metrics <renamed-name> info` for metrics.
   - `scripts/metrics/metrics-info <deploy> <dataset> tags <label> values` for labels (start from the original Prom label; reverse-search if absent).
3. **Surface the mismatch** only after both steps fail. Do not silently swap to a "looks similar" name.

Find the live OpenTelemetry specification's "Prometheus and OpenMetrics Compatibility" page for the authoritative metric-name table — these rules evolve, so consult the spec rather than memorizing.

---

## Reverse-Tag Discovery for Missing Labels

When a PromQL label name does not exist verbatim in the MPL dataset *after* applying the OTel rename rules — for example, PromQL has `{job="ingest-worker"}` but the dataset has no `job` tag — **do not drop the selector**. Reverse-search:

1. **List all tags in the dataset:**
   ```bash
   scripts/metrics/metrics-info <deploy> <dataset> tags
   ```
2. **Inspect candidate values:**
   ```bash
   scripts/metrics/metrics-info <deploy> <dataset> tags <candidate> values
   ```
3. **Map the selector** to the equivalent tag once a value confirms it (e.g. PromQL `job=ingest-worker` → MPL `where service.name == "ingest-worker"` if the dataset uses `service.name`).
4. **If no equivalent exists,** surface the mismatch to the user and document the panel as deferred. **Do not silently drop the selector** — that ships a wrong-shape dashboard.

> Note: `find-metrics` is not the right tool here. It searches **tag values**, not tag names — useful when you know an entity name and want to find which metrics carry it, not for label-name reverse-search.

---

## Common Migration Pitfalls

### Pulling `expr` but ignoring `description` (or vice versa)
The most common failure. The fields are complementary. `expr` is machine-readable; `description` carries narrative constraints. **Fix:** always project all five fields before authoring.

### Using discovery to invent the subset
Symptom: agent runs `metrics-info`, picks metrics that "look right", ships those. That's invention, not translation. **Fix:** discovery confirms the spec'd subset exists; it doesn't generate it.

### Hand-rolling rename guesses
Symptom: `http_requests_total` not found → tries `http_requests`, `http_request_count`, … **Fix:** apply OTel rename rules deterministically (drop `_total`), validate once with `metrics-info`, escalate.

### Multi-target panels translated as one
Symptom: a panel with `total` + `errors` targets becomes a single MPL pipeline. **Fix:** iterate `targets[]`; translate every entry. Combine in MPL or split into two panels if Grafana used transforms.

### Substituting a different quantity when blocked
Symptom: ratio can't be computed → agent ships a related quantity Y labelled "Y replaces X". Never acceptable. **Fix:** defer the panel with a Note documenting the blocker. See [SKILL.md § Compute or Defer](../SKILL.md#compute-or-defer).

### Translating from the live Grafana UI instead of the export
Symptom: agent screen-scrapes the rendered chart. **Fix:** always work from the exported JSON — UI text is generated from `title` + `legendFormat` and obscures parts of the spec.

---

## Migration Checklist

- [ ] Exported Grafana dashboard JSON (or fetched via Grafana API).
- [ ] Projected canonical panel spec via `jq` — every panel's `expr`, `legendFormat`, `unit`, `title`, `description`.
- [ ] For every panel, listed the spec as the conjunction of its five fields; reconciled prose against `expr` (more-restrictive wins).
- [ ] Mapped visualization types per the table above.
- [ ] For every metric/label name in `expr`: applied OTel renaming rules first, validated with `metrics-info`, escalated only if both failed.
- [ ] For every PromQL `{...}` selector: a corresponding MPL `where` clause.
- [ ] **For every PromQL selector value not present in `metrics-info … tags <label> values`: cited a written source for the expansion** (panel `description`, or upstream rule library file + line). Memory-as-source is forbidden; no citation → defer the panel. See [promql-to-mpl.md § Selector Values Not in the Dataset Are Aliases](./promql-to-mpl.md#selector-values-not-in-the-dataset-are-aliases--cite-the-source).
- [ ] For every PromQL `by(...)`: a corresponding MPL `group by` with all dimensions preserved.
- [ ] Tested every query with `metrics-query`, preserving `$__interval` (with `param` declaration and `-p __interval=…`).
- [ ] Built Axiom dashboard JSON without inline time ranges in chart queries.
- [ ] Set chart units correctly: `customUnits` on Statistic, `unit` on TimeSeries (see `chart-config.md`).
- [ ] Validated with `dashboard-validate`.
- [ ] Deployed with `dashboard-create`.
- [ ] Got the URL via `dashboard-link` (never constructed manually).
- [ ] Compared panel-by-panel to the original: does each panel filter the same subset and group by the same dimensions?
