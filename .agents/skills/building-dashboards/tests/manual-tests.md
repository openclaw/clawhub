# Building Dashboards - Manual Test Guide

Comprehensive manual testing for all skill features. Run through each section to validate the skill works correctly.

**Test environment:** Use [Axiom Playground](https://play.axiom.co) with `sample-http-logs` dataset.

---

## Prerequisites

Before testing:

1. Run setup (checks config):
   ```bash
   cd skills/building-dashboards
   ./scripts/setup
   ```

2. Create `~/.axiom.toml` with your credentials (for deployment tests):
   ```toml
   [deployments.prod]
   url = "https://api.axiom.co"
   token = "xaat-your-token"
   org_id = "your-org-id"
   ```
   
   This config is shared with axiom-sre.

---

## Test 1: Skill Loading

**Prompt:** "Help me build a dashboard"

**Expected behavior:**
- Skill should activate (look for building-dashboards patterns)
- Agent should ask intake questions: audience, scope, datasets, signals

**Validation:**
- [ ] Skill activates on dashboard-related requests
- [ ] Agent asks clarifying questions before designing

---

## Test 2: Intake Workflow

**Prompt:** "I want to create an oncall dashboard for our API gateway service"

**Expected behavior:**
- Agent asks about datasets
- Agent asks about key metrics (errors, latency, traffic)
- Agent asks about drilldown dimensions

**Validation:**
- [ ] Agent identifies this as oncall use case
- [ ] Agent requests dataset information
- [ ] Agent proposes golden signals coverage

---

## Test 3: Template Usage

**Prompt:** "Create a service overview dashboard for 'payment-api' using the 'http-logs' dataset"

**Expected behavior:**
- Agent uses `dashboard-from-template` or manually applies service-overview template
- Replaces placeholders with provided values
- Outputs valid dashboard JSON

**Validation:**
- [ ] Uses service-overview template
- [ ] Replaces {{service}}, {{dataset}} correctly
- [ ] Output is valid JSON
- [ ] Chart queries reference correct dataset

---

## Test 4: Chart Type Selection

**Prompt:** "What chart type should I use to show error rate over time?"

**Expected:** TimeSeries

**Prompt:** "What chart type for a single KPI like current p95 latency?"

**Expected:** Statistic

**Prompt:** "What chart type to show top 10 failing routes?"

**Expected:** Table

**Prompt:** "What chart type for status code distribution with 4 categories?"

**Expected:** Pie

**Prompt:** "What chart type to show raw error logs?"

**Expected:** LogStream

**Validation:**
- [ ] Correctly recommends TimeSeries for trends
- [ ] Correctly recommends Statistic for single values
- [ ] Correctly recommends Table for top-N lists
- [ ] Correctly recommends Pie for low-cardinality distributions
- [ ] Correctly recommends LogStream for raw events

---

## Test 5: APL Query Generation

Test each chart type APL pattern against `sample-http-logs` in Axiom Playground.

**Note:** These are **ad-hoc queries** for the Query tab, so they include explicit `_time` filters. Dashboard panel queries don't need time filters—they inherit from the UI picker.

### 5.1 Statistic - Error Rate
```apl
['sample-http-logs']
| where _time between (ago(1h) .. now())
| summarize total = count(), errors = countif(toint(status) >= 500)
| extend error_rate = round(100.0 * errors / total, 2)
| project error_rate
```

**Expected:** Returns single row with error_rate percentage

- [ ] Query executes without error
- [ ] Returns single numeric value

### 5.2 TimeSeries - Traffic Over Time
```apl
['sample-http-logs']
| where _time between (ago(1h) .. now())
| summarize requests = count() by bin_auto(_time)
```

**Expected:** Returns time-binned counts

- [ ] Query executes without error
- [ ] Returns multiple rows with _time and count

### 5.3 TimeSeries - Latency Percentiles
```apl
['sample-http-logs']
| where _time between (ago(1h) .. now())
| summarize percentiles_array(req_duration_ms, 50, 95, 99) by bin_auto(_time)
```

**Expected:** Returns percentile array over time, renders as overlaid series

- [ ] Query executes without error
- [ ] Chart shows p50, p95, p99 as overlaid lines (not stacked rows)

### 5.4 Table - Top Routes by Traffic
```apl
['sample-http-logs']
| where _time between (ago(1h) .. now())
| summarize requests = count() by uri
| top 10 by requests
| project URI = uri, Requests = requests
```

**Expected:** Returns top 10 URIs by request count

- [ ] Query executes without error
- [ ] Returns exactly 10 rows (or fewer if less data)
- [ ] Sorted by requests descending

### 5.5 Pie - Status Distribution
```apl
['sample-http-logs']
| where _time between (ago(1h) .. now())
| extend status_class = case(
    toint(status) < 300, "2xx",
    toint(status) < 400, "3xx",
    toint(status) < 500, "4xx",
    "5xx"
  )
| summarize count() by status_class
```

**Expected:** Returns 2-4 rows with status class counts

- [ ] Query executes without error
- [ ] Returns low cardinality (≤6 categories)

### 5.6 LogStream - Recent Requests
```apl
['sample-http-logs']
| where _time between (ago(15m) .. now())
| project-keep _time, method, uri, status, req_duration_ms
| order by _time desc
| take 100
```

**Expected:** Returns raw log entries

- [ ] Query executes without error
- [ ] Returns ≤100 rows
- [ ] Only specified columns shown

### 5.7 Metrics MPL Query Shape

Verify metrics charts set BOTH `query.apl` (MPL pipeline) and `query.metricsDataset` (dataset name), and do NOT set `query.mpl` (rejected by create API).

**Prompt:**
"Create a metrics TimeSeries chart for `otel-metrics:http.server.duration` filtered to `service.name=api` and `deployment.environment=prod`, with `align to 1m using avg`."

**Expected chart query shape:**
```json
{
  "query": {
    "apl": "`otel-metrics`:`http.server.duration`\n| where `service.name` == \"api\"\n| where `deployment.environment` == \"prod\"\n| align to 1m using avg",
    "metricsDataset": "otel-metrics"
  }
}
```

**Validation:**
- [ ] Agent sets `query.apl` to the MPL pipeline string (NOT `query.mpl`. "mpl" is incorrect).
- [ ] Agent sets `query.metricsDataset` to the dataset name
- [ ] Agent does NOT set `query.mpl` (rejected on create)
- [ ] Agent runs `scripts/metrics/metrics-spec` before composing MPL queries
- [ ] Pipeline order matches intended execution order
- [ ] Dotted identifiers are backtick-escaped in MPL

---

## Test 6: Layout Recommendations

**Prompt:** "How should I layout a dashboard with 4 stats, 2 timeseries, 2 tables, and a logstream?"

**Expected behavior:**
- Agent recommends grid-based layout
- Stats at top (row 0-1, w=6 each)
- TimeSeries below (row 2-5, w=12 each)
- Tables middle (row 6-9, w=12 each)
- LogStream bottom (row 10+, w=12)

**Validation:**
- [ ] Recommends logical section ordering
- [ ] Suggests appropriate widths/heights
- [ ] Follows overview → drilldown → evidence pattern

---

## Test 7: Script Execution

### 7.1 dashboard-new
```bash
cd skills/building-dashboards
./scripts/dashboard-new "Test Dashboard" "synthetic_http" /tmp/test-new.json
cat /tmp/test-new.json | jq .
```

**Expected:** Valid JSON with provided values

- [ ] Script runs without error
- [ ] Output is valid JSON
- [ ] name, owner, dataset fields populated

### 7.2 dashboard-from-template
```bash
./scripts/dashboard-from-template service-overview "test-api" "synthetic_http" /tmp/test-template.json
cat /tmp/test-template.json | jq .
```

**Expected:** Full dashboard JSON from template

- [ ] Script runs without error
- [ ] All {{placeholders}} replaced
- [ ] Charts and layout present

### 7.3 dashboard-validate
```bash
./scripts/dashboard-validate /tmp/test-template.json
```

**Expected:** Validation passes

- [ ] Script runs without error
- [ ] Reports any warnings (take limits, grid width)
- [ ] Exits 0 if valid

### 7.4 dashboard-validate with bad input
```bash
echo '{"name": "bad"}' > /tmp/bad-dashboard.json
./scripts/dashboard-validate /tmp/bad-dashboard.json
```

**Expected:** Reports missing fields

- [ ] Script reports missing charts/layout
- [ ] Exits non-zero

### 7.5 dashboard-list
```bash
./scripts/dashboard-list prod
```

**Expected:** Tab-separated list of dashboard IDs and names

- [ ] Script runs without error
- [ ] Output shows id<TAB>name format

### 7.6 dashboard-get
```bash
./scripts/dashboard-get prod <dashboard-id>
```

**Expected:** Full dashboard JSON

- [ ] Script runs without error  
- [ ] Output is valid JSON with charts, layout, etc.

### 7.7 axiom-api (low-level)
```bash
./scripts/axiom-api prod GET /dashboards | jq '.[0].uid'
```

**Expected:** Returns a dashboard UID

- [ ] Script runs without error
- [ ] Returns valid JSON

---

## Test 8: Splunk Migration

**Prompt:** "Convert this Splunk dashboard panel to Axiom:
```spl
index=http_logs status>=500 
| timechart span=5m count by host
```
"

**Expected behavior:**
- Agent recognizes SPL and suggests using spl-to-apl
- Translates to APL with:
  - Explicit time filter
  - `summarize count() by bin_auto(_time), host`
- Recommends TimeSeries chart type

**Validation:**
- [ ] Recognizes SPL syntax
- [ ] Adds time filter
- [ ] Correct summarize/bin pattern
- [ ] Recommends appropriate chart type

---

## Test 9: Integration with axiom-sre

**Prompt:** "I have a dataset called 'app-logs' but I don't know what fields are available. Help me design a dashboard for it."

**Expected behavior:**
- Agent suggests running getschema first
- Provides query: `['app-logs'] | where _time between (ago(1h) .. now()) | getschema`
- After schema discovery, proposes dashboard structure based on available fields

**Validation:**
- [ ] Recommends schema discovery first
- [ ] Doesn't guess field names
- [ ] Adapts recommendations to actual schema

---

## Test 10: Design Best Practices

**Prompt:** "I want to create a pie chart showing errors by user_id"

**Expected behavior:**
- Agent warns about high cardinality
- Recommends Table instead of Pie
- Suggests `top N` to limit rows

**Validation:**
- [ ] Warns about cardinality issues
- [ ] Recommends Table over Pie for high cardinality
- [ ] Suggests bounded query with top N

**Prompt:** "Create a dashboard with 20 panels"

**Expected behavior:**
- Agent warns about cognitive overload
- Recommends 8-12 panels max
- Suggests splitting into multiple dashboards

**Validation:**
- [ ] Warns about too many panels
- [ ] Recommends focused dashboards

---

## Test 11: End-to-End Dashboard Creation

**Prompt:** "Create a complete oncall dashboard for 'sample-http-logs' with:
- Error rate stat
- p95 latency stat
- Traffic over time
- Error rate over time
- Top failing URIs
- Recent errors

Output the complete dashboard JSON."

**Expected behavior:**
- Agent produces complete, valid dashboard JSON
- All queries target sample-http-logs
- All queries have time filters
- Layout is logical (stats top, timeseries middle, table/logs bottom)

**Validation:**
- [ ] Complete JSON output
- [ ] All 6 panels present
- [ ] Queries syntactically correct
- [ ] Layout makes sense
- [ ] Can be validated with dashboard-validate

---

## Test 12: Dashboard Deployment (Optional)

Requires Axiom API access and completed setup.

```bash
# Generate dashboard
./scripts/dashboard-from-template service-overview "test-api" "synthetic_http" /tmp/deploy-test.json

# Validate
./scripts/dashboard-validate /tmp/deploy-test.json

# Deploy to prod (uses ~/.axiom.toml)
DASHBOARD_ID=$(./scripts/dashboard-create prod /tmp/deploy-test.json)

# Get link
./scripts/dashboard-link prod $DASHBOARD_ID
```

**Validation:**
- [ ] Dashboard created in Axiom
- [ ] All panels render correctly
- [ ] Queries execute without error

---

## Validation Checklist

### Core Features
- [ ] Skill activates on dashboard requests
- [ ] Intake workflow asks right questions
- [ ] Template instantiation works
- [ ] Chart type recommendations correct
- [ ] APL patterns execute successfully
- [ ] Layout recommendations sensible

### Scripts
- [ ] dashboard-new works
- [ ] dashboard-from-template works
- [ ] dashboard-validate catches issues
- [ ] dashboard-list shows dashboards
- [ ] dashboard-get fetches dashboard JSON
- [ ] dashboard-create deploys dashboard
- [ ] axiom-api makes authenticated requests

### Integration
- [ ] SPL migration triggers spl-to-apl patterns
- [ ] Unknown schemas trigger discovery workflow
- [ ] Best practices warnings fire correctly

### Quality
- [ ] No hardcoded field names (uses placeholders)
- [ ] Dashboard APL has NO time filters (inherits from UI picker)
- [ ] Ad-hoc/exploration APL has explicit time filters
- [ ] LogStream queries have take limits
- [ ] Layout IDs match chart IDs

---

**Last validated:** _(fill in after testing)_
