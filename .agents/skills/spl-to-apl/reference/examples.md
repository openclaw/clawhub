# SPL to APL Translation Examples

Real-world query translations from common Splunk patterns to APL.

## Basic Searches

### Simple Field Search

```spl
# SPL
index=web_logs status=500 method=POST
```

```apl
# APL
['web_logs']
| where _time between (ago(1h) .. now())
| where status == 500 and method == "POST"
```

### Wildcard Search

```spl
# SPL
index=logs error* OR fail*
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| where message has_cs "error" or message has_cs "fail"
```

### Full-Text Search

```spl
# SPL
index=logs "connection timeout"
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| search "connection timeout"
```

---

## Aggregation Queries

### Count by Field

```spl
# SPL
index=logs 
| stats count by status
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| summarize count() by status
```

### Multiple Aggregations

```spl
# SPL
index=logs
| stats count, dc(user) as unique_users, avg(response_time) as avg_rt by endpoint
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| summarize 
    count(), 
    unique_users = dcount(user), 
    avg_rt = avg(response_time) 
  by endpoint
```

### Top N Values

```spl
# SPL
index=logs
| top 10 uri
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| summarize count() by uri
| top 10 by count_
```

### Rare Values

```spl
# SPL
index=logs
| rare 10 error_code
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| summarize count() by error_code
| order by count_ asc
| take 10
```

---

## Time-Series Analysis

### Timechart Count

```spl
# SPL
index=logs
| timechart span=5m count by status
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| summarize count() by bin(_time, 5m), status
```

### Timechart Percentiles

```spl
# SPL
index=logs
| timechart span=1m perc50(response_time) as p50, perc95(response_time) as p95, perc99(response_time) as p99
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| summarize 
    p50 = percentile(response_time, 50),
    p95 = percentile(response_time, 95),
    p99 = percentile(response_time, 99)
  by bin(_time, 1m)
```

### Error Rate Over Time

```spl
# SPL
index=logs
| timechart span=5m count(eval(status>=500)) as errors, count as total
| eval error_rate = errors/total*100
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| summarize 
    errors = countif(status >= 500),
    total = count()
  by bin(_time, 5m)
| extend error_rate = toreal(errors) / total * 100
```

---

## Field Extraction

### Rex with Named Groups

```spl
# SPL
index=logs
| rex field=message "user=(?<username>\w+) action=(?<action>\w+) duration=(?<dur>\d+)ms"
| table _time, username, action, dur
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| extend username = extract(@"user=(\w+)", 1, message)
| extend action = extract(@"action=(\w+)", 1, message)
| extend dur = toint(extract(@"duration=(\d+)ms", 1, message))
| project _time, username, action, dur
```

### Simple Pattern Extraction

```spl
# SPL
index=logs
| rex field=uri "/api/(?<version>v\d)/(?<resource>\w+)"
| stats count by version, resource
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| parse uri with "/api/" version "/" resource
| summarize count() by version, resource
```

### JSON Extraction

```spl
# SPL
index=logs
| spath input=payload path=user.id output=user_id
| spath input=payload path=request.method output=method
| stats count by user_id, method
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| extend user_id = parse_json(payload)['user']['id']
| extend method = parse_json(payload)['request']['method']
| summarize count() by user_id, method
```

---

## Conditional Logic

### If/Then/Else

```spl
# SPL
index=logs
| eval severity = if(status>=500, "critical", if(status>=400, "warning", "ok"))
| stats count by severity
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| extend severity = case(
    status >= 500, "critical",
    status >= 400, "warning",
    "ok"
)
| summarize count() by severity
```

### Case Statement

```spl
# SPL
index=logs
| eval region = case(
    src_ip LIKE "10.0.%", "us-east",
    src_ip LIKE "10.1.%", "us-west",
    src_ip LIKE "10.2.%", "eu-west",
    1==1, "unknown"
)
| stats count by region
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| extend region = case(
    src_ip startswith "10.0.", "us-east",
    src_ip startswith "10.1.", "us-west",
    src_ip startswith "10.2.", "eu-west",
    "unknown"
)
| summarize count() by region
```

---

## Joins & Lookups

### Inner Join

```spl
# SPL
index=logs
| join type=inner user_id [search index=users | fields user_id, name, email]
| table _time, user_id, name, email, action
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| join kind=inner (
    ['users'] 
    | project user_id, name, email
) on user_id
| project _time, user_id, name, email, action
```

### Left Outer Join

```spl
# SPL
index=logs
| join type=left user_id [search index=users | fields user_id, tier]
| eval tier = coalesce(tier, "free")
| stats count by tier
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| join kind=leftouter (
    ['users'] 
    | project user_id, tier
) on user_id
| extend tier = coalesce(tier, "free")
| summarize count() by tier
```

### Subsearch / In-List

```spl
# SPL
index=logs [search index=errors earliest=-1h | fields user_id | format]
```

```apl
# APL
let error_users = ['errors'] 
    | where _time between (ago(1h) .. now()) 
    | distinct user_id;
['logs']
| where _time between (ago(1h) .. now())
| where user_id in (error_users)
```

---

## Deduplication

### Keep First (Earliest)

```spl
# SPL
index=logs
| sort _time
| dedup user_id
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| summarize arg_min(_time, *) by user_id
```

### Keep Latest

```spl
# SPL
index=logs
| sort - _time
| dedup user_id
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| summarize arg_max(_time, *) by user_id
```

### Keep Earliest

```spl
# SPL
index=logs
| sort _time
| dedup user_id
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| summarize arg_min(_time, *) by user_id
```

---

## Multivalue Operations

### Expand Array

```spl
# SPL
index=logs
| mvexpand tags
| stats count by tags
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| mv-expand tags
| summarize count() by tags
```

### Split String to Array

```spl
# SPL
index=logs
| eval tags = split(tag_string, ",")
| mvexpand tags
| stats count by tags
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| extend tags = split(tag_string, ",")
| mv-expand tags
| summarize count() by tags
```

### Collect to Array

```spl
# SPL
index=logs
| stats list(action) as actions, values(status) as unique_statuses by user_id
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| summarize 
    actions = make_list(action), 
    unique_statuses = make_set(status) 
  by user_id
```

---

## Transaction-Like Queries

### Session Reconstruction

```spl
# SPL
index=logs
| transaction session_id maxspan=30m
| eval duration = _time - earliest_time
| stats avg(duration) as avg_session_duration, count as session_count by user_id
```

```apl
# APL
['logs']
| where _time between (ago(6h) .. now())
| summarize 
    start_time = min(_time),
    end_time = max(_time),
    event_count = count()
  by session_id, user_id
| extend duration = end_time - start_time
| where duration <= 30m
| summarize 
    avg_session_duration = avg(duration), 
    session_count = count() 
  by user_id
```

---

## IP & Geo Analysis

### IP Location

```spl
# SPL
index=logs
| iplocation clientip
| stats count by Country, City
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| extend geo = geo_info_from_ip_address(clientip)
| summarize count() by Country = geo.country, City = geo.city
```

### CIDR Matching

```spl
# SPL
index=logs
| eval is_internal = if(cidrmatch("10.0.0.0/8", src_ip) OR cidrmatch("172.16.0.0/12", src_ip), "internal", "external")
| stats count by is_internal
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| extend is_internal = iff(
    ipv4_is_in_range(src_ip, "10.0.0.0/8") or ipv4_is_in_range(src_ip, "172.16.0.0/12"),
    "internal",
    "external"
)
| summarize count() by is_internal
```

---

## Performance Queries

### Slow Requests

```spl
# SPL
index=logs response_time > 1000
| stats count, avg(response_time) as avg_rt, perc95(response_time) as p95_rt by endpoint
| sort - count
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| where response_time > 1000
| summarize 
    count(), 
    avg_rt = avg(response_time), 
    p95_rt = percentile(response_time, 95) 
  by endpoint
| order by count_ desc
```

### Error Spike Detection

```spl
# SPL
index=logs status>=500
| timechart span=1m count
| where count > 100
```

```apl
# APL
['logs']
| where _time between (ago(1h) .. now())
| where status >= 500
| summarize count() by bin(_time, 1m)
| where count_ > 100
```

---

## Security Queries

### Failed Login Analysis

```spl
# SPL
index=auth action=failed
| stats count by user, src_ip
| where count > 5
| sort - count
```

```apl
# APL
['auth']
| where _time between (ago(1h) .. now())
| where action == "failed"
| summarize count() by user, src_ip
| where count_ > 5
| order by count_ desc
```

### Multiple IPs per User

```spl
# SPL
index=auth action=login
| stats dc(src_ip) as ip_count, values(src_ip) as ips by user
| where ip_count > 3
```

```apl
# APL
['auth']
| where _time between (ago(1h) .. now())
| where action == "login"
| summarize ip_count = dcount(src_ip), ips = make_set(src_ip) by user
| where ip_count > 3
```

---

## Complex Pipelines

### Full Analysis Pipeline

```spl
# SPL
index=logs earliest=-24h
| rex field=uri "/api/(?<version>v\d)/(?<endpoint>\w+)"
| eval is_error = if(status >= 400, 1, 0)
| stats count, sum(is_error) as errors by version, endpoint
| eval error_rate = round(errors/count*100, 2)
| where count > 100
| sort - error_rate
| head 20
```

```apl
# APL
['logs']
| where _time between (ago(24h) .. now())
| parse uri with "/api/" version "/" endpoint
| summarize 
    count(), 
    errors = countif(status >= 400) 
  by version, endpoint
| extend error_rate = round(toreal(errors) / count_ * 100, 2)
| where count_ > 100
| order by error_rate desc
| take 20
```
