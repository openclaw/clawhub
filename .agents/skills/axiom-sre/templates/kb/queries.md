# Queries

Proven APL patterns and query learnings.

---

<!-- Example:

## M-2025-01-10T14:00:00Z error-rate-by-service

- type: query
- tags: errors, service, overview
- used: 12
- last_used: 2025-01-20
- pinned: true
- schema_version: 1

**Query**

```apl
['http-logs']
| where _time between (ago(1h) .. now())
| summarize 
    errors = countif(status >= 500),
    total = count(),
    error_rate = round(toreal(countif(status >= 500)) / count() * 100, 2)
  by service
| order by error_rate desc
```

**When to Use**

First query for any incident - gives overview of which services are affected.

**Usage Notes**

- 2025-01-05 (INC-1234): [helpful] Identified orders-api as only affected service
- 2025-01-12 (INC-1256): [root_cause] Showed auth-service was cascading to others

---

## M-2025-01-10T14:05:00Z latency-percentiles

- type: query
- tags: latency, percentiles, performance
- used: 8
- last_used: 2025-01-19
- pinned: false
- schema_version: 1

**Query**

```apl
['http-logs']
| where _time between (ago(1h) .. now())
| where service == "SERVICE_NAME"
| summarize 
    p50 = percentile(duration_ms, 50),
    p95 = percentile(duration_ms, 95),
    p99 = percentile(duration_ms, 99)
  by bin_auto(_time)
```

**When to Use**

Investigating latency issues. Always check p99, not just average.

---

## M-2025-01-15T11:00:00Z has_cs-vs-contains

- type: query
- tags: performance, contains, has_cs, optimization
- used: 6
- last_used: 2025-01-18
- pinned: true
- schema_version: 1

**Learning**

`has_cs` is 5-10x faster than `contains` for substring searches.

```apl
// Slow
| where message contains "error"

// Fast  
| where message has_cs "error"
```

**Caveats**

- `has_cs` is case-sensitive
- `has_cs` matches word boundaries, `contains` matches anywhere

**Evidence**

- 2025-01-15: Query on 10M rows: contains=12s, has_cs=1.2s

-->
