# Dashboard Panels

## Overview

The Cost Control dashboard provides visibility into Axiom usage patterns and helps identify optimization opportunities.

## Panel Reference

### KPI Row 1

| Panel | Query | Purpose |
|-------|-------|---------|
| **Total Ingest** | Sum of `properties.hourly_ingest_bytes` | Total data ingested in period |
| **Daily Burn Rate** | Total / days | Average daily consumption |
| **30-Day Projection** | Daily rate × 30 | Projected monthly usage |
| **% Over Contract** | (Projected - Contract) / Contract | How far over budget |

### KPI Row 2

| Panel | Query | Purpose |
|-------|-------|---------|
| **Required Cut** | (Projected - Contract) / Projected | % reduction needed |
| **Week-over-Week** | (This week - Last week) / Last week | Growth trend |
| **Query Cost** | Sum of `properties.hourly_billable_query_gbms` | Total query cost |
| **Active Datasets** | Distinct count of datasets | Scope of data |

### Time Series

| Panel | Dimensions | Purpose |
|-------|------------|---------|
| **Daily Ingest by Dataset** | Time × Dataset | Trend visualization |
| **Daily Query Cost by Dataset** | Time × Dataset | Query cost trends |
| **Queries per User** | Time × User | User activity patterns |

### Tables

| Panel | Columns | Purpose |
|-------|---------|---------|
| **Top Datasets by Ingest** | Dataset, Ingest GB, Query GB·ms | Biggest consumers |
| **Lowest Query Activity** | Dataset, Ingest GB, Query GB·ms, Work/GB | Waste candidates |
| **Top Orgs by Usage** | Org, Ingest GB, Query GB·ms, Datasets | Multi-org breakdown |
| **Top Ingest Movers (WoW)** | Dataset, This Week, Last Week, Delta | Growth drivers |
| **Top Users by Query Cost** | User, Cost GB·ms, Queries | Query cost attribution |
| **Top Expensive Queries** | User, Cost GB·ms, Query | Individual expensive queries |
| **Query Filter Patterns** | Dataset, Field, Op, Value, Queries | How data is queried |

## SmartFilters

The dashboard includes dynamic filters:

| Filter | Source | Purpose |
|--------|--------|---------|
| **Organization** | Distinct `resource.id` | Scope to specific org |
| **Dataset** | Distinct `properties.dataset` | Scope to specific dataset |
| **User** | Distinct `actor.email` | Scope to specific user |
| **Contract (GB/mo)** | Text input | Calculate % over contract |

## Work/GB Metric

**Work/GB** = Query Cost (GB·ms) ÷ Ingest GB

This ratio measures query activity relative to data volume:

| Value | Meaning | Action |
|-------|---------|--------|
| 0 | Never queried | Consider dropping |
| Low (<100) | Rarely queried | Review necessity |
| Medium (100-1000) | Moderately used | Normal |
| High (>1000) | Heavily queried | High value data |

## Dashboard Customization

### Adding Contract Line to Charts

To add a horizontal contract line to time series:

```json
{
  "query": {
    "apl": "...",
    "queryOptions": {
      "aggChartOpts": "{\"*\":{\"variant\":\"line\"},\"contract\":{\"variant\":\"line\",\"stroke\":\"#ff0000\",\"strokeDasharray\":\"5,5\"}}"
    }
  }
}
```

### Adjusting Time Range

Default: 30 days. Adjust via the dashboard `timeWindowStart`/`timeWindowEnd` (top-level fields) or the dashboard time picker. Per-panel time override is UI-only — there is no API field for it. (`overrideDashboardTimeRange` is not a real chart-create option: it is silently dropped on data charts and rejected on `Note`. See [building-dashboards § Fields Rejected on Create](../../building-dashboards/reference/chart-config.md#fields-rejected-on-create-cross-chart).)

### Color Scheme

Panels use semantic colors:
- **Blue** - Volume metrics
- **Orange** - Rate/velocity metrics
- **Purple** - Projections
- **Red** - Over-budget indicators
- **Green** - Healthy metrics
- **Teal** - Query cost
- **Yellow** - Change metrics
