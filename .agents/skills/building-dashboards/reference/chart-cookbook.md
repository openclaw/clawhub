# Chart Cookbook

Detailed APL patterns for each chart type with real-world examples.

> **Note:** Dashboard panel queries inherit time from the UI picker—no explicit `_time` filter needed. The examples below show ad-hoc query patterns with time filters for testing in the Query tab. Remove the `where _time between (...)` line when using these in dashboards.

---

## Statistic

Single-value panels for KPIs and current state.

### Error Rate (Percentage)
```apl
['http-logs']
| where _time between (ago(5m) .. now())
| where service == "api-gateway"
| summarize 
    total = count(),
    errors = countif(status >= 500)
| extend error_rate = round(100.0 * errors / total, 2)
| project error_rate
```

### Current p95 Latency
```apl
['http-logs']
| where _time between (ago(5m) .. now())
| where service == "api-gateway"
| summarize p95 = percentile(duration_ms, 95)
```

### Request Rate (per second)
```apl
['http-logs']
| where _time between (ago(5m) .. now())
| where service == "api-gateway"
| summarize requests = count()
| extend rps = round(requests / 300.0, 1)  // 300 seconds = 5 min
| project rps
```

### Active Errors (count)
```apl
['http-logs']
| where _time between (ago(5m) .. now())
| where status >= 500
| summarize error_count = count()
```

### Comparison to Baseline
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| summarize 
    last_5m = countif(_time >= ago(5m) and status >= 500),
    prev_55m = countif(_time < ago(5m) and status >= 500)
| extend change_pct = round(100.0 * (last_5m - prev_55m/11) / (prev_55m/11 + 0.001), 1)
| project last_5m, change_pct
```

---

## TimeSeries

Time-based trends with proper binning.

### Traffic Over Time
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| where service == "api-gateway"
| summarize requests = count() by bin(_time, 1m)
```

### Error Rate Over Time
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| where service == "api-gateway"
| summarize 
    total = count(),
    errors = countif(status >= 500)
  by bin(_time, 1m)
| extend error_rate = 100.0 * errors / total
| project _time, error_rate
```

### Latency Percentiles Over Time
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| where service == "api-gateway"
| summarize 
    p50 = percentile(duration_ms, 50),
    p95 = percentile(duration_ms, 95),
    p99 = percentile(duration_ms, 99)
  by bin(_time, 1m)
```

### Traffic by Status Class (Stacked)
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| extend status_class = case(
    status < 300, "2xx",
    status < 400, "3xx",
    status < 500, "4xx",
    "5xx"
  )
| summarize count() by bin(_time, 1m), status_class
```

### Multi-Service Comparison
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| where service in ("api-gateway", "auth-service", "payment-service")
| summarize requests = count() by bin(_time, 1m), service
```

### Rate of Change (Derivative)
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| summarize requests = count() by bin(_time, 1m)
| order by _time asc
| extend prev = prev(requests)
| extend rate_change = requests - prev
| where isnotnull(prev)
```

---

## Table

Top-N breakdowns and detailed lists.

### Top 10 Failing Routes
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| where status >= 500
| summarize errors = count() by route
| top 10 by errors
| project Route = route, Errors = errors
```

### Top Error Messages
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| where status >= 500
| summarize count = count() by error_message
| top 10 by count
| project Message = error_message, Count = count
```

### Worst Pods by Error Rate
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| summarize 
    total = count(),
    errors = countif(status >= 500)
  by pod = ['kubernetes.pod.name']
| extend error_rate = round(100.0 * errors / total, 2)
| where total >= 100  // minimum sample size
| top 10 by error_rate
| project Pod = pod, "Error Rate %" = error_rate, Total = total, Errors = errors
```

### Latency by Route
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| summarize 
    requests = count(),
    p50 = percentile(duration_ms, 50),
    p95 = percentile(duration_ms, 95),
    p99 = percentile(duration_ms, 99)
  by route
| top 10 by p95
| project Route = route, Requests = requests, "p50 (ms)" = p50, "p95 (ms)" = p95, "p99 (ms)" = p99
```

### Recent Errors with Details
```apl
['http-logs']
| where _time between (ago(15m) .. now())
| where status >= 500
| top 20 by _time
| project Time = _time, Route = route, Status = status, Message = error_message, TraceID = trace_id
```

### Customer Impact Summary
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| where status >= 500
| summarize 
    errors = count(),
    affected_requests = dcount(trace_id)
  by customer_id
| top 10 by errors
| project Customer = customer_id, Errors = errors, "Affected Requests" = affected_requests
```

---

## Pie

Share-of-total for low-cardinality dimensions only.

### Status Code Distribution
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| extend status_class = case(
    status < 300, "2xx Success",
    status < 400, "3xx Redirect",
    status < 500, "4xx Client Error",
    "5xx Server Error"
  )
| summarize count() by status_class
```

### Traffic by Region
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| summarize count() by region
| top 6 by count_  // Limit slices
```

### Error Types Distribution
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| where status >= 500
| extend error_type = case(
    status == 500, "Internal Error",
    status == 502, "Bad Gateway",
    status == 503, "Service Unavailable",
    status == 504, "Gateway Timeout",
    "Other 5xx"
  )
| summarize count() by error_type
```

### Request Method Mix
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| summarize count() by method
```

**Warning:** If dimension has >6 values, use a Table instead.

---

## LogStream

Raw event inspection with focused fields.

### Recent Errors
```apl
['http-logs']
| where _time between (ago(15m) .. now())
| where status >= 500
| project-keep _time, trace_id, service, route, status, error_message, duration_ms
| order by _time desc
| take 100
```

### Slow Requests
```apl
['http-logs']
| where _time between (ago(15m) .. now())
| where duration_ms > 5000
| project-keep _time, trace_id, service, route, duration_ms, status
| order by duration_ms desc
| take 100
```

### Authentication Failures
```apl
['auth-logs']
| where _time between (ago(1h) .. now())
| where event_type == "login_failed"
| project-keep _time, user_id, ip_address, failure_reason, user_agent
| order by _time desc
| take 100
```

### Kubernetes Events
```apl
['k8s-events']
| where _time between (ago(1h) .. now())
| where type in ("Warning", "Error")
| project-keep _time, type, reason, ['involvedObject.name'], message
| order by _time desc
| take 100
```

### Filtered by Trace ID
```apl
['http-logs']
| where _time between (ago(24h) .. now())
| where trace_id == "abc123xyz"
| project-keep _time, service, route, status, duration_ms, error_message
| order by _time asc
```

---

## SmartFilter

No APL needed—configure these fields for interactive filtering:

### Recommended Filter Fields
- `service` — Which service to focus on
- `environment` — prod/staging/dev
- `region` — Geographic region
- `route` — API endpoint
- `status` — HTTP status code
- `customer_id` — For multi-tenant systems
- `kubernetes.namespace` — K8s namespace
- `kubernetes.pod.name` — Specific pod

### Configuration Tips
- Place SmartFilter at top of dashboard
- Include 3–5 most useful filter dimensions
- Avoid high-cardinality fields as primary filters (trace_id, request_id)

---

## Note

Markdown panels for context and navigation. The chart object carries Markdown in a **top-level `text`** field. There is no `query`, and `text` is **not** wrapped in an `options` object — the create API rejects `options` with `Unrecognized key: "options"`.

```json
{
  "id": "dashboard-header",
  "name": "API Gateway",
  "type": "Note",
  "text": "# API Gateway — Oncall\n\n**Purpose:** Quick triage."
}
```

The recipes below are the Markdown that goes inside `text`. JSON-escape the content (newlines as `\n`, quotes as `\"`) when embedding it as the chart's `text` value.

### Dashboard Header
```markdown
# API Gateway - Oncall Dashboard

**Purpose:** Quick triage for API-related incidents.

**Escalation:** If error rate > 5%, page #platform-oncall.

**Runbook:** [API Incident Response](https://wiki.example.com/api-runbook)
```

### Section Divider
```markdown
---
## Error Analysis
```

### Instructions
```markdown
### How to Use This Dashboard

1. Check the error rate stat (top-left)
2. If elevated, check the "Top Failing Routes" table
3. Click a route to filter logs below
4. Copy trace_id for detailed investigation
```

---

## Heatmap

Visualize distributions and density patterns.

### Latency Distribution Over Time
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| summarize histogram(duration_ms, 20) by bin_auto(_time)
```

### Response Size Distribution
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| summarize histogram(resp_body_size_bytes, 15) by bin_auto(_time)
```

### Request Rate by Hour of Day
```apl
['http-logs']
| where _time between (ago(7d) .. now())
| extend hour = hourofday(_time), day = dayofweek(_time)
| summarize count() by hour, day
```

---

## Scatter Plot

Identify correlations between metrics.

### Latency vs Response Size
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| summarize avg(duration_ms), avg(resp_body_size_bytes) by route
```

### Request Rate vs Error Rate by Route
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| summarize 
    requests = count(),
    error_rate = round(100.0 * countif(status >= 500) / count(), 2)
  by route
| where requests >= 10
```

### CPU vs Memory by Pod
```apl
['metrics']
| where _time between (ago(1h) .. now())
| summarize avg(cpu_percent), avg(memory_percent) by pod
```

---

## Filter Bar

Interactive filters for dashboard-wide filtering.

### Dynamic Country Filter Query
```apl
['http-logs']
| where _time between (ago(1h) .. now())
| distinct ['geo.country']
| project key=['geo.country'], value=['geo.country']
| sort by key asc
```

### Panel Using Filters
```apl
declare query_parameters (_country:string = "", _status:string = "");
['http-logs']
| where _time between (ago(1h) .. now())
| where isempty(_country) or ['geo.country'] == _country
| where isempty(_status) or tostring(status) == _status
| summarize count() by bin_auto(_time)
```

### Dependent City Filter (depends on country)
```apl
declare query_parameters (_country:string = "");
['http-logs']
| where _time between (ago(1h) .. now())
| where isnotempty(['geo.country']) and isnotempty(['geo.city'])
| where ['geo.country'] == _country
| distinct ['geo.city']
| project key=['geo.city'], value=['geo.city']
| sort by key asc
```

### Dataset Selector Filter
For multi-dataset dashboards, let users choose which dataset to view:
```apl
declare query_parameters (_dataset:string = "http-logs");
table(_dataset)
| where _time between (ago(1h) .. now())
| summarize count() by bin_auto(_time)
```
