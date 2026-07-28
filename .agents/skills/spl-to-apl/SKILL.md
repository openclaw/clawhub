---
name: spl-to-apl
description: Translates Splunk SPL queries to Axiom APL. Provides command mappings, function equivalents, and syntax transformations. Use when migrating from Splunk, converting SPL queries, or learning APL equivalents of SPL patterns.
---

# SPL to APL Translator

**Type safety:** Fields like status are often stored as strings. Always cast before numeric comparison: toint(status) >= 500, not status >= 500.

---

## Critical Differences

1. **Time is explicit in APL:** SPL time pickers don't translate — add `where _time between (ago(1h) .. now())`
2. **Structure:** SPL `index=... | command` → APL `['dataset'] | operator`
3. **Join is preview:** limited to 50k rows, inner/innerunique/leftouter only
4. **cidrmatch args reversed:** SPL `cidrmatch(cidr, ip)` → APL `ipv4_is_in_range(ip, cidr)`

---

## Core Command Mappings

| SPL | APL | Notes |
|-----|-----|-------|
| `search index=...` | `['dataset']` | Dataset replaces index |
| `search field=value` | `where field == "value"` | Explicit where |
| `where` | `where` | Same |
| `stats` | `summarize` | Different aggregation syntax |
| `eval` | `extend` | Create/modify fields |
| `table` / `fields` | `project` | Select columns |
| `fields -` | `project-away` | Remove columns |
| `rename x as y` | `project-rename y = x` | Rename |
| `sort` / `sort -` | `order by ... asc/desc` | Sort |
| `head N` | `take N` | Limit rows |
| `top N field` | `summarize count() by field \| top N by count_` | Two-step |
| `dedup field` | `summarize arg_max(_time, *) by field` | Keep latest |
| `rex` | `parse` or `extract()` | Regex extraction |
| `join` | `join` | **Preview feature** |
| `append` | `union` | Combine datasets |
| `mvexpand` | `mv-expand` | Expand arrays |
| `timechart span=X` | `summarize ... by bin(_time, X)` | Manual binning |
| `rare N field` | `summarize count() by field \| order by count_ asc \| take N` | Bottom N |
| `spath` | `parse_json()` or `json['path']` | JSON access |
| `transaction` | No direct equivalent | Use summarize + make_list |

Complete mappings: `reference/command-mapping.md`

---

## Stats → Summarize

```
# SPL
| stats count by status

# APL  
| summarize count() by status
```

### Key function mappings

| SPL | APL |
|-----|-----|
| `count` | `count()` |
| `count(field)` | `countif(isnotnull(field))` |
| `dc(field)` | `dcount(field)` |
| `avg/sum/min/max` | Same |
| `median(field)` | `percentile(field, 50)` |
| `perc95(field)` | `percentile(field, 95)` |
| `first/last` | `arg_min/arg_max(_time, field)` |
| `list(field)` | `make_list(field)` |
| `values(field)` | `make_set(field)` |

### Conditional count pattern

```
# SPL
| stats count(eval(status>=500)) as errors by host

# APL
| summarize errors = countif(status >= 500) by host
```

Complete function list: `reference/function-mapping.md`

---

## Eval → Extend

```
# SPL
| eval new_field = old_field * 2

# APL
| extend new_field = old_field * 2
```

### Key function mappings

| SPL | APL | Notes |
|-----|-----|-------|
| `if(c, t, f)` | `iff(c, t, f)` | Double 'f' |
| `case(c1,v1,...)` | `case(c1,v1,...,default)` | Requires default |
| `len(str)` | `strlen(str)` | |
| `lower/upper` | `tolower/toupper` | |
| `substr` | `substring` | 0-indexed in APL |
| `replace` | `replace_string` | |
| `tonumber` | `toint/tolong/toreal` | Explicit types |
| `match(s,r)` | `s matches regex "r"` | Operator |
| `split(s, d)` | `split(s, d)` | Same |
| `mvjoin(mv, d)` | `strcat_array(arr, d)` | Join array |
| `mvcount(mv)` | `array_length(arr)` | Array length |

### Case statement pattern

```
# SPL
| eval level = case(
    status >= 500, "error",
    status >= 400, "warning",
    1==1, "ok"
  )

# APL  
| extend level = case(
    status >= 500, "error",
    status >= 400, "warning",
    "ok"
  )
```

Note: SPL's `1==1` catch-all becomes implicit default in APL.

---

## Rex → Parse/Extract

```
# SPL
| rex field=message "user=(?<username>\w+)"

# APL - parse with regex
| parse kind=regex message with @"user=(?P<username>\w+)"

# APL - extract function  
| extend username = extract("user=(\\w+)", 1, message)
```

### Simple pattern (non-regex)

```
# SPL
| rex field=uri "^/api/(?<version>v\d+)/(?<endpoint>\w+)"

# APL
| parse uri with "/api/" version "/" endpoint
```

---

## Time Handling

SPL time pickers don't translate. Always add explicit time range:

```
# SPL (time picker: Last 24 hours)
index=logs

# APL
['logs'] | where _time between (ago(24h) .. now())
```

### Timechart translation

```
# SPL
| timechart span=5m count by status

# APL
| summarize count() by bin(_time, 5m), status
```

---

## Common Patterns

### Error rate calculation

```
# SPL
| stats count(eval(status>=500)) as errors, count as total by host
| eval error_rate = errors/total*100

# APL
| summarize errors = countif(status >= 500), total = count() by host
| extend error_rate = toreal(errors) / total * 100
```

### Subquery (subsearch)

```
# SPL
index=logs [search index=errors | fields user_id | format]

# APL
let error_users = ['errors'] | where _time between (ago(1h) .. now()) | distinct user_id;
['logs']
| where _time between (ago(1h) .. now())
| where user_id in (error_users)
```

### Join datasets

```
# SPL
| join user_id [search index=users | fields user_id, name]

# APL
| join kind=inner (['users'] | project user_id, name) on user_id
```

### Transaction-like grouping

```
# SPL
| transaction session_id maxspan=30m

# APL (no direct equivalent — reconstruct with summarize)
| summarize 
    start_time = min(_time),
    end_time = max(_time),
    events = make_list(pack("time", _time, "action", action)),
    duration = max(_time) - min(_time)
  by session_id
| where duration <= 30m
```

---

## String Matching Performance

| SPL | APL | Speed |
|-----|-----|-------|
| `field="value"` | `field == "value"` | **Fastest** |
| `field="*value*"` | `field contains "value"` | Moderate |
| `field="value*"` | `field startswith "value"` | Fast |
| `match(field, regex)` | `field matches regex "..."` | **Slowest** |

Prefer `has` over `contains` (word-boundary matching is faster). Use `_cs` variants for case-sensitive (faster).

---

## Reference

- `reference/command-mapping.md` — complete command list
- `reference/function-mapping.md` — complete function list  
- `reference/examples.md` — full query translation examples
- APL docs: https://axiom.co/docs/apl/introduction

