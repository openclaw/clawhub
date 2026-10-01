# SPL to APL Function Mapping (Complete)

## Aggregation Functions (stats/summarize)

| SPL Function | APL Function | Notes |
|--------------|--------------|-------|
| `count` | `count()` | Parentheses required in APL |
| `count(field)` | `countif(isnotnull(field))` | Count non-null values |
| `dc(field)` | `dcount(field)` | Distinct count |
| `distinct_count(field)` | `dcount(field)` | Same as dc |
| `estdc(field)` | `dcount(field)` | APL uses approximation by default |
| `sum(field)` | `sum(field)` | Same |
| `avg(field)` | `avg(field)` | Same |
| `mean(field)` | `avg(field)` | Use avg |
| `min(field)` | `min(field)` | Same |
| `max(field)` | `max(field)` | Same |
| `range(field)` | `max(field) - min(field)` | Calculate manually |
| `stdev(field)` | `stdev(field)` | Sample stdev |
| `stdevp(field)` | `stdev(field)` | APL only has sample stdev (no population variant) |
| `var(field)` | `variance(field)` | Sample variance |
| `varp(field)` | `variance(field)` | APL only has sample variance (no population variant) |
| `median(field)` | `percentile(field, 50)` | Use percentile |
| `mode(field)` | `topk(field, 1)` | Most frequent value |
| `first(field)` | `arg_min(_time, field)` | First value by time |
| `last(field)` | `arg_max(_time, field)` | Last value by time |
| `earliest(field)` | `min(field)` | Earliest (min) value |
| `latest(field)` | `max(field)` | Latest (max) value |
| `earliest_time` | `min(_time)` | Earliest timestamp |
| `latest_time` | `max(_time)` | Latest timestamp |
| `list(field)` | `make_list(field)` | Collect all values |
| `values(field)` | `make_set(field)` | Collect unique values |
| `perc<N>(field)` | `percentile(field, N)` | e.g., perc95 → percentile(field, 95) |
| `p<N>(field)` | `percentile(field, N)` | Same |
| `percentile(field, 50, 95, 99)` | `percentiles_array(field, 50, 95, 99)` | Multiple percentiles |
| `exactperc<N>(field)` | `percentile(field, N)` | APL approximates |
| `rate(field)` | `rate(field)` | Per-second rate |
| `per_second(field)` | `rate(field)` | Same |
| `per_minute(field)` | `rate(field) * 60` | Calculate |
| `per_hour(field)` | `rate(field) * 3600` | Calculate |

### Aggregation Examples

```
# SPL
| stats count, dc(user) as unique_users, avg(duration), perc95(duration) by host

# APL
| summarize 
    count(), 
    unique_users = dcount(user), 
    avg(duration), 
    percentile(duration, 95) 
  by host
```

```
# SPL: Conditional aggregation
| stats count(eval(status="error")) as errors, count as total

# APL
| summarize errors = countif(status == "error"), total = count()
```

---

## Eval/Extend Functions

### Comparison & Conditional

| SPL Function | APL Function | Notes |
|--------------|--------------|-------|
| `if(cond, true, false)` | `iff(cond, true, false)` | Double 'f' in APL |
| `case(c1,v1, c2,v2, ...)` | `case(c1, v1, c2, v2, default)` | APL requires default |
| `coalesce(a, b, c)` | `coalesce(a, b, c)` | Same |
| `null()` | `dynamic(null)` or typed: `string(null)` | Typed null literals |
| `nullif(a, b)` | `iff(a == b, null, a)` | Manual implementation |
| `validate(c1,v1, c2,v2)` | Use `iff()` or `case()` | No direct equivalent |
| `true()` | `true` | Literal, not function |
| `false()` | `false` | Literal, not function |
| `searchmatch("query")` | `has "query"` or `contains "query"` | Pattern matching |
| `match(str, regex)` | `str matches regex "pattern"` | Regex match |
| `like(str, pattern)` | `str startswith/endswith/contains` | Use string operators |
| `in(field, v1, v2, ...)` | `field in ("v1", "v2", ...)` | Operator syntax |
| `cidrmatch(cidr, ip)` | `ipv4_is_in_range(ip, cidr)` | Args reversed |

### Conditional Examples

```
# SPL
| eval severity = if(status >= 500, "error", if(status >= 400, "warning", "ok"))

# APL
| extend severity = case(
    status >= 500, "error",
    status >= 400, "warning",
    "ok"
)
```

```
# SPL
| eval result = case(
    status == 200, "success",
    status == 404, "not found",
    status >= 500, "server error",
    1==1, "other"
)

# APL
| extend result = case(
    status == 200, "success",
    status == 404, "not found",
    status >= 500, "server error",
    "other"
)
```

---

### String Functions

| SPL Function | APL Function | Notes |
|--------------|--------------|-------|
| `len(str)` | `strlen(str)` | String length |
| `lower(str)` | `tolower(str)` | Lowercase |
| `upper(str)` | `toupper(str)` | Uppercase |
| `ltrim(str, chars)` | `trim_start(str, chars)` | Left trim |
| `rtrim(str, chars)` | `trim_end(str, chars)` | Right trim |
| `trim(str, chars)` | `trim(str, chars)` | Both sides |
| `substr(str, start, len)` | `substring(str, start, len)` | Substring (0-indexed in APL) |
| `replace(str, old, new)` | `replace_string(str, old, new)` | String replace |
| `replace(str, regex, new)` | `replace_regex(str, regex, new)` | Regex replace |
| `split(str, delim)` | `split(str, delim)` | Same |
| `strcat(a, b, c)` | `strcat(a, b, c)` | Same |
| `urldecode(str)` | `url_decode(str)` | URL decode |
| `printf(fmt, args)` | Use `strcat()` with `tostring()` | No printf |
| `spath(json, path)` | `json['path']` or `parse_json(json)['path']` | JSON access |

### String Examples

```
# SPL
| eval domain = replace(email, "^.*@", "")

# APL
| extend domain = replace_regex(email, @"^.*@", "")
```

```
# SPL
| eval parts = split(uri, "/")
| eval version = mvindex(parts, 2)

# APL
| extend parts = split(uri, "/")
| extend version = parts[2]
```

---

### Math Functions

| SPL Function | APL Function | Notes |
|--------------|--------------|-------|
| `abs(x)` | `abs(x)` | Same |
| `ceil(x)` / `ceiling(x)` | `ceiling(x)` | Round up |
| `floor(x)` | `floor(x)` | Round down |
| `round(x, n)` | `round(x, n)` | Round to n decimals |
| `sqrt(x)` | `sqrt(x)` | Same |
| `pow(x, y)` | `pow(x, y)` | Same |
| `exp(x)` | `exp(x)` | Same |
| `ln(x)` | `log(x)` | Natural log |
| `log(x, base)` | `log(x) / log(base)` | Calculate base |
| `log10(x)` | `log10(x)` | Base-10 log |
| `log2(x)` | `log2(x)` | Base-2 log |
| `pi()` | `pi()` | Same |
| `random()` | `rand()` | Random number (0-1 in APL) |
| `min(a, b, c)` | `min_of(a, b, c)` | Scalar min |
| `max(a, b, c)` | `max_of(a, b, c)` | Scalar max |
| `sigfig(x, n)` | `round(x, n)` | Use round |
| `exact(x)` | N/A | Exact comparison |

---

### Date/Time Functions

| SPL Function | APL Function | Notes |
|--------------|--------------|-------|
| `now()` | `now()` | Same |
| `time()` | `now()` | Current time |
| `strftime(_time, format)` | Use `datetime_part()` + `strcat()` | No direct equivalent |
| `strptime(str, format)` | `todatetime(str)` | Parse datetime |
| `relative_time(time, mod)` | Use `datetime_add()` | Manual calculation |

### Time Format Conversion

**Note:** APL has no `format_datetime`. Use these alternatives:

| SPL Pattern | APL Alternative |
|-------------|-----------------|
| `strftime(_time, "%Y")` | `getyear(_time)` |
| `strftime(_time, "%m")` | `getmonth(_time)` |
| `strftime(_time, "%d")` | `dayofmonth(_time)` |
| `strftime(_time, "%H")` | `hourofday(_time)` |
| `strftime(_time, "%Y-%m-%d")` | `tostring(_time)` then parse, or use `startofday()` |
| Full datetime string | `tostring(_time)` returns ISO format |

### Time Examples

```
# SPL
| eval date_str = strftime(_time, "%Y-%m-%d")
| eval hour = strftime(_time, "%H")

# APL (no format_datetime - use tostring or datetime_part)
| extend date_str = tostring(_time)  // Returns ISO format
| extend hour = hourofday(_time)
```

```
# SPL
| eval start_of_day = relative_time(now(), "@d")

# APL
| extend start_of_day = startofday(now())
```

---

### Type Conversion

| SPL Function | APL Function | Notes |
|--------------|--------------|-------|
| `tonumber(str)` | `toint(str)` / `tolong(str)` / `toreal(str)` | Explicit types |
| `tostring(val)` | `tostring(val)` | Same |
| `tostring(val, "hex")` | N/A | No hex conversion |
| `typeof(val)` | `gettype(val)` | Type checking |
| `isnull(val)` | `isnull(val)` | Same |
| `isnotnull(val)` | `isnotnull(val)` | Same |
| `isnum(val)` | Use `isnan(toreal(val))` | Check if numeric |
| `isint(val)` | Check after `toint()` | No direct function |
| `isstr(val)` | Use `gettype(val) == "string"` | Type check |

---

### Multivalue Functions

| SPL Function | APL Function | Notes |
|--------------|--------------|-------|
| `mvcount(mv)` | `array_length(arr)` | Array length |
| `mvindex(mv, idx)` | `arr[idx]` | Array indexing (0-based) |
| `mvindex(mv, start, end)` | `array_slice(arr, start, end)` | Array slice |
| `mvappend(mv1, mv2)` | `array_concat(arr1, arr2)` | Concatenate |
| `mvjoin(mv, delim)` | `strcat_array(arr, delim)` | Join to string |
| `mvsort(mv)` | `array_sort_asc(arr)` | Sort array |
| `mvdedup(mv)` | Dedupe via `make_set()` | Remove duplicates |
| `mvfilter(predicate)` | `array_iff(arr, predicate)` | Filter array elements |
| `mvfind(mv, regex)` | `array_index_of(arr, val)` | Find index |
| `mvzip(mv1, mv2, delim)` | Manual with `mv-expand` + join | Complex |
| `mvrange(start, end, step)` | `range(start, end, step)` | Generate sequence |

### Multivalue Examples

```
# SPL
| eval tag_count = mvcount(tags)
| eval first_tag = mvindex(tags, 0)
| eval tag_str = mvjoin(tags, ", ")

# APL
| extend tag_count = array_length(tags)
| extend first_tag = tags[0]
| extend tag_str = strcat_array(tags, ", ")
```

---

### Cryptographic Functions

| SPL Function | APL Function | Notes |
|--------------|--------------|-------|
| `md5(str)` | `hash_md5(str)` | MD5 hash |
| `sha1(str)` | `hash_sha1(str)` | SHA-1 hash |
| `sha256(str)` | `hash_sha256(str)` | SHA-256 hash |
| `sha512(str)` | `hash_sha512(str)` | SHA-512 hash |

---

### IP Functions

| SPL Function | APL Function | Notes |
|--------------|--------------|-------|
| `cidrmatch(cidr, ip)` | `ipv4_is_in_range(ip, cidr)` | Args reversed! |
| `iplocation(ip)` | `geo_info_from_ip_address(ip)` | Returns object |

### IP Examples

```
# SPL
| eval is_internal = cidrmatch("10.0.0.0/8", src_ip)

# APL
| extend is_internal = ipv4_is_in_range(src_ip, "10.0.0.0/8")
```

```
# SPL
| iplocation clientip
| table clientip, City, Country

# APL
| extend geo = geo_info_from_ip_address(clientip)
| extend City = geo.city, Country = geo.country
| project clientip, City, Country
```

---

### JSON Functions

| SPL Function | APL Function | Notes |
|--------------|--------------|-------|
| `spath(json, path)` | `parse_json(json)['path']` or direct access | JSON path |
| `json_extract(json, path)` | `json['path']` | Field access |
| `json_object(k1,v1,k2,v2)` | `pack(k1, v1, k2, v2)` | Create object |
| `json_array(v1, v2, v3)` | `pack_array(v1, v2, v3)` | Create array |

### JSON Examples

```
# SPL
| eval user_name = spath(payload, "user.name")

# APL (if payload is already parsed)
| extend user_name = payload['user']['name']

# APL (if payload is a string)
| extend user_name = parse_json(payload)['user']['name']
```

---

## Functions with No Direct Equivalent

| SPL Function | Workaround |
|--------------|------------|
| `commands()` | N/A - Splunk-specific |
| `lookup()` | Use `lookup` operator |
| `mvmap(mv, expr)` | Use `mv-expand` + `extend` + `summarize make_list()` |
| `predict()` | External ML |
| `cluster()` | External clustering |
| `printf()` | Use `strcat()` with formatting |
| `exact()` | Use `==` for exact comparison |
