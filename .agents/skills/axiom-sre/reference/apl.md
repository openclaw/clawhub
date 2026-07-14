# APL Reference

## Field Name Escaping (CRITICAL)

Field names with special characters (`.`, `/`, `-`) require escaping.

**Schema shows escaped names:**
```
kubernetes.node_labels.karpenter\.sh/nodepool
kubernetes.node_labels.nodepool\.axiom\.co/name
```

**APL syntax:** Use `['field.name']` with `\\.` to escape dots within special field names:
```apl
// Double backslash escapes dots in field names with special chars
['k8s-logs-prod'] | where _time > ago(15m) | distinct ['kubernetes.node_labels.nodepool\\.axiom\\.co/name']
['k8s-logs-prod'] | where _time > ago(15m) | distinct ['kubernetes.node_labels.karpenter\\.sh/nodepool']
```

**Running from shell - use heredoc (RECOMMENDED):**
```bash
# Heredoc with quoted 'EOF' prevents shell expansion - only need \\.
scripts/axiom-query staging --since 15m << 'EOF'
['k8s-logs-prod'] | where _time > ago(15m) | distinct ['kubernetes.node_labels.nodepool\\.axiom\\.co/name']
EOF
```

**Alternative - stdin:**
```bash
# Pipe with $'...' - need \\\\ (quadruple) because shell + APL both escape
echo $'[\'k8s-logs-prod\'] | where _time > ago(15m) | distinct [\'kubernetes.node_labels.nodepool\\\\.axiom\\\\.co/name\']' | scripts/axiom-query staging --since 15m
```

**Alternative - file:**
```bash
# Write query to file (only need \\.), then pipe it in
echo "['k8s-logs-prod'] | where _time > ago(15m) | distinct ['kubernetes.node_labels.nodepool\\.axiom\\.co/name']" > /tmp/q.apl
cat /tmp/q.apl | scripts/axiom-query staging --since 15m
```

**Map field access:** For nested maps, use bracket notation:
```apl
// Access nested map fields
['dataset'] | where _time > ago(15m) | extend value = ['attributes.custom']['key']
['dataset'] | where _time > ago(15m) | extend value = tostring(['attributes']['nested.key'])
```

### Map Type Discovery (CRITICAL for OTel Traces)

Fields typed as `map[string]` in `getschema` (e.g., `attributes`, `attributes.custom`, `resource`, `resource.attributes`) are opaque containers — `getschema` only shows the column name and type `map[string]`, NOT the keys inside. You must discover map contents explicitly.

**Step 1: Identify map columns** — Run `getschema` with an explicit `_time` bound and look for `map` types:
```apl
['traces-dataset'] | where _time > ago(15m) | getschema
// Look for: attributes        map[string]...
//           attributes.custom  map[string]...
//           resource           map[string]...
```

**Step 2: Sample raw events** — The fastest way to see actual map keys:
```apl
// See full event structure including all map keys
['traces-dataset'] | where _time > ago(15m) | take 1

// Project just the map column to reduce noise
['traces-dataset'] | where _time > ago(15m) | project ['attributes.custom'] | take 5
['traces-dataset'] | where _time > ago(15m) | project attributes | take 5
```

**Step 3: Enumerate distinct keys** — For high-cardinality maps, find what keys exist:
```apl
// List keys and their frequency
['traces-dataset'] | where _time > ago(15m)
| extend keys = ['attributes.custom']
| mv-expand keys
| summarize count() by tostring(keys)
| top 30 by count_
```

**Step 4: Access map values in queries** — Use bracket notation:
```apl
// Access a specific key inside a map column
['traces-dataset'] | where _time > ago(15m)
| extend http_status = toint(['attributes.custom']['http.response.status_code'])

// Filter on map values
['traces-dataset'] | where _time > ago(15m)
| where tostring(['attributes.custom']['db.system']) == "redis"

// Multiple map fields
['traces-dataset'] | where _time > ago(15m)
| extend method = tostring(['attributes']['http.method']),
         route = tostring(['attributes']['http.route']),
         status = toint(['attributes']['http.response.status_code'])
```

**Common OTel map columns and what they contain:**
- `attributes` — Span attributes (HTTP method, status, DB queries, custom tags)
- `attributes.custom` — Non-standard/user-defined span attributes
- `resource` — Resource attributes (service.name, host, k8s metadata)
- `resource.attributes` — Additional resource metadata

**WARNING:** Do NOT assume key names inside maps. The same semantic attribute may appear under different keys depending on instrumentation library, OTel SDK version, or custom configuration. Always sample first.

**Common escaped fields in k8s-logs-prod:**
- `kubernetes.node_labels.karpenter\\.sh/nodepool`
- `kubernetes.node_labels.nodepool\\.axiom\\.co/name`
- `kubernetes.labels.app\\.kubernetes\\.io/name`
- `kubernetes.labels.db\\.axiom\\.co/zone`

---

## Time Range (CRITICAL)
**ALWAYS use `between` first** — enables time-based indexing:
```apl
['dataset'] | where _time between (ago(1h) .. now())
['dataset'] | where _time between (datetime(2024-01-15T14:00:00Z) .. datetime(2024-01-15T15:00:00Z))
```

## Tabular Operators

| Operator | Purpose | Example |
|----------|---------|---------|
| `where` | Filter rows | `where _time > ago(1h) and status >= 500` |
| `summarize` | Aggregate | `summarize count() by service` |
| `extend` | Add columns | `extend is_slow = duration > 1000` |
| `project` | Select columns | `project _time, status, uri` |
| `project-away` | Remove columns | `project-away debug_info` |
| `top N by` | Top N rows | `top 10 by duration desc` |
| `order by` | Sort | `order by _time desc` |
| `take` / `limit` | First N rows | `take 100` |
| `count` | Row count | `count` |
| `distinct` | Unique values | `distinct service, method` |
| `search` | Full-text search | `search "error"` |
| `parse` | Extract from strings | `parse msg with * "user=" user " "` |
| `parse-kv` | Extract key-value | `parse-kv msg as (user:string)` |
| `join` | Join tables | `join kind=inner (other) on id` |
| `union` | Combine tables | `union ['dataset-east'], ['dataset-west']` |
| `lookup` | Enrich with table | `lookup LookupTable on id` |
| `mv-expand` | Expand arrays | `mv-expand tags` |
| `make-series` | Time series arrays | `make-series count() on _time step 5m` |
| `sample` | Random sample | `sample 100` |
| `getschema` | Show schema | `getschema` |
| `redact` | Mask sensitive data | `redact email with "***"` |

## String Operators (Performance Order)

**Use `has` over `contains`** — word boundary matching is faster.
**Use `_cs` versions** — case-sensitive is faster.

| Operator | Description | Performance |
|----------|-------------|-------------|
| `==` | Exact match | **Fastest** |
| `has_cs` | Word boundary (case-sensitive) | **Fastest** |
| `has` | Word boundary | Fast |
| `hasprefix_cs` | Starts with word | Fast |
| `hassuffix_cs` | Ends with word | Fast |
| `startswith_cs` | Prefix match | Fast |
| `endswith_cs` | Suffix match | Fast |
| `contains_cs` | Substring (case-sensitive) | Moderate |
| `contains` | Substring | Moderate |
| `in` | In set | Fast |
| `matches regex` | Regex | **Slowest — avoid** |

Negations: `!has`, `!contains`, `!startswith`, `!in`

```apl
// GOOD: Fast
['dataset'] | where _time between (ago(1h) .. now()) | where message has_cs "error"
['dataset'] | where _time between (ago(1h) .. now()) | where uri startswith_cs "/api/v2"
['dataset'] | where _time between (ago(1h) .. now()) | where status in (500, 502, 503)

// SLOW: Avoid
['dataset'] | where _time between (ago(1h) .. now()) | where message matches regex ".*error.*"
```

## Logical Operators
| Operator | Example |
|----------|---------|
| `and` | `status >= 500 and method == "POST"` |
| `or` | `status == 500 or status == 502` |
| `not` | `not (status == 200)` |
| `==`, `!=` | Equality |
| `<`, `<=`, `>`, `>=` | Comparison |

## Arithmetic
| Operator | Example |
|----------|---------|
| `+`, `-`, `*`, `/`, `%` | `duration_ms / 1000` |

## Search Operator (Full-Text)
```apl
// Search all fields (case-insensitive by default)
['logs'] | where _time between (ago(1h) .. now()) | search "error"

// Case-sensitive
['logs'] | where _time between (ago(1h) .. now()) | search kind=case_sensitive "ERROR"

// Field-specific
['logs'] | where _time between (ago(1h) .. now()) | search message:"timeout"

// Wildcards
['logs'] | where _time between (ago(1h) .. now()) | search "error*"        // hasprefix
['logs'] | where _time between (ago(1h) .. now()) | search "*timeout*"     // contains

// Combined
['logs'] | where _time between (ago(1h) .. now()) | search "error" and ("api" or "auth")
```

## Join Kinds
| Kind | Description |
|------|-------------|
| `inner` | Only matching rows |
| `leftouter` | All left + matching right (nulls for no match) |
| `rightouter` | All right + matching left |
| `fullouter` | All rows from both |
| `leftanti` | Left rows with no match |
| `leftsemi` | Left rows with match |

```apl
['requests'] | where _time between (ago(1h) .. now()) | join kind=inner (['users'] | where _time between (ago(1h) .. now())) on user_id
['logs'] | where _time between (ago(1h) .. now()) | join kind=leftouter (['metadata'] | where _time between (ago(1h) .. now())) on $left.id == $right.log_id
```

## Parse Operator
```apl
// Simple pattern
['logs'] | where _time between (ago(1h) .. now()) | parse uri with * "/api/" version "/" endpoint

// With types
['logs'] | where _time between (ago(1h) .. now()) | parse message with * "duration=" duration:int "ms"

// Regex mode
['logs'] | where _time between (ago(1h) .. now()) | parse kind=regex message with @"user=(?P<user>\w+)"
```

## Lookup Operator (Enrich Data)
```apl
let LookupTable = datatable(code:int, meaning:string)[
  200, "OK", 
  500, "Internal Error"
];
['logs'] | where _time between (ago(1h) .. now()) | lookup LookupTable on $left.status == $right.code
```

## Make-Series (Time Series Arrays)
```apl
// Create array-based time series for series_* functions
['logs'] | make-series count() default=0 on _time from ago(1h) to now() step 5m
['logs'] | make-series avg(duration) on _time from ago(1h) to now() step 10m by service
```

## Aggregation Functions (use with `summarize`)

### Counting
| Function | Description |
|----------|-------------|
| `count()` | Count all rows |
| `countif(predicate)` | Count where condition true |
| `dcount(field)` | Count distinct values |
| `dcountif(field, predicate)` | Distinct count with condition |

### Statistics
| Function | Description |
|----------|-------------|
| `sum(field)` | Sum values |
| `sumif(field, predicate)` | Sum with condition |
| `avg(field)` | Average |
| `avgif(field, predicate)` | Average with condition |
| `min(field)` / `max(field)` | Min/max values |
| `minif()` / `maxif()` | Min/max with condition |
| `stdev(field)` | Standard deviation |
| `variance(field)` | Variance |

### Percentiles (SRE Essential)
```apl
percentile(field, N)                    // Single percentile
percentiles_array(field, 50, 95, 99)    // Multiple percentiles as array (preferred)
percentileif(field, 99, predicate)      // With condition
```

### Row Selection
| Function | Description |
|----------|-------------|
| `arg_max(field, *)` | Row with max value |
| `arg_min(field, *)` | Row with min value |

### Collections
| Function | Description |
|----------|-------------|
| `make_list(field)` | Collect into array |
| `make_set(field)` | Collect unique into array |
| `make_bag(field)` | Merge JSON objects |

### Top-K (Estimated, Fast)
```apl
topk(field, N)                    // Top N values (estimated)
topkif(field, N, predicate)       // Top N with condition
```
Note: `topk` is fast but estimated. Use `top` operator for exact results.

### Rate (Per-Second)
```apl
rate(field)                       // Rate per second over query window
rate(field) by bin(_time, 1m)     // Rate per second, bucketed by minute
```

### Histogram (Distribution)
```apl
histogram(field, num_bins)        // Distribution buckets
histogram(duration_ms, 100)       // 100ms buckets
```

### Spotlight (Root Cause Analysis) — SRE Essential!
Compare a cohort against baseline to find what's statistically different (like Honeycomb BubbleUp):
```apl
// What distinguishes errors from normal traffic?
['logs'] 
| where _time between (ago(15m) .. now())
| summarize spotlight(status >= 500, ['geo.country'], method, uri, duration_ms)

// What's different about slow requests?
['traces'] 
| where _time between (ago(30m) .. now())
| summarize spotlight(duration > 500ms, service, endpoint, status_code)

// Per-service: what's causing each service's errors?
['logs'] 
| where _time between (ago(15m) .. now())
| summarize spotlight(status >= 500, method, uri, ['geo.country']) by service

// Time-based comparison: what changed in last 6h vs baseline?
['audit'] 
| where _time between (ago(7d) .. now())
| summarize spotlight(_time > ago(6h), dataset, source)
```

**Extracting Spotlight Metrics in APL:**
```apl
// Extract p_value and delta_score for threshold monitoring
| summarize result = spotlight(_time > ago(6h), bytes) by dataset
| mv-expand result
| extend p_value = toreal(result.p_value), delta_score = toreal(result.delta_score)
| where p_value < 0.05  // statistically significant
| summarize max_delta = max(delta_score)
```

**Key Metrics (from spotlight output):**
| Metric | Range | Meaning |
|--------|-------|---------|
| `p_value` | 0-1 | Statistical significance (< 0.05 = significant) |
| `delta_score` | 0-1 | Distribution difference (higher = more different) |
| `effect_size` | 0-∞ | Magnitude accounting for sample size |
| `median_relative_change` | -1 to +1 | Direction of change |

**Note:** Spotlight needs sufficient samples (n >= 6) for statistical significance.

### Presence (Field Analysis) — Finding Sparse/Unused Columns
Returns a map of `{field_name: non_null_count}` for all fields in scanned rows:
```apl
// Find field presence across all columns
['logs'] 
| where _time >= ago(60d) 
| summarize presence(*)

// Parse output with jq to find sparse fields:
// jq '.tables[0].columns[0][0] | to_entries | sort_by(.value)'
```
Compare counts against total row count to calculate presence percentage. Useful for identifying unused columns before schema cleanup.

### Phrases (Text Analysis)
```apl
phrases(text_field, max_phrases)  // Extract common phrases
phrases(message, 10)              // Top 10 phrases
```

### Time Binning
```apl
bin_auto(_time)        // Auto-select bin size
bin(_time, 5m)         // Fixed 5-minute bins
bin(_time, 1h)         // Hourly bins
```

## Scalar Functions

### Datetime
| Function | Description |
|----------|-------------|
| `now()` | Current UTC time |
| `ago(timespan)` | Time in past: `ago(1h)`, `ago(7d)` |
| `datetime(string)` | Parse: `datetime("2024-01-15T14:00:00Z")` |
| `datetime_add(part, n, dt)` | Add to datetime |
| `datetime_diff(part, dt1, dt2)` | Difference |
| `datetime_part(part, dt)` | Extract part: `"hour"`, `"day"` |
| `startofday/week/month/year(dt)` | Period start |
| `endofday/week/month/year(dt)` | Period end |
| `dayofweek/month/year(dt)` | Day number |
| `getyear(dt)` / `getmonth(dt)` | Year/month number |
| `hourofday(dt)` | Hour (0-23) |
| `format_datetime(dt, fmt)` | Format to string |
| `unixtime_seconds_todatetime(n)` | Unix epoch → datetime |

### Time Literals
| Literal | Duration |
|---------|----------|
| `1s`, `1m`, `1h`, `1d`, `1w` | Second, minute, hour, day, week |

### String
| Function | Description |
|----------|-------------|
| `strlen(s)` | Length |
| `tolower(s)` / `toupper(s)` | Case conversion |
| `trim(s)` / `trim_start(s)` / `trim_end(s)` | Whitespace |
| `substring(s, start, len)` | Extract substring |
| `split(s, delim)` | Split to array |
| `strcat(s1, s2, ...)` | Concatenate |
| `replace_string(s, old, new)` | Replace |
| `extract(regex, group, s)` | Regex extract |
| `extract_all(regex, s)` | All matches |
| `parse_json(s)` | Parse JSON (expensive!) |
| `parse_url(s)` | Parse URL components |
| `countof(s, substr)` | Count occurrences |

### Conditional
```apl
iff(condition, then, else)                           // If-then-else
iif(condition, then, else)                           // Alias for iff
case(cond1, val1, cond2, val2, ..., default)         // Multiple conditions
coalesce(v1, v2, ...)                                // First non-null
```

```apl
// Severity classification
| extend severity = case(
    status >= 500, "error",
    status >= 400, "warning",
    "ok"
)
```

### Type Checking & Conversion
| Function | Description |
|----------|-------------|
| `isnull(v)` / `isnotnull(v)` | Null check |
| `isempty(v)` / `isnotempty(v)` | Empty string check |
| `tostring(v)` | Convert to string |
| `toint(v)` / `tolong(v)` | Convert to int |
| `toreal(v)` | Convert to float |
| `tobool(v)` | Convert to boolean |
| `todatetime(v)` | Convert to datetime |

### IP Functions
| Function | Description |
|----------|-------------|
| `geo_info_from_ip_address(ip)` | Geo lookup |
| `ipv4_is_private(ip)` | Check if private IP |
| `ipv4_is_in_range(ip, cidr)` | CIDR match |
| `ipv4_is_match(ip, pattern)` | Pattern match |
| `ipv4_compare(ip1, ip2)` | Compare IPs |
| `parse_ipv4(s)` | Parse to long |

```apl
// Geo enrichment
| extend geo = geo_info_from_ip_address(client_ip)
| extend country = geo.country, city = geo.city
```

### Array Functions
| Function | Description |
|----------|-------------|
| `array_length(arr)` | Length |
| `array_concat(a1, a2)` | Concatenate |
| `array_index_of(arr, val)` | Find index |
| `array_slice(arr, start, end)` | Slice |
| `array_sum(arr)` | Sum elements |
| `pack_array(v1, v2, ...)` | Create array |

### Math
| Function | Description |
|----------|-------------|
| `abs(v)` | Absolute value |
| `floor(v)` / `ceiling(v)` | Round down/up |
| `round(v, precision)` | Round |
| `log(v)` / `log10(v)` | Logarithm |
| `pow(base, exp)` | Power |
| `sqrt(v)` | Square root |

## Common SRE Patterns

### Error Rate Over Time
```apl
['logs'] 
| where _time between (ago(1h) .. now())
| summarize 
    errors = countif(status >= 500), 
    total = count() 
  by bin(_time, 5m)
| extend error_rate = toreal(errors) / total * 100
```

### Latency Percentiles
```apl
['logs'] 
| where _time between (ago(1h) .. now())
| summarize percentiles_array(duration_ms, 50, 95, 99) by bin_auto(_time)
```

### Top Errors by Endpoint
```apl
['logs'] 
| where _time between (ago(1h) .. now())
| where status >= 500
| summarize count() by uri, status 
| top 20 by count_
```

### Find First Error Per Service
```apl
['logs'] 
| where _time between (ago(1h) .. now())
| where status >= 500
| summarize first_error = min(_time) by service
| order by first_error asc
```

### Spotlight: Why Are These Requests Failing?
```apl
['logs'] 
| where _time between (ago(15m) .. now())
| summarize spotlight(status >= 500, ['geo.country'], method, uri, duration_ms)
```

## Differential Analysis (Spotlight)

Compare a time window (bad) against a baseline (good) to find what changed:

```bash
# Compare last 30m (bad) to the 30m before that (good)
scripts/axiom-query <env> --since 1h <<< "['dataset'] | summarize spotlight(_time > ago(30m), service, user_agent, region, status)"
```

**Parsing Spotlight with jq:**
```bash
# Summary: all dimensions with top finding
scripts/axiom-query <env> --since 1h --raw <<< "..." | jq '.. | objects | select(.differences?)
  | {dim: .dimension, effect: .delta_score,
     top: (.differences | sort_by(-.frequency_ratio) | .[0] | {v: .value[0:60], r: .frequency_ratio, c: .comparison_count})}'

# Top 5 OVER-represented values (ratio=1 means ONLY during problem)
scripts/axiom-query <env> --since 1h --raw <<< "..." | jq '.. | objects | select(.differences?)
  | {dim: .dimension, over: [.differences | sort_by(-.frequency_ratio) | .[:5] | .[]
     | {v: .value[0:60], r: .frequency_ratio, c: .comparison_count}]}'
```

**Interpreting Spotlight:**
- `frequency_ratio > 0`: Value appears MORE during problem (potential cause)
- `frequency_ratio < 0`: Value appears LESS during problem
- `effect_size`: How strongly dimension explains difference (higher = more important)
