# SPL to APL Test Queries

Test the skill by translating these SPL queries to APL and running in [Axiom Playground](https://play.axiom.co).

## Test Cases for sample-http-logs

### 1. Basic count by status
**SPL:**
```spl
index=sample-http-logs | stats count by status
```

**Expected APL:**
```apl
['sample-http-logs']
| where _time between (ago(1h) .. now())
| summarize count() by status
```

### 2. Top 10 URIs
**SPL:**
```spl
index=sample-http-logs | top limit=10 uri
```

**Expected APL:**
```apl
['sample-http-logs']
| where _time between (ago(1h) .. now())
| summarize count() by uri
| top 10 by count_
```

### 3. Error rate over time
**SPL:**
```spl
index=sample-http-logs | timechart span=5m count(eval(status>=500)) as errors, count as total | eval error_rate=errors/total*100
```

**Expected APL:**
```apl
['sample-http-logs']
| where _time between (ago(1h) .. now())
| summarize errors = countif(toint(status) >= 500), total = count() by bin(_time, 5m)
| extend error_rate = toreal(errors) / total * 100
```

> **Note:** The `status` field in sample-http-logs is a string, so `toint()` is needed for numeric comparison.

### 4. Request duration percentiles
**SPL:**
```spl
index=sample-http-logs | stats perc50(req_duration_ms) as p50, perc95(req_duration_ms) as p95, perc99(req_duration_ms) as p99 by method
```

**Expected APL:**
```apl
['sample-http-logs']
| where _time between (ago(1h) .. now())
| summarize 
    p50 = percentile(req_duration_ms, 50),
    p95 = percentile(req_duration_ms, 95),
    p99 = percentile(req_duration_ms, 99)
  by method
```

### 5. Geo distribution
**SPL:**
```spl
index=sample-http-logs | iplocation clientip | stats count by Country, City | sort - count | head 20
```

**Expected APL:**
```apl
['sample-http-logs']
| where _time between (ago(1h) .. now())
| summarize count() by ['geo.country'], ['geo.city']
| order by count_ desc
| take 20
```

> **Note:** The sample-http-logs dataset already has pre-computed `geo.country` and `geo.city` fields. If your dataset has a raw IP field, use `geo_info_from_ip_address(clientip)` to look up the geo data.

### 6. Unique users per endpoint
**SPL:**
```spl
index=sample-http-logs | stats dc(id) as unique_users, count as requests by uri | sort - unique_users
```

**Expected APL:**
```apl
['sample-http-logs']
| where _time between (ago(1h) .. now())
| summarize unique_users = dcount(id), requests = count() by uri
| order by unique_users desc
```

### 7. Conditional field creation
**SPL:**
```spl
index=sample-http-logs | eval severity=if(status>=500, "error", if(status>=400, "warning", "ok")) | stats count by severity
```

**Expected APL:**
```apl
['sample-http-logs']
| where _time between (ago(1h) .. now())
| extend severity = case(
    toint(status) >= 500, "error",
    toint(status) >= 400, "warning",
    "ok"
)
| summarize count() by severity
```

> **Note:** The `status` field in sample-http-logs is a string, so `toint()` is needed for numeric comparison.

## Test Cases for otel-demo-traces

### 8. Span duration by service
**SPL:**
```spl
index=otel-demo-traces | stats avg(duration) as avg_duration, perc95(duration) as p95_duration by service.name
```

**Expected APL:**
```apl
['otel-demo-traces']
| where _time between (ago(1h) .. now())
| summarize 
    avg_duration = avg(duration),
    p95_duration = percentile(duration, 95)
  by ['service.name']
```

### 9. Error spans over time
**SPL:**
```spl
index=otel-demo-traces status_code="ERROR" | timechart span=1m count by service.name
```

**Expected APL:**
```apl
['otel-demo-traces']
| where _time between (ago(1h) .. now())
| where status_code == "ERROR"
| summarize count() by bin(_time, 1m), ['service.name']
```

## How to Test

1. Load the spl-to-apl skill
2. Ask to translate each SPL query
3. Run the resulting APL in https://play.axiom.co
4. Verify results are returned without errors

## Validation Checklist

- [x] Query 1: Basic count by status ✅
- [x] Query 2: Top 10 URIs ✅
- [x] Query 3: Error rate over time ✅ (fixed: needs `toint(status)`)
- [x] Query 4: Request duration percentiles ✅
- [x] Query 5: Geo distribution ✅ (adapted: uses existing geo fields)
- [x] Query 6: Unique users per endpoint ✅
- [x] Query 7: Conditional field creation ✅ (fixed: needs `toint(status)`)
- [x] Query 8: Span duration by service ✅
- [x] Query 9: Error spans over time ✅

**Last validated:** 2026-01-20 via Axiom Playground (play.axiom.co)
