# APL Functions Reference (Compressed)

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
| `unixtime_seconds_todatetime(n)` | Unix epoch → datetime |

> **Note:** `format_datetime` does not exist in Axiom APL. To format a datetime as a string, use `datetime_part` + `strcat`:
> ```kusto
> extend pretty = strcat(
>   datetime_part("year", dt), "-",
>   iff(datetime_part("month", dt) < 10, strcat("0", tostring(datetime_part("month", dt))), tostring(datetime_part("month", dt))), "-",
>   iff(datetime_part("day", dt) < 10, strcat("0", tostring(datetime_part("day", dt))), tostring(datetime_part("day", dt))), " ",
>   iff(datetime_part("hour", dt) < 10, strcat("0", tostring(datetime_part("hour", dt))), tostring(datetime_part("hour", dt))), ":",
>   iff(datetime_part("minute", dt) < 10, strcat("0", tostring(datetime_part("minute", dt))), tostring(datetime_part("minute", dt)))
> )
> ```

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
