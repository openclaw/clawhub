# SmartFilter (Filter Bar) Configuration

SmartFilter is a **chart type** that creates dropdown/search filters. It requires TWO parts:
1. A `SmartFilter` chart in the `charts` array with filter definitions
2. `declare query_parameters` in each panel query that should respond to filters

## SmartFilter Chart JSON Structure

```json
{
  "id": "country-filter",
  "name": "Filters",
  "type": "SmartFilter",
  "query": {"apl": ""},
  "filters": [
    {
      "id": "country_filter",
      "name": "Country",
      "type": "select",
      "selectType": "apl",
      "active": true,
      "apl": {
        "apl": "['logs'] | distinct ['geo.country'] | project key=['geo.country'], value=['geo.country'] | sort by key asc",
        "queryOptions": {"quickRange": "1h"}
      },
      "options": [
        {"key": "All", "value": "", "default": true}
      ]
    }
  ]
}
```

## Filter Types

### Dynamic APL Dropdown (`selectType: "apl"`)

Populates options from an APL query.

**Requirements:**
- `apl.apl`: Query returning `key` and `value` columns
- `apl.queryOptions.quickRange`: Time range for the query (e.g., `"1h"`, `"7d"`)
- `options`: Must include at least `[{"key": "All", "value": "", "default": true}]`

### Static List Dropdown (`selectType: "list"`)

Uses predefined options only.

```json
{
  "id": "status_filter",
  "name": "Status",
  "type": "select",
  "selectType": "list",
  "active": true,
  "options": [
    {"key": "All", "value": "", "default": true},
    {"key": "2xx", "value": "2"},
    {"key": "4xx", "value": "4"},
    {"key": "5xx", "value": "5"}
  ]
}
```

### Search Filter (`type: "search"`)

Free-text input instead of dropdown:

```json
{
  "id": "trace_id",
  "name": "Trace ID",
  "type": "search",
  "selectType": "list",
  "active": true,
  "options": [{"key": "All", "value": "", "default": true}]
}
```

## Panel Query Integration

Panel queries must declare parameters and handle empty (All) case:

```apl
declare query_parameters (country_filter:string = "");
['logs']
| where isempty(country_filter) or ['geo.country'] == country_filter
| summarize count() by bin_auto(_time)
```

## Filter Query for Dynamic Dropdowns

```apl
['logs']
| distinct ['geo.country']
| project key=['geo.country'], value=['geo.country']
| sort by key asc
```

## Dependent/Cascading Filters

Filters can depend on other filters by declaring their parameters in the APL query:

```json
{
  "id": "city_filter",
  "name": "City",
  "type": "select",
  "selectType": "apl",
  "active": true,
  "apl": {
    "apl": "declare query_parameters (country_filter:string=\"\");\n['logs']\n| where ['geo.country'] == country_filter\n| distinct ['geo.city']\n| project key=['geo.city'], value=['geo.city']",
    "queryOptions": {"quickRange": "1h"}
  },
  "options": [{"key": "All", "value": "", "default": true}]
}
```

The city dropdown re-queries when `country_filter` changes, showing only cities in the selected country.

## Layout

Place SmartFilter at y=0, full width (w=12, h=1), shift other panels down:

```json
{"i": "filters", "x": 0, "y": 0, "w": 12, "h": 1}
```

## Best Practices

- Filter `id` must match the parameter name in `declare query_parameters`
- Use `isempty(filter)` check so "All" option works (empty string = no filter)
- One SmartFilter chart can contain multiple filters
- Place at top of dashboard (y=0) for visibility
- For cascading filters, order matters: parent filter should come before dependent filters
