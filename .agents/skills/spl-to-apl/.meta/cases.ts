import type { TranslationCase } from "../../../eval-tooling/src/shared/types";

/**
 * Test cases validated against Axiom Playground (play.axiom.co) with real datasets.
 *
 * Datasets used:
 * - sample-http-logs: HTTP request logs with status, uri, method, req_duration_ms, geo.*, id fields
 * - otel-demo-traces: OpenTelemetry trace spans with service.name, duration, status_code fields
 *
 * Source attribution:
 * - DOCS: Based on https://axiom.co/docs/apl/guides/splunk-cheat-sheet
 * - EXTENDED: Patterns beyond docs, validated manually against Axiom Playground
 *
 * Extended patterns not in docs:
 * - perc50/perc95/perc99 → percentile() (docs don't cover percentiles)
 * - dc() → dcount() (docs don't explicitly show this)
 * - timechart → bin(_time, ...) + summarize (docs don't cover timechart)
 * - iplocation → pre-computed geo.* fields (dataset-specific, not a translation)
 * - if() nested → case() (docs show if → iff(), we use case() for nested conditionals)
 * - toint(status) casting (dataset quirk: status is string in sample-http-logs)
 *
 * Note: Time filters not included - SPL queries don't specify time (set via UI).
 * The eval harness injects time via API startTime/endTime params.
 */
export const testCases: TranslationCase[] = [
  // === sample-http-logs dataset ===
  {
    id: "basic-count-by-status",
    name: "Basic count by status",
    spl: `index=sample-http-logs | stats count by status`,
    expectedApl: `['sample-http-logs']
| summarize count() by status`,
    category: "aggregation",
    dataset: "sample-http-logs",
    // DOCS: stats count by → summarize count() by
  },
  {
    id: "top-10-uris",
    name: "Top 10 URIs",
    spl: `index=sample-http-logs | top limit=10 uri`,
    expectedApl: `['sample-http-logs']
| summarize count() by uri
| top 10 by count_`,
    category: "aggregation",
    dataset: "sample-http-logs",
    // DOCS: top → top N by (docs show head → top)
  },
  {
    id: "error-rate-over-time",
    name: "Error rate over time",
    spl: `index=sample-http-logs | timechart span=5m count(eval(status>=500)) as errors, count as total | eval error_rate=errors/total*100`,
    expectedApl: `['sample-http-logs']
| summarize errors = countif(toint(status) >= 500), total = count() by bin(_time, 5m)
| extend error_rate = toreal(errors) / total * 100`,
    category: "timeseries",
    dataset: "sample-http-logs",
    notes: "status field is string in sample-http-logs, needs toint()",
    // EXTENDED: timechart → bin(_time) + summarize, countif, toint casting
  },
  {
    id: "request-duration-percentiles",
    name: "Request duration percentiles by method",
    spl: `index=sample-http-logs | stats perc50(req_duration_ms) as p50, perc95(req_duration_ms) as p95, perc99(req_duration_ms) as p99 by method`,
    expectedApl: `['sample-http-logs']
| summarize 
    p50 = percentile(req_duration_ms, 50),
    p95 = percentile(req_duration_ms, 95),
    p99 = percentile(req_duration_ms, 99)
  by method`,
    category: "aggregation",
    dataset: "sample-http-logs",
    // EXTENDED: perc50/perc95/perc99 → percentile()
  },
  {
    id: "geo-distribution",
    name: "Geo distribution top 20",
    spl: `index=sample-http-logs | iplocation clientip | stats count by Country, City | sort - count | head 20`,
    expectedApl: `['sample-http-logs']
| summarize count() by ['geo.country'], ['geo.city']
| order by count_ desc
| take 20`,
    category: "geo",
    dataset: "sample-http-logs",
    notes: "sample-http-logs has pre-computed geo.country and geo.city fields",
    // EXTENDED: iplocation → uses pre-computed geo.* fields (dataset-specific)
    // DOCS: sort → order by, head → take
  },
  {
    id: "unique-users-per-endpoint",
    name: "Unique users per endpoint",
    spl: `index=sample-http-logs | stats dc(id) as unique_users, count as requests by uri | sort - unique_users`,
    expectedApl: `['sample-http-logs']
| summarize unique_users = dcount(id), requests = count() by uri
| order by unique_users desc`,
    category: "aggregation",
    dataset: "sample-http-logs",
    // EXTENDED: dc() → dcount()
    // DOCS: sort → order by
  },
  {
    id: "conditional-severity",
    name: "Conditional field creation (severity)",
    spl: `index=sample-http-logs | eval severity=if(status>=500, "error", if(status>=400, "warning", "ok")) | stats count by severity`,
    expectedApl: `['sample-http-logs']
| extend severity = case(
    toint(status) >= 500, "error",
    toint(status) >= 400, "warning",
    "ok"
)
| summarize count() by severity`,
    category: "conditional",
    dataset: "sample-http-logs",
    notes: "status field is string in sample-http-logs, needs toint()",
    // EXTENDED: nested if() → case() (docs show if → iff() for simple cases)
    // DOCS: eval → extend
  },

  // === otel-demo-traces dataset ===
  {
    id: "span-duration-by-service",
    name: "Span duration by service",
    spl: `index=otel-demo-traces | stats avg(duration) as avg_duration, perc95(duration) as p95_duration by service.name`,
    expectedApl: `['otel-demo-traces']
| summarize 
    avg_duration = avg(duration),
    p95_duration = percentile(duration, 95)
  by ['service.name']`,
    category: "aggregation",
    dataset: "otel-demo-traces",
    // EXTENDED: avg(), perc95 → percentile()
    // DOCS: stats → summarize
  },
  {
    id: "error-spans-over-time",
    name: "Error spans over time by service",
    spl: `index=otel-demo-traces status_code="ERROR" | timechart span=1m count by service.name`,
    expectedApl: `['otel-demo-traces']
| where status_code == "ERROR"
| summarize count() by bin(_time, 1m), ['service.name']`,
    category: "timeseries",
    dataset: "otel-demo-traces",
    // EXTENDED: timechart span=Nm count by field → bin(_time, Nm) + summarize
    // DOCS: field="value" filter → where field == "value"
  },
];

