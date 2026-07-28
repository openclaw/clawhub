# Monitor Strategy

## Why Hybrid Monitoring?

**Problem:** Pure anomaly detection learns from historical patterns. If you're already 3x over contract, that overspend becomes your "normal" baseline. Static thresholds (like "40% of hourly budget") are meaningless if that's the steady state.

**Solution:** Hybrid approach combining:

1. **Total Ingest Guard** (Threshold + Trend) - Catches overspend AND gradual growth automatically
2. **Statistical Attribution** (Robust Z-Score) - Detect significant changes, identify which dataset

## The 3 Monitors

| # | Monitor | Type | Reactivity | Purpose |
|---|---------|------|------------|---------|
| 1 | Total Ingest Guard | Threshold + Trend | 2 hours | Catches overspend (>1.2x contract) OR gradual growth (>15% week-over-week) |
| 2 | Per-Dataset Spike | Robust Z-Score | 2+ hours | Attribution: "which dataset's ingest changed" |
| 3 | Query Cost Spike | Hardened Z-Score (30d baseline, 5d gap) | 4+ hours | Attribution: "which dataset's query cost changed" |

## Monitor Details

### 1. Total Ingest Guard

- **Type:** Threshold (on combined overspend OR growth condition)
- **Query:** See below
- **Threshold:** 1 (alert if either condition is true)
- **Frequency:** Hourly
- **Range:** 30 days (43200 minutes)
- **Trigger after:** 2 consecutive runs

**Purpose:** Catches two scenarios in one monitor:
1. **Overspend:** Today's ingest > 1.2x contract (absolute ceiling)
2. **Gradual growth:** 7-day average > 23-day baseline by 15%+ (catches organic creep)

**The Query:**

```apl
['axiom-audit']
| where _time >= ago(30d) and action == "usageCalculated"
| extend bytes = toreal(['properties.hourly_ingest_bytes'])
| summarize daily_bytes = sum(bytes) by day = bin(_time, 1d)
| summarize 
    today = sumif(daily_bytes, day >= ago(24h)),
    recent_7d = avgif(daily_bytes, day >= ago(7d)),
    baseline_23d = avgif(daily_bytes, day < ago(7d)),
    baseline_days = countif(day < ago(7d))
| extend growth_pct = iff(isfinite(baseline_23d) and baseline_23d > 0, (recent_7d - baseline_23d) / baseline_23d * 100, 0)
| extend over_contract = today > <contract_bytes> * 1.2
| extend growing = growth_pct > 15 and baseline_days >= 14
| where over_contract or growing
| summarize alert_count = count()
```

**Key design decisions:**

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Over-contract multiplier | 1.2x | Early warning, not emergency-only |
| Growth threshold | 15% | Catches meaningful growth, not noise |
| Baseline requirement | 14+ days | Ensures stable baseline for growth calculation |
| Division guard | `isfinite() and > 0` | Prevents division by zero on new orgs |
| Sustained condition | `triggerFromNRuns: 2` | Reduces transient false positives |

### 2. Per-Dataset Spike Detection (Robust Z-Score)

- **Type:** Threshold (on robust z-score output)
- **Query:** Log-transform + IQR-based sigma, dual gate (z>3 AND >p99), sustained 2+ hours
- **Threshold:** 1 (any dataset with sustained spikes)
- **Frequency:** Hourly
- **Range:** 7 days (10080 minutes)
- **Trigger after:** 1 run (persistence built into query)

Purpose: Statistical attribution - identifies *which* dataset's ingest pattern changed significantly. Uses robust statistics to avoid false positives on high-variance datasets.

**Why not Spotlight?** Spotlight produces false positives on naturally high-variance datasets (e.g., k8s-events). The robust z-score approach handles this by:
- Log-transforming bytes to tame heavy tails
- Using IQR-based sigma (resistant to outliers) instead of stdev
- Requiring dual gate: z > 3 AND bytes > p99
- Requiring 2+ sustained hours (filters transient noise)

**Query:** See "Robust Z-Score Spike Detection" section below for full query and rationale.

### 3. Query Cost Spike (Hardened)

- **Type:** Threshold (on robust z-score output)
- **Query:** 30d baseline with 5d exclusion gap, persistence-based gating (median_z > 3, p25_z > 2.5)
- **Threshold:** 1 (any dataset with sustained spikes)
- **Frequency:** Hourly
- **Range:** 30 days (43200 minutes)
- **Trigger after:** 1 run (persistence built into query)

Purpose: Detect changes in query cost patterns (different cost driver than ingest). Uses a **hardened** approach developed from a production investigation, where a sustained spike from automated queries poisoned a 15d baseline. Key improvements over the ingest spike detector:

1. **30d baseline with 5d exclusion gap** — `ago(30d)` to `ago(5d)` prevents multi-day sustained spikes from contaminating baseline statistics
2. **Persistence-based gating** — requires `median_z > 3` AND `p25_z > 2.5` (the entire current window must be anomalous, not just the peak hour)
3. **Current window percentiles** — uses `percentileif` (p50, p25) instead of `maxif`, making detection resistant to single-hour outliers
4. **Minimum data requirements** — `baseline_hours >= 168` (7 full days) and `current_hours >= 4`
5. **Floor filter** — `current_p50_gbms > 100,000,000` filters out low-usage noise

**The Query:**

```apl
['axiom-audit']
| where _time >= ago(30d) and action == "usageCalculated"
| extend gbms = toreal(['properties.hourly_billable_query_gbms']), dataset = tostring(['properties.dataset'])
| where isfinite(gbms) and gbms >= 0
| extend is_current = _time >= ago(6h) and _time < bin(now(), 1h)
| extend is_baseline = _time < ago(5d)
| summarize hourly_gbms = sum(gbms) by bucket = bin(_time, 1h), dataset, is_current, is_baseline
| extend hourly_y = log(hourly_gbms + 1)
| summarize 
    current_hours = countif(is_current),
    baseline_hours = countif(is_baseline),
    baseline_y_p50 = percentileif(hourly_y, 50, is_baseline),
    baseline_y_p25 = percentileif(hourly_y, 25, is_baseline),
    baseline_y_p75 = percentileif(hourly_y, 75, is_baseline),
    baseline_gbms_p50 = percentileif(hourly_gbms, 50, is_baseline),
    current_p50_y = percentileif(hourly_y, 50, is_current),
    current_p25_y = percentileif(hourly_y, 25, is_current),
    current_p50_gbms = percentileif(hourly_gbms, 50, is_current)
  by dataset
| where baseline_hours >= 168 and current_hours >= 4
| extend iqr = baseline_y_p75 - baseline_y_p25
| where iqr > 0
| extend sigma_y = iqr / 1.349
| extend median_z = (current_p50_y - baseline_y_p50) / sigma_y
| extend p25_z = (current_p25_y - baseline_y_p50) / sigma_y
| extend excess_gbms = current_p50_gbms - baseline_gbms_p50
| where median_z > 3 and p25_z > 2.5 and excess_gbms > 0 and current_p50_gbms > 100000000
| project dataset, median_z, p25_z, current_p50_gbms, baseline_gbms_p50, excess_gbms
| order by median_z desc
```

**Why the 5d exclusion gap?** If an automated service starts hammering queries without time filters (e.g., scanning 156B rows per query, 255K queries/day), that sustained spike poisons a 15d baseline within 2-3 days — the "new normal" absorbs the anomaly. The 5d gap ensures the baseline never includes recent sustained anomalies.

**Why persistence-based gating (median + p25)?** A single outlier hour can produce `max_z > 3` but a `median_z < 1`. By requiring the 25th percentile of the current window to also be anomalous (`p25_z > 2.5`), we ensure the *entire* window is elevated, not just a transient spike.

## Units

All thresholds are specified in **bytes**. Human-readable output auto-formats to appropriate unit (PB/TB/GB/MB/KB/bytes).

```bash
# Accept bytes or human-readable
--contract 167000000000000
--contract 167TB
--contract 5PB
```

## Robust Z-Score Spike Detection (Recommended)

### Why Replace Spotlight for Per-Dataset Spike Detection?

**Problem:** Spotlight-based detection produces false positives on high-variance datasets. If a dataset has naturally spiky ingest patterns (e.g., k8s-events), Spotlight's p-value will often be significant even during normal operation.

**Solution:** Robust z-score approach using log-transform and IQR-based sigma estimation:

1. **Log transform**: Tames heavy tails (10x spike becomes ~2.3 in log-space)
2. **IQR-based sigma**: Resistant to outlier contamination (unlike stdev)
3. **Dual gate**: Requires BOTH statistical anomaly AND material size
4. **Sustained condition**: Requires 2+ spike hours to filter transient noise

### The Query (Ingest Spike Detection)

**Important:** Uses single-pass approach with conditional aggregation for efficiency and reliability.

```apl
['axiom-audit']
| where _time >= ago(15d) and action == "usageCalculated"
| extend bytes = toreal(['properties.hourly_ingest_bytes']), dataset = tostring(['properties.dataset'])
| where isfinite(bytes) and bytes >= 0
| extend is_current = _time >= ago(4h) and _time < bin(now(), 1h)
| extend is_baseline = _time < ago(1h)
| summarize hourly_bytes = sum(bytes) by bucket = bin(_time, 1h), dataset, is_current, is_baseline
| extend hourly_y = log(hourly_bytes + 1)
| summarize 
    current_hours = countif(is_current),
    baseline_hours = countif(is_baseline),
    baseline_y_p25 = percentileif(hourly_y, 25, is_baseline),
    baseline_y_p50 = percentileif(hourly_y, 50, is_baseline),
    baseline_y_p75 = percentileif(hourly_y, 75, is_baseline),
    baseline_bytes_p99 = percentileif(hourly_bytes, 99, is_baseline),
    baseline_bytes_p50 = percentileif(hourly_bytes, 50, is_baseline),
    current_max_y = maxif(hourly_y, is_current),
    current_max_bytes = maxif(hourly_bytes, is_current)
  by dataset
| where baseline_hours >= 72 and current_hours >= 2
| extend iqr = baseline_y_p75 - baseline_y_p25
| extend sigma_y = iff(iqr / 1.349 > 0.1, iqr / 1.349, 0.1)
| extend max_z = (current_max_y - baseline_y_p50) / sigma_y
| where max_z > 3 and current_max_bytes > baseline_bytes_p99
| extend excess_bytes = current_max_bytes - baseline_bytes_p50
| where excess_bytes > 0
| top 10 by excess_bytes desc
| summarize spike_count = count()
```

The **ingest** spike detection uses the query above. The **query cost** spike detection uses a hardened variant — see "Query Cost Spike (Hardened)" section above for the full query with 30d baseline, 5d exclusion gap, and persistence-based gating.

**Why single-pass instead of join?** The single-pass approach is more efficient and reliable than complex joins with multiple `summarize` operations. It uses `is_current`/`is_baseline` flags with conditional aggregation functions (`countif`, `percentileif`, `maxif`) to compute baseline and current statistics in one pass.

### Key Design Decisions

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Log transform | `log(bytes + 1)` | Compresses heavy-tailed distributions; 10x spike → ~2.3 log units |
| Sum first, then log | `sum() → log()` | Correct order; avoids bias if multiple records per hour |
| Sigma estimation | `IQR / 1.349` | IQR is robust to outliers; 1.349 converts to sigma-equivalent for normal distributions |
| Minimum sigma | `max_of(..., 0.1)` | Prevents division-by-zero on constant datasets |
| Query approach | Single-pass | More efficient and reliable than complex joins; uses conditional aggregation |
| Current window | `ago(4h)` | Short window avoids re-alerting on old spikes |
| Baseline period | 15d (excl. last 1h) | Longer baseline captures weekly patterns; excludes recent data to avoid self-contamination |
| Conditional aggs | `countif`, `percentileif`, `maxif` | Compute baseline and current stats in one pass without joins |
| Baseline guard | `baseline_hours >= 72` | Ensures enough data points for stable percentiles |
| Z-score threshold | `> 3` | Standard anomaly threshold (~0.1% false positive rate for normal data) |
| Relative gate | `> p99_bytes` | Spike must exceed dataset's own p99 (relative materiality) |
| Excess gate | `excess_bytes > 0` | Spike must be above baseline median |
| Persistence filter | `spike_hours >= 2` | Filters transient noise; catches sustained anomalies |
| Rank-based filter | `top 10 by max_excess_bytes` | Only alert on top 10 datasets by cost impact (scale-free) |
| isfinite guard | `isfinite(bytes)` | Filters invalid/null values before log transform |

### Why This Works Better Than Spotlight

| Scenario | Spotlight | Robust Z-Score |
|----------|-----------|----------------|
| High-variance dataset (k8s-events) | False positive (low p-value, high delta) | Correctly filtered (z=2.48 < 3) |
| Genuine 10x spike | True positive | True positive (z=8.06 > 3) |
| Gradual increase over weeks | May miss (adapts baseline) | May miss (same limitation) |
| Transient 1-hour spike | False positive possible | Filtered (requires 2+ hours) |

### Monitor Configuration

When using this query as a threshold monitor:

- **Threshold:** 1 (alert if any dataset has sustained spikes)
- **Operator:** AboveOrEqual on `| summarize count()`
- **Range:** 7 days (10080 minutes)
- **Frequency:** Hourly
- **Trigger after:** 1 run (persistence is built into the query)

### Seasonality Handling

The IQR implicitly handles regular seasonality because:
- IQR measures the *spread* of normal values (25th to 75th percentile)
- Weekly/daily patterns create a wider IQR, which means a higher sigma
- Higher sigma = higher threshold for anomaly detection
- This automatically adjusts sensitivity for high-variance vs stable datasets

## Notifier Configuration

Recommended routing:

| Monitor | Severity | Channel |
|---------|----------|---------|
| Budget Guardrail | Critical | PagerDuty + Slack |
| Per-Dataset Spike | Warning | Slack |
| Query Cost Spike | Warning | Slack |
| Reduction Glidepath | Info | Slack (ops channel) |
