---
name: threshold-strategies
description: Strategies for handling quota thresholds and graceful degradation
estimated_tokens: 400
---

# Threshold Strategies

## Degradation Patterns

### Progressive Degradation

```python
def get_degradation_strategy(usage_percent: float) -> str:
    if usage_percent < 80:
        return "full_operation"
    elif usage_percent < 90:
        return "reduce_batch_size"
    elif usage_percent < 95:
        return "essential_only"
    else:
        return "defer_or_secondary"
```

### Batch Size Adjustment

| Threshold | Batch Size | Rationale |
|-----------|------------|-----------|
| <80% | 100% | Full capacity available |
| 80-90% | 50% | Conserve for critical ops |
| 90-95% | 25% | Minimal batches only |
| >95% | 0% | Defer all batches |

## Recovery Strategies

### Wait for Reset
```python
def wait_for_reset(quota_type: str) -> int:
    """Returns seconds until quota resets."""
    reset_times = {
        "rpm": 60,           # Per-minute resets
        "tpm": 60,           # Token per minute
        "daily": seconds_until_midnight()
    }
    return reset_times.get(quota_type, 3600)
```

### Secondary Services
When primary service is at capacity:
1. Check alternative service quota
2. Use cached results if available
3. Return partial results with warning
4. Queue for later execution

## Alerting Patterns

### Threshold Notifications

```python
def check_and_alert(tracker: QuotaTracker) -> list[str]:
    alerts = []
    usage = tracker.get_current_usage()

    if usage.rpm_percent > 80:
        alerts.append(f"RPM at {usage.rpm_percent}%")
    if usage.daily_percent > 90:
        alerts.append(f"Daily quota at {usage.daily_percent}%")

    return alerts
```

### Proactive Warnings
- Alert at 70% for large planned operations
- Alert at 80% for any new operations
- Block at 95% except critical paths
