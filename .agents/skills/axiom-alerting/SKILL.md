---
name: axiom-alerting
description: Create and manage Axiom monitors and notifiers via the v2 public API. Use when building alerting, routing notifications, validating monitor behavior, and maintaining alert configurations end-to-end.
---

# Axiom Alerting

You manage alerting in Axiom end-to-end: notifiers for routing and monitors for detection.

## API Overview

Base URL: `https://api.axiom.co/v2/` with Bearer token auth from `.axiom.toml` (project root or `~/.axiom.toml`).

### Monitors (`/v2/monitors`)

| Operation | Method | Path |
|-----------|--------|------|
| List | GET | `/v2/monitors` |
| Get | GET | `/v2/monitors/{id}` |
| History | GET | `/v2/monitors/{id}/history` |
| Create | POST | `/v2/monitors` |
| Update | PUT | `/v2/monitors/{id}` |
| Delete | DELETE | `/v2/monitors/{id}` |

### Notifiers (`/v2/notifiers`)

| Operation | Method | Path |
|-----------|--------|------|
| List | GET | `/v2/notifiers` |
| Get | GET | `/v2/notifiers/{id}` |
| Create | POST | `/v2/notifiers` |
| Update | PUT | `/v2/notifiers/{id}` |
| Delete | DELETE | `/v2/notifiers/{id}` |

## Prerequisites

1. Run `scripts/setup`
2. Ensure `.axiom.toml` has a deployment:

```toml
[deployments.prod]
url = "https://api.axiom.co"
token = "xaat-your-token"
org_id = "your-org-id"
```

## Scripts

Core:
- `scripts/axiom-api <deploy> <method> <path> [body]`

Monitor scripts:
- `scripts/monitor-list <deployment> [--json]`
- `scripts/monitor-get <deployment> <id>`
- `scripts/monitor-history <deployment> <id> <startTime> <endTime>`
- `scripts/monitor-create <deployment> <json-file>`
- `scripts/monitor-update <deployment> <id> <json-file>`
- `scripts/monitor-delete <deployment> <id>`

Notifier scripts:
- `scripts/notifier-list <deployment> [--json]`
- `scripts/notifier-get <deployment> <id>`
- `scripts/notifier-create <deployment> <json-file>`
- `scripts/notifier-update <deployment> <id> <json-file>`
- `scripts/notifier-delete <deployment> <id>`

## Recommended Workflow

1. Create notifier first.
2. Create monitor and set `notifierIds`.
3. Validate monitor behavior with `monitor-history`.
4. Iterate monitor thresholds and schedule.

## Workflow: End-To-End Alerting

1. Run `scripts/setup`.
2. List existing notifiers with `scripts/notifier-list <deployment>` and reuse one if appropriate.
3. If no suitable notifier exists, create one with `scripts/notifier-create`.
4. Create or update the monitor with `notifierIds` attached.
5. Validate with `scripts/monitor-history <deployment> <id> <startTime> <endTime>`.
6. If behavior is noisy or silent, tune `threshold`, `rangeMinutes`, `intervalMinutes`, and N-of-M trigger fields.
7. Re-check history after each change.

## Best Practices

- Configure one channel per notifier.
- Use `emails` (not `recipients`) for email notifier payloads.
- Prefer `triggerAfterNPositiveResults`/`triggerFromNRuns` for noisy signals.
- Use explicit `bin()` in monitor queries; avoid `bin_auto()` for alert logic.
- For metrics-backed monitors, prefer `mplQuery` for definitions; API responses may include both `aplQuery` and `mplQuery`.

## Monitor Types And Operators

Monitor types:
- `Threshold`
- `MatchEvent`
- `AnomalyDetection`

Operators:
- `Above`
- `Below`
- `AboveOrEqual`
- `BelowOrEqual`
- `AboveOrBelow`

## Monitor Field Reference

Core fields:
- `name`: Human-readable monitor name.
- `type`: `Threshold`, `MatchEvent`, or `AnomalyDetection`.
- `aplQuery` / `mplQuery`: Query evaluated by the monitor.
- `notifierIds`: Array of notifier IDs to notify.
- `disabled`: Whether monitor is disabled.
- `disabledUntil`: Optional timestamp for temporary disable/snooze.
- `description`: Optional monitor description.

Threshold and evaluation fields:
- `operator`: Threshold comparison operator.
- `threshold`: Numeric threshold value.
- `rangeMinutes`: Query evaluation window in minutes.
- `intervalMinutes`: Evaluation cadence in minutes.
- `alertOnNoData`: Whether no-data should trigger alerting.
- `triggerAfterNPositiveResults`: Positive evaluations required before firing.
- `triggerFromNRuns`: Total evaluation runs considered for N-of-M logic.

Advanced behavior fields:
- `resolvable`: Whether alerts can resolve automatically.
- `notifyByGroup`: Notify per group key/value result.
- `notifyEveryRun`: Notify on every positive evaluation.
- `skipResolved`: Skip sending resolved notifications.
- `secondDelay`: Delay (seconds) to tolerate late-arriving data.

Type-specific fields:
- `columnName`: Field used by some anomaly/value-anomaly monitors.

## Minimal Valid Monitor Examples

Threshold:

```json
{
  "name": "High Error Count",
  "type": "Threshold",
  "aplQuery": "['logs'] | where status >= 500 | summarize count()",
  "operator": "Above",
  "threshold": 100,
  "rangeMinutes": 5,
  "intervalMinutes": 5,
  "notifierIds": ["notifier-id"],
  "triggerAfterNPositiveResults": 2,
  "triggerFromNRuns": 3,
  "disabled": false
}
```

MatchEvent:

```json
{
  "name": "Error Event Match",
  "type": "MatchEvent",
  "aplQuery": "['logs'] | where level == 'error'",
  "rangeMinutes": 5,
  "intervalMinutes": 5,
  "notifierIds": ["notifier-id"],
  "disabled": false
}
```

AnomalyDetection:

```json
{
  "name": "CPU Anomaly",
  "type": "AnomalyDetection",
  "aplQuery": "['metrics'] | summarize avg(cpu_usage)",
  "columnName": "cpu_usage",
  "operator": "AboveOrBelow",
  "rangeMinutes": 5,
  "intervalMinutes": 5,
  "notifierIds": ["notifier-id"],
  "disabled": false
}
```

## Minimal Valid Notifier Examples

Email:

```json
{
  "name": "Oncall Email",
  "properties": {
    "email": {
      "emails": ["oncall@example.com"]
    }
  }
}
```

Slack:

```json
{
  "name": "Oncall Slack",
  "properties": {
    "slack": {
      "slackUrl": "https://hooks.slack.com/services/T.../B.../XXX"
    }
  }
}
```

Custom webhook:

```json
{
  "name": "Oncall Custom Webhook",
  "properties": {
    "customWebhook": {
      "url": "https://api.example.com/alerts",
      "body": "{\"action\":\"{{.Action}}\",\"monitorID\":\"{{.MonitorID}}\"}"
    }
  }
}
```

## Troubleshooting

`401 Unauthorized`:
- Cause: invalid or expired token.
- Fix:
  - Verify token in `~/.axiom.toml`.
  - Re-run `scripts/setup` and retry:
    - `scripts/notifier-list <deployment>`

`403 Forbidden`:
- Cause: token lacks required permissions.
- Fix:
  - Create/assign token scopes for monitor/notifier management and dataset query access.
  - Retry:
    - `scripts/monitor-list <deployment>`

`404 Not Found` on get/update/delete:
- Cause: wrong monitor/notifier ID or wrong deployment/org.
- Fix:
  - Confirm deployment in `.axiom.toml`.
  - Re-list objects and use exact IDs:
    - `scripts/monitor-list <deployment> --json`
    - `scripts/notifier-list <deployment> --json`

`400 Bad Request` on notifier create/update:
- Cause: invalid notifier payload shape.
- Fix:
  - Use one notifier channel inside `properties`.
  - For email, use `emails` (not `recipients`).
  - Validate against a known-good example and retry:
    - `scripts/notifier-create <deployment> <json-file>`

`400 Bad Request` on monitor create/update:
- Cause: invalid monitor schema, operator/type mismatch, or invalid query fields.
- Fix:
  - Validate required fields: `name`, `type`, query field, schedule, and `notifierIds`.
  - Confirm `operator` matches monitor type and threshold logic.
  - Retry:
    - `scripts/monitor-create <deployment> <json-file>`
    - `scripts/monitor-update <deployment> <id> <json-file>`

Monitor created but never alerts:
- Cause: threshold too strict, wrong query window, or not enough positive runs.
- Fix:
  - Inspect history over a known active period:
    - `scripts/monitor-history <deployment> <id> <startTime> <endTime>`
  - Reduce threshold or widen `rangeMinutes`.
  - Tune `triggerAfterNPositiveResults`/`triggerFromNRuns`.

Too many alerts (noisy monitor):
- Cause: threshold too low or interval too short.
- Fix:
  - Increase threshold.
  - Increase `triggerAfterNPositiveResults` and/or `triggerFromNRuns`.
  - Increase `intervalMinutes` or narrow match conditions.

Notifier exists but no delivery:
- Cause: destination config invalid (URL/key/channel/email list), or destination-side rejection.
- Fix:
  - Fetch notifier and verify destination fields:
    - `scripts/notifier-get <deployment> <id>`
  - Recreate/update notifier with corrected properties:
    - `scripts/notifier-update <deployment> <id> <json-file>`
  - Confirm monitor references correct notifier IDs.
