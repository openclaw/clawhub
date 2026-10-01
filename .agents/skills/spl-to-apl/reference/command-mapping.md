# SPL to APL Command Mapping (Complete)

## Search & Filter Commands

| SPL Command | APL Equivalent | Example Translation |
|-------------|----------------|---------------------|
| `search` | Dataset + `where` | `index=logs error` → `['logs'] \| where msg has "error"` |
| `where` | `where` | Same semantics |
| `regex field=x "pattern"` | `where x matches regex "pattern"` | Filter by regex |
| `head N` | `take N` / `limit N` | Get first N results |
| `tail N` | `order by _time asc \| take N` | Reverse and take |
| `sample N` | `extend _r = rand() \| top N by _r \| project-away _r` | APL `sample` takes fraction, not count |
| `dedup field` | `summarize arg_max(_time, *) by field` | Keep latest row per field value |
| `dedup field sortby _time` | `summarize arg_min(_time, *) by field` | Keep earliest row per group |
| `uniq` | `distinct *` | Unique rows (note: loses other columns) |

## Transformation Commands

| SPL Command | APL Equivalent | Notes |
|-------------|----------------|-------|
| `stats` | `summarize` | Core aggregation |
| `eventstats` | `join kind=leftouter (subquery) on keys` | Compute aggregates in subquery, then join |
| `streamstats` | No direct equivalent | Use `summarize` with binning for approximations |
| `chart` | `summarize ... by x, y` | Pivot-like |
| `timechart` | `summarize ... by bin(_time, span)` | Time series |
| `xyseries` | `make-series` + pivot | Create series data |
| `untable` | `mv-expand` with restructure | Unpivot |
| `transpose` | Manual restructure | No direct equivalent |

## Field Manipulation

| SPL Command | APL Equivalent | Notes |
|-------------|----------------|-------|
| `eval` | `extend` | Create/modify fields |
| `rename x as y` | `project-rename y = x` | Rename field |
| `fields x, y, z` | `project x, y, z` | Keep only these fields |
| `fields - x, y` | `project-away x, y` | Remove these fields |
| `table x, y, z` | `project x, y, z` | Display fields |
| `fieldformat` | Use `extend` with format functions | Format display |
| `fillnull value=X` | `extend field = coalesce(field, X)` | Fill nulls |
| `filldown` | No direct equivalent | Pre-process or use `coalesce()` with joins |

## Extraction Commands

| SPL Command | APL Equivalent | Notes |
|-------------|----------------|-------|
| `rex` | `parse` or `extract()` | Regex extraction |
| `erex` | No equivalent | Auto-learn patterns |
| `spath` | `parse_json()` or bracket notation | JSON/XML parsing |
| `xmlkv` | `parse_xml()` | XML extraction |
| `kvform` | `parse-kv` | Key-value parsing |
| `extract` | `parse` | Field extraction |
| `multikv` | Multiple `parse` calls | Multi-line extraction |

### Rex Translation Examples

```
# SPL: Named capture groups
| rex field=msg "user=(?<username>\w+) action=(?<action>\w+)"

# APL: Using parse with regex mode
| parse kind=regex msg with @"user=(?P<username>\w+) action=(?P<action>\w+)"

# APL: Using extract function (one field at a time)
| extend username = extract(@"user=(\w+)", 1, msg)
| extend action = extract(@"action=(\w+)", 1, msg)
```

```
# SPL: Simple pattern (non-regex)
| rex field=uri "/api/(?<version>v\d)/(?<resource>\w+)"

# APL: Using parse with pattern
| parse uri with "/api/" version "/" resource
```

## Sorting & Ordering

| SPL Command | APL Equivalent | Notes |
|-------------|----------------|-------|
| `sort field` | `order by field asc` | Ascending (default) |
| `sort -field` | `order by field desc` | Descending |
| `sort field1, -field2` | `order by field1 asc, field2 desc` | Multi-field |
| `reverse` | `order by _time asc` | Reverse order |
| `top N field` | `summarize count() by field \| top N by count_` | Top N values |
| `rare N field` | `summarize count() by field \| order by count_ asc \| take N` | Bottom N values |

## Join & Combine

| SPL Command | APL Equivalent | Notes |
|-------------|----------------|-------|
| `join type=inner` | `join kind=inner` | **Preview:** inner join |
| `join type=left` | `join kind=leftouter` | **Preview:** left outer join |
| `join type=outer` | `join kind=fullouter` | **Not in preview** - fullouter not yet supported |
| `append` | `union` | Combine datasets vertically |
| `appendcols` | No direct equivalent | No row-number function for joining |
| `multisearch` | Multiple `union` or let statements | Multiple searches |
| `lookup` | `lookup` | Enrich with lookup table |

### Join Examples

```
# SPL
index=logs 
| join user_id [search index=users | fields user_id, name]

# APL
['logs']
| where _time between (ago(1h) .. now())
| join kind=inner (['users'] | project user_id, name) on user_id
```

```
# SPL: Left join
index=logs 
| join type=left user_id [search index=users | fields user_id, name]

# APL
['logs']
| where _time between (ago(1h) .. now())
| join kind=leftouter (['users'] | project user_id, name) on user_id
```

## Multivalue Commands

| SPL Command | APL Equivalent | Notes |
|-------------|----------------|-------|
| `mvexpand field` | `mv-expand field` | Expand array to rows |
| `mvcombine field` | `summarize make_list(field) by ...` | Combine to array |
| `makemv delim=","` | `split(field, ",")` | String to array |
| `nomv field` | `strcat_array(field, ", ")` | Array to string |

### Multivalue Examples

```
# SPL: Expand multivalue field
| mvexpand tags

# APL
| mv-expand tags
```

```
# SPL: Create multivalue from delimited string
| eval tags = split(tag_string, ",")

# APL
| extend tags = split(tag_string, ",")
```

## Time Commands

| SPL Command | APL Equivalent | Notes |
|-------------|----------------|-------|
| `bucket _time span=5m` | `extend _time = bin(_time, 5m)` | Time binning |
| `timechart span=5m` | `summarize ... by bin(_time, 5m)` | Time series aggregation |
| `earliest=-1h latest=now` | `where _time between (ago(1h) .. now())` | Time range |

## Output Commands

| SPL Command | APL Equivalent | Notes |
|-------------|----------------|-------|
| `outputcsv` | Export from UI | No direct equivalent |
| `outputlookup` | Save as lookup | No direct equivalent |
| `collect` | N/A | Write to summary index |
| `sendemail` | Use monitors/alerts | External action |

## Transaction Command (Complex)

Transaction groups related events. APL requires manual reconstruction:

```
# SPL
index=logs 
| transaction session_id maxspan=30m

# APL equivalent (session reconstruction)
['logs']
| where _time between (ago(6h) .. now())
| summarize 
    start = min(_time),
    end = max(_time),
    duration = max(_time) - min(_time),
    event_count = count(),
    events = make_list(pack("time", _time, "action", action, "uri", uri))
  by session_id
| where duration <= 30m
```

## Subsearch / Subquery

```
# SPL: Subsearch
index=logs [search index=errors | fields user_id | format]

# APL: Using let statement
let error_users = ['errors'] 
    | where _time between (ago(1h) .. now()) 
    | distinct user_id;
['logs']
| where _time between (ago(1h) .. now())
| where user_id in (error_users)
```

## Commands with No Direct Equivalent

| SPL Command | Workaround |
|-------------|------------|
| `transaction` | Use `summarize` with `make_list()` and `min()`/`max()` |
| `cluster` | Manual grouping or external clustering |
| `anomalydetection` | Use `spotlight()` for related analysis |
| `predict` | External ML/forecasting |
| `geostats` | Use `geo_info_from_ip_address()` + `summarize` |
| `iplocation` | `extend geo = geo_info_from_ip_address(ip)` |
| `inputlookup` | Use `datatable` for inline data |
| `makeresults` | Use `datatable` or `print` |
