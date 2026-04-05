---
name: log-analysis-patterns
description: System log and event stream analysis patterns for catchup
parent_skill: imbue:catchup
category: analysis-patterns
tags: [logs, events, monitoring, time-series]
estimated_tokens: 300
---

# Log Analysis Patterns

## System Log Catchup

When catching up on system behavior via logs:

**Context Establishment:**
- Identify time window: "Last check was [timestamp]"
- Note log sources (application, system, service)
- Identify environment (prod, staging, dev)
- Baseline normal behavior

**Delta Capture:**
- Count log entries by severity (ERROR, WARN, INFO)
- Enumerate unique error types
- Identify anomalies or patterns
- Note frequency changes (spike, drop, stable)

**Efficient Commands:**
```bash
# Count by severity
grep -c "ERROR" logfile.log
grep -c "WARN" logfile.log

# Unique error messages
grep "ERROR" logfile.log | cut -d: -f3 | sort | uniq -c | sort -rn | head -20

# Time-based filtering
awk '$1 >= "2025-12-04" && $1 <= "2025-12-05"' logfile.log
```

## Event Stream Analysis

For application events, audit logs, or metrics:

**Context:**
- Event source and schema
- Baseline event rate
- Time window of interest
- Expected vs actual patterns

**Delta:**
- New event types introduced
- Event rate changes (throughput)
- Failed vs successful event ratios
- Outliers or anomalies

**Insights:**
- Performance trends (response times, throughput)
- Error patterns (recurring, transient, progressive)
- User behavior changes
- System health indicators

## Time-Window Analysis

**Comparing time windows:**
```bash
# Events today vs yesterday
comm -13 <(grep "2025-12-04" events.log | sort) \
         <(grep "2025-12-05" events.log | sort)

# Hourly breakdown
awk '{print substr($1,12,2)}' logfile.log | sort | uniq -c
```

**Pattern Detection:**
- Periodic patterns (hourly, daily, weekly cycles)
- Correlation between events
- Cascading failures
- Recovery patterns

## Metric-Based Catchup

When logs include metrics or measurements:

**Delta:**
- Min/max/avg changes
- Percentile shifts (p50, p95, p99)
- Threshold violations
- Trend direction (improving, degrading, stable)

**Insights:**
- Capacity planning needs
- Performance regression sources
- Resource utilization trends
- SLA compliance status

## Token Conservation

- Use aggregation (counts, uniques) over raw logs
- Sample representative entries, don't reproduce all
- Reference log files + line numbers for detail
- Summarize patterns rather than listing every entry
- Defer deep debugging to specialized tools/skills
