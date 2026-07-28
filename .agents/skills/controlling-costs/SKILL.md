---
name: controlling-costs
description: Analyzes Axiom query patterns to find unused data, then builds dashboards and monitors for cost optimization. Use when asked to reduce Axiom costs, find unused columns or field values, identify data waste, or track ingest spend.
---

# Axiom Cost Control

Dashboards, monitors, and waste identification for Axiom usage optimization.

## Before You Start

1. Load required skills:
   ```
   skill: axiom-sre
   skill: building-dashboards
   ```
   
   Building-dashboards provides: `dashboard-list`, `dashboard-get`, `dashboard-create`, `dashboard-update`, `dashboard-delete`

2. Find the audit dataset. Try `axiom-audit` first:
   ```apl
   ['axiom-audit']
   | where _time > ago(1h)
   | summarize count() by action
   | where action in ('usageCalculated', 'runAPLQueryCost')
   ```
   - If not found → ask user. Common names: `axiom-audit-logs-view`, `audit-logs`
   - If found but no `usageCalculated` events → wrong dataset, ask user

3. Verify `axiom-history` access (required for Phase 4):
   ```apl
   ['axiom-history'] | where _time > ago(1h) | take 1
   ```
   If not found, Phase 4 optimization will not work.

4. Confirm with user:
   - Deployment name?
   - Audit dataset name?
   - Contract limit in TB/day? (required for Phase 3 monitors)

5. Replace `<deployment>` and `<audit-dataset>` in all commands below.

**Tips:**
- Run any script with `-h` for full usage
- Do NOT pipe script output to `head` or `tail` — causes SIGPIPE errors
- Requires `jq` for JSON parsing
- Use axiom-sre's `axiom-query` for ad-hoc APL, not direct CLI

## Which Phases to Run

| User request | Run these phases |
|--------------|------------------|
| "reduce costs" / "find waste" | 0 → 1 → 4 |
| "set up cost control" | 0 → 1 → 2 → 3 |
| "deploy dashboard" | 0 → 2 |
| "create monitors" | 0 → 3 |
| "check for drift" | 0 only |

---

## Phase 0: Check Existing Setup

```bash
# Existing dashboard?
dashboard-list <deployment> | grep -i cost

# Existing monitors?
axiom-api <deployment> GET "/v2/monitors" | jq -r '.[] | select(.name | startswith("Cost Control:")) | "\(.id)\t\(.name)"'
```

If found, fetch with `dashboard-get` and compare to `templates/dashboard.json` for drift.

---

## Phase 1: Discovery

```bash
scripts/baseline-stats -d <deployment> -a <audit-dataset>
```

Captures daily ingest stats and produces the **Analysis Queue** (needed for Phase 4).

---

## Phase 2: Dashboard

```bash
scripts/deploy-dashboard -d <deployment> -a <audit-dataset>
```

Creates dashboard with: ingest trends, burn rate, projections, waste candidates, top users. See `reference/dashboard-panels.md` for details.

---

## Phase 3: Monitors

**Contract is required.** You must have the contract limit from preflight step 4.

### Step 1: List available notifiers

```bash
scripts/list-notifiers -d <deployment>
```

Present the list to the user and ask which notifier they want for cost alerts.
If they don't want notifications, proceed without `-n`.

### Step 2: Create monitors

```bash
scripts/create-monitors -d <deployment> -a <audit-dataset> -c <contract_tb> [-n <notifier_id>]
```

Creates 3 monitors:

1. **Total Ingest Guard** — alerts when daily ingest >1.2x contract OR 7-day avg grows >15% vs baseline
2. **Per-Dataset Spike** — robust z-score detection, alerts per dataset with attribution
3. **Query Cost Spike** — hardened z-score with 30d baseline, 5d exclusion gap, persistence-based gating (median_z > 3, p25_z > 2.5)

The spike monitors use `notifyByGroup: true` so each dataset triggers a separate alert.

See `reference/monitor-strategy.md` for threshold derivation.

---

## Phase 4: Optimization

### Get the Analysis Queue

Run `scripts/baseline-stats` if not already done. It outputs a prioritized list:

| Priority | Meaning |
|----------|---------|
| P0⛔ | Top 3 by ingest OR >10% of total — MANDATORY |
| P1 | Never queried — strong drop candidate |
| P2 | Rarely queried (Work/GB < 100) — likely waste |

**Work/GB** = query cost (GB·ms) / ingest (GB). Lower = less value from data.

### Analyze datasets in order

Work top-to-bottom. For each dataset:

**Step 1: Column analysis**
```bash
scripts/analyze-query-coverage -d <deployment> -D <dataset> -a <audit-dataset>
```

If 0 queries → recommend DROP, move to next.

**Step 2: Field value analysis**

Pick a field from suggested list (usually `app`, `service`, or `kubernetes.labels.app`):
```bash
scripts/analyze-query-coverage -d <deployment> -D <dataset> -a <audit-dataset> -f <field>
```

Note values with high volume but never queried (⚠️ markers).

**Step 3: Handle empty values**

If `(empty)` has >5% volume, you MUST drill down with alternative field (e.g., `kubernetes.namespace_name`).

**Step 4: Record recommendation**

For each dataset, note: name, ingest volume, Work/GB, top unqueried values, action (DROP/SAMPLE/KEEP), estimated savings.

### Done when

All P0⛔ and P1 datasets analyzed. Then compile report using `reference/analysis-report-template.md`.

---

---

## Cleanup

```bash
# Delete monitors
axiom-api <deployment> GET "/v2/monitors" | jq -r '.[] | select(.name | startswith("Cost Control:")) | "\(.id)\t\(.name)"'
axiom-api <deployment> DELETE "/v2/monitors/<id>"

# Delete dashboard
dashboard-list <deployment> | grep -i cost
dashboard-delete <deployment> <id>
```

**Note:** Running `create-monitors` twice creates duplicates. Delete existing monitors first if re-deploying.

---

## Reference

### Audit Dataset Fields

| Field | Description |
|-------|-------------|
| `action` | `usageCalculated` or `runAPLQueryCost` |
| `properties.hourly_ingest_bytes` | Hourly ingest in bytes |
| `properties.hourly_billable_query_gbms` | Hourly query cost |
| `properties.dataset` | Dataset name |
| `resource.id` | Org ID |
| `actor.email` | User email |

### Common Fields for Value Analysis

| Dataset type | Primary field | Alternatives |
|--------------|---------------|--------------|
| Kubernetes logs | `kubernetes.labels.app` | `kubernetes.namespace_name`, `kubernetes.container_name` |
| Application logs | `app` or `service` | `level`, `logger`, `component` |
| Infrastructure | `host` | `region`, `instance` |
| Traces | `service.name` | `span.kind`, `http.route` |

### Units & Conversions

- Scripts use **TB/day**
- Dashboard filter uses **GB/month**

| Contract | TB/day | GB/month |
|----------|--------|----------|
| 5 PB/month | 167 | 5,000,000 |
| 10 PB/month | 333 | 10,000,000 |
| 15 PB/month | 500 | 15,000,000 |

### Optimization Actions

| Signal | Action |
|--------|--------|
| Work/GB = 0 | Drop or stop ingesting |
| High-volume unqueried values | Sample or reduce log level |
| Empty values from system namespaces | Filter at ingest or accept |
| WoW spike | Check recent deploys |
