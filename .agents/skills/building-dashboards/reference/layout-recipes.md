# Layout Recipes

Section blueprints for common dashboard structures. The grid is **12 columns wide**; `dashboard-validate` rejects entries past column 12. `scripts/layout-pack` packs ordered ids into the grid using per-type defaults — most recipes below are expressible as a `layout-pack` invocation.

Default per-type sizes (from `layout-pack`): Statistic 3×3, TimeSeries 6×4, Heatmap 6×4, Pie 4×4, Table 6×5, LogStream 12×6, Note 12×2, MonitorList 6×4, SmartFilter 12×1.

## Service Overview (oncall)

Stats row → trend row → breakdowns → evidence.

```bash
layout-pack \
  err-rate:Statistic p95:Statistic traffic:Statistic alerts:Statistic \
  traffic-ts:TimeSeries latency-ts:TimeSeries \
  top-routes:Table top-errors:Table \
  recent-errors:LogStream
```

Resulting grid:

```
y= 0  [err-rate 3] [p95 3] [traffic 3] [alerts 3]
y= 3  [traffic-ts  6      ] [latency-ts  6       ]
y= 7  [top-routes  6      ] [top-errors  6       ]
y=12  [recent-errors            12               ]
```

## Service Overview with Filter Bar

Add a SmartFilter row at the top (full-width, h=1):

```bash
layout-pack \
  filters:SmartFilter \
  err-rate:Statistic p95:Statistic traffic:Statistic alerts:Statistic \
  …
```

## SLO Tracking

Three SLO statistics across the top, two trend charts below, violations table at the bottom.

```bash
layout-pack \
  avail:4x3 latency-slo:4x3 budget:4x3 \
  avail-trend:TimeSeries burn-rate:TimeSeries \
  violations:Table
```

`Statistic` defaults to 3×3; override with `id:4x3` to fit three across.

## Incident Investigation

Filter bar → impact row → narrow-bin timeline → 4-way breakdown → tall LogStream.

```bash
layout-pack \
  filters:SmartFilter \
  err-count:Statistic affected:Statistic start:Statistic duration:Statistic \
  err-timeline:12x4 \
  by-route:Table by-message:Table \
  by-pod:Table by-customer:Table \
  raw-logs:12x10
```

## Multi-Service Comparison

Filter bar → stacked-traffic full-width → error-rate full-width → per-service columns (each column is a `Statistic` + `Table` stack).

```bash
layout-pack \
  filters:SmartFilter \
  traffic-stacked:12x4 \
  errors-by-service:12x4 \
  api-stat:4x3 auth-stat:4x3 pay-stat:4x3 \
  api-table:4x5 auth-table:4x5 pay-table:4x5
```

## Kubernetes Cluster Overview

Cluster-health stats → resource usage → pod issues → events.

```bash
layout-pack \
  nodes:Statistic pods:Statistic restarts:Statistic oomkills:Statistic \
  cpu-by-ns:TimeSeries mem-by-ns:TimeSeries \
  pods-restarts:Table pods-cpu:Table \
  events:LogStream
```

## Best Practices

- Keep adjacent panels at consistent heights within a row; mixed heights wrap correctly via `layout-pack`'s row-major fill but read as messy.
- One question per panel. Split rather than overload.
- Notes as section headers (`12x2`) instead of large vertical gaps.
- Rule of thumb panel order: critical-top-left, supporting-context middle, evidence (LogStream) bottom.
