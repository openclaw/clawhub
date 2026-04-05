# MECW Theory

Maximum Effective Context Window (MECW) theory and patterns for hallucination prevention via context management. Implements the 50% rule.

## Core Principle: The 50% Rule

Context pressure increases non-linearly as usage approaches limits. Exceeding 50% of context window significantly increases hallucination risk.

### Pressure Levels

| Level | Usage | Effect | Action |
|-------|-------|--------|--------|
| **LOW** | <30% | Optimal performance, high accuracy | Continue normally |
| **MODERATE** | 30-50% | Good performance, within MECW | Monitor closely |
| **HIGH** | 50-70% | Degraded performance, risk zone | Optimize immediately |
| **CRITICAL** | >70% | Severe degradation, high hallucination | Reset context |

## Quick Start

### Basic Pressure Check

```python
from leyline import calculate_context_pressure

pressure = calculate_context_pressure(
    current_tokens=80000,
    max_tokens=1000000
)
print(pressure)  # "MODERATE"
```

### Full Compliance Check

```python
from leyline import check_mecw_compliance

result = check_mecw_compliance(
    current_tokens=120000,
    max_tokens=1000000
)

if not result['compliant']:
    print(f"Overage: {result['overage']:,} tokens")
    print(f"Action: {result['action']}")
```

### Continuous Monitoring

```python
from leyline import MECWMonitor

monitor = MECWMonitor(max_context=1000000)
monitor.track_usage(80000)
status = monitor.get_status()

if status.warnings:
    for warning in status.warnings:
        print(f"[WARN] {warning}")
```

## Best Practices

1. **Plan for 40%**: Design workflows to use ~40% of context, leaving buffer
2. **Buffer for Response**: Leave 50% for model reasoning + response generation
3. **Monitor Continuously**: Check context at each major step
4. **Fail Fast**: Abort and restructure when approaching limits
5. **Document Aggressively**: Keep summaries for context recovery after reset

## Detailed Topics

Key implementation areas (consolidated from leyline modules in 1.5.0):
- **Monitoring**: Use `leyline:quota-management` for quota tracking and threshold monitoring
- **Prevention**: Use `leyline:progressive-loading` for budget-aware loading and `conjure:delegation-core` for delegation triggers

## Integration

This module provides foundational MECW utilities referenced by:
- `leyline:progressive-loading` - Uses MECW for budget-aware loading
- `conjure:delegation-core` - Uses MECW for delegation triggers
- Plugin authors building context-aware systems

Reference in your skill's frontmatter:
```yaml
dependencies: [conserve:context-optimization]
```

## Exit Criteria

- Context pressure monitored before major operations
- MECW compliance checked when loading large content
- Safe budget calculated before batch operations
- Recommendations followed when warnings issued
- Context reset triggered before CRITICAL threshold
