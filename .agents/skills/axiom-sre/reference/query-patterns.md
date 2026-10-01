# Signal Reading Query Patterns

When you run these with `scripts/axiom-query`, always pass a wrapper window such as `--since 15m` or `--from ... --to ...`. The APL examples below keep explicit `_time` filters because they are good query hygiene, but the wrapper time window is required too.

## Schema & Value Discovery (MANDATORY FIRST STEP)

**Always run schema discovery before writing investigation queries.** Do not guess field names.

```apl
// Step 1: Get schema with types
['dataset'] | where _time > ago(15m) | getschema

// Step 2: Sample raw events to see actual data shape (especially map fields)
['dataset'] | where _time > ago(15m) | take 1

// Step 3: Discover values of low-cardinality fields you plan to filter on
['dataset'] | where _time > ago(15m) | distinct ['kubernetes.labels.app']
['dataset'] | where _time > ago(15m) | summarize count() by ['service.name'] | top 20 by count_
['dataset'] | where _time > ago(15m) | summarize count() by level | top 10 by count_

// Step 4: Discover keys inside map[string] columns (getschema won't show these)
// OTel traces datasets commonly have: attributes, attributes.custom, resource
['dataset'] | where _time > ago(15m) | project ['attributes.custom'] | take 5
['dataset'] | where _time > ago(15m) | project attributes | take 5
```

**Rule:** If your first filter query returns 0 results, run schema discovery before trying another filter.

### Map Type Key Discovery (OTel Traces)

Map columns (`map[string]` type) are common in OTel traces datasets. `getschema` shows the column exists but NOT its internal keys. You must sample to discover them.

```apl
// Sample map column contents
['traces'] | where _time > ago(15m) | project ['attributes.custom'] | take 3

// Enumerate all distinct keys in a map column
['traces'] | where _time > ago(15m)
| extend keys = ['attributes.custom']
| mv-expand keys
| summarize count() by tostring(keys)
| top 30 by count_

// Access specific map values (use bracket notation)
['traces'] | where _time > ago(15m)
| extend status = toint(['attributes.custom']['http.response.status_code']),
         method = tostring(['attributes']['http.method'])
```

Ready-to-use APL queries for common investigation scenarios.

## Error Analysis

```apl
// Error rate over time
['dataset'] | where _time between (ago(1h) .. now()) | where status >= 500 
| summarize count() by bin_auto(_time)

// Errors by service and endpoint
['dataset'] | where _time between (ago(1h) .. now()) | where status >= 500 
| summarize count() by service, uri | top 20 by count_

// Error messages (look for patterns)
['dataset'] | where _time between (ago(1h) .. now()) | where status >= 500 
| summarize count() by message | top 20 by count_
```

## Latency Analysis

```apl
// Latency by individual host (find saturated nodes)
['traces'] | where _time between (ago(1h) .. now()) | where ['service.name'] == '<service>'
| summarize p99=percentile(duration, 99) by ['resource.host.name'], bin(_time, 1m)

// Percentiles over time (logs with duration_ms field)
['dataset'] | where _time between (ago(1h) .. now()) 
| summarize percentiles_array(duration_ms, 50, 95, 99) by bin_auto(_time)

// Percentiles over time (traces with duration timespan field)
['dataset'] | where _time between (ago(1h) .. now()) 
| summarize percentiles_array(duration, 50, 95, 99) by bin_auto(_time)

// What do slow requests have in common?
// Use duration literals for timespan fields: duration > 1s
// Use numeric comparison for ms fields: duration_ms > 1000
['dataset'] | where _time between (ago(1h) .. now()) | where duration_ms > 1000 
| summarize count() by uri, method | top 20 by count_

// Latency distribution
['dataset'] | where _time between (ago(1h) .. now()) 
| summarize histogram(duration_ms, 100)
```

## Spotlight (Automated Root Cause)

`spotlight` compares a problematic cohort against baseline — finds what's statistically different:

```apl
// What distinguishes errors from success?
['dataset'] | where _time between (ago(15m) .. now())
| summarize spotlight(status >= 500, method, uri, ['geo.country'])

// Per-service breakdown
['dataset'] | where _time between (ago(15m) .. now())
| summarize spotlight(status >= 500, method, uri) by service

// What's different about slow requests?
['dataset'] | where _time between (ago(30m) .. now())
| summarize spotlight(duration > 500ms, service, endpoint, status_code)
```

## Correlation Analysis

```apl
// Which service failed first? (cascading failure detection)
['dataset'] | where _time between (ago(1h) .. now()) | where status >= 500 
| summarize first_error = min(_time) by service 
| order by first_error asc | take 5

// Compare error rates before/after a deploy
['dataset'] | where _time between (ago(4h) .. now())
| summarize errors = countif(status >= 500), total = count() by bin(_time, 5m)
| extend error_rate = toreal(errors) / total

// Error rate by region
['dataset'] | where _time between (ago(1h) .. now()) 
| summarize error_rate = toreal(countif(status >= 500)) / count() by region
```

## Traffic Analysis

```apl
// Request rate over time
['dataset'] | where _time between (ago(1h) .. now()) 
| summarize count() by bin(_time, 1m)

// Traffic by endpoint
['dataset'] | where _time between (ago(1h) .. now()) 
| summarize count() by uri, method | top 20 by count_

// Traffic spike detection
['dataset'] | where _time between (ago(1h) .. now()) 
| summarize count() by bin(_time, 10s) | order by _time asc
```

## Request Tracing

```apl
// Follow a single request through the system
['dataset'] | where _time between (ago(1h) .. now()) 
| where request_id == "abc-123"
| order by _time asc
| project _time, service, message, status

// Find related requests (same user, same session)
['dataset'] | where _time between (ago(1h) .. now()) 
| where user_id == "user-456"
| order by _time asc
| project _time, request_id, service, uri, status
```

## General Schema Helpers

```apl
// Top values for any field
['dataset'] | where _time between (ago(1h) .. now()) | summarize topk(field, 10)

// What services exist?
['dataset'] | where _time between (ago(1h) .. now()) | summarize count() by service
```
