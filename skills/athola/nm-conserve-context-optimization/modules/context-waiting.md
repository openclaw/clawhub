# Context Waiting Module

## Overview

Integrates condition-based-waiting principles (bundled in
systematic-debugging since superpowers v4.0.0) with context
optimization to eliminate flaky context monitoring and
resource management.
Replaces arbitrary timeouts with condition polling for
intelligent resource optimization.

## Core Philosophy

**Traditional approach**: `sleep(5)` or `setTimeout(5000)` - guessing at context optimization timing
**Condition-based approach**: Wait for actual optimization completion, resource availability, or context pressure signals

## When to Use

- **Context pressure monitoring**: Wait for actual token threshold breaches
- **Resource optimization completion**: Wait for optimization strategies to complete
- **Async processing**: Wait for background optimization tasks
- **Plugin coordination**: Wait for inter-plugin resource allocations

## Implementation Patterns

### 1. Context Pressure Waiting

```python
#  BEFORE: Arbitrary timeout
time.sleep(2)  # Guess optimization will finish in 2 seconds
context_status = check_context_usage()

#  AFTER: Wait for condition
context_status = wait_for_context_pressure(
    threshold=0.5,
    timeout_ms=5000
)
```

### 2. Optimization Completion Waiting

```python
#  BEFORE: Fixed delay
await asyncio.sleep(3)  # Hope optimization finishes
result = get_optimization_result()

#  AFTER: Wait for completion
result = wait_for_optimization_completion(
    optimization_id=opt_id,
    success_condition=lambda r: r.compression_ratio > 0.3
)
```

### 3. Resource Availability Waiting

```python
#  BEFORE: Poll with sleep
while not resource_available():
    time.sleep(0.5)  # Arbitrary polling interval

#  AFTER: Condition-based polling
wait_for_resource(
    resource_type="memory",
    min_available_mb=100,
    poll_interval_ms=10
)
```

## Waiting Functions

### Core Wait Function

```python
import time
from typing import Callable, Optional, Any

def wait_for_condition(
    condition: Callable[[], Any],
    description: str,
    timeout_ms: int = 5000,
    poll_interval_ms: int = 10
) -> Any:
    """
    Wait for a condition to be met, with timeout and proper error handling.

    Args:
        condition: Function that returns truthy value when condition is met
        description: Human-readable description for error messages
        timeout_ms: Maximum time to wait in milliseconds
        poll_interval_ms: How often to check the condition

    Returns:
        The truthy result from the condition function

    Raises:
        TimeoutError: If condition is not met within timeout
    """
    start_time = time.time()
    timeout_seconds = timeout_ms / 1000
    poll_interval = poll_interval_ms / 1000

    while True:
        result = condition()
        if result:
            return result

        if time.time() - start_time > timeout_seconds:
            raise TimeoutError(
                f"Timeout waiting for {description} after {timeout_ms}ms"
            )

        time.sleep(poll_interval)
```

### Context-Specific Waiting Functions

```python
def wait_for_context_pressure(
    threshold: float = 0.5,
    timeout_ms: int = 10000,
    context_checker: Optional[Callable[[], float]] = None
) -> dict:
    """Wait for context usage to exceed threshold"""

    def condition():
        if context_checker:
            usage = context_checker()
        else:
            usage = get_current_context_usage()
        return usage if usage > threshold else None

    usage = wait_for_condition(
        condition,
        f"context pressure > {threshold}",
        timeout_ms
    )

    return {
        "usage": usage,
        "threshold": threshold,
        "timestamp": time.time()
    }

def wait_for_optimization_completion(
    optimization_id: str,
    success_condition: Optional[Callable[[dict], bool]] = None,
    timeout_ms: int = 30000
) -> dict:
    """Wait for optimization to complete successfully"""

    def condition():
        result = get_optimization_status(optimization_id)
        if result.get("completed"):
            if not success_condition or success_condition(result):
                return result
        return None

    return wait_for_condition(
        condition,
        f"optimization {optimization_id} completion",
        timeout_ms
    )

def wait_for_resource_availability(
    resource_type: str,
    min_required: float,
    resource_checker: Optional[Callable[[], float]] = None,
    timeout_ms: int = 15000
) -> float:
    """Wait for resource to become available"""

    def condition():
        if resource_checker:
            available = resource_checker()
        else:
            available = get_resource_availability(resource_type)
        return available if available >= min_required else None

    return wait_for_condition(
        condition,
        f"{resource_type} >= {min_required}",
        timeout_ms
    )
```

## Integration with Conservation

### Monitoring Context Pressure

```python
class ContextMonitor:
    def __init__(self):
        self.monitoring = False
        self.pressure_handlers = []

    def wait_for_pressure_threshold(
        self,
        threshold: float,
        on_pressure_reached: Optional[Callable] = None
    ) -> dict:
        """Monitor context and wait for threshold breach"""

        def condition():
            usage = self.calculate_context_usage()
            if usage > threshold:
                self.monitoring = False
                if on_pressure_reached:
                    on_pressure_reached(usage)
                return usage
            return None

        self.monitoring = True
        return wait_for_condition(
            condition,
            f"context pressure threshold {threshold}",
            timeout_ms=30000
        )

    def calculate_context_usage(self) -> float:
        """Calculate current context usage as percentage"""
        # Implementation would check actual token usage
        return 0.0  # Placeholder
```

### Coordinating Optimization Tasks

```python
class OptimizationCoordinator:
    def __init__(self):
        self.active_optimizations = {}

    def wait_for_batch_completion(
        self,
        optimization_ids: List[str],
        timeout_ms: int = 60000
    ) -> List[dict]:
        """Wait for multiple optimizations to complete"""

        results = []
        for opt_id in optimization_ids:
            result = wait_for_optimization_completion(
                opt_id,
                timeout_ms=timeout_ms
            )
            results.append(result)

        return results

    def coordinate_with_other_plugins(
        self,
        required_plugins: List[str],
        coordination_timeout_ms: int = 20000
    ) -> dict:
        """Wait for other plugins to be ready for optimization"""

        def condition():
            ready_plugins = []
            for plugin in required_plugins:
                if check_plugin_readiness(plugin):
                    ready_plugins.append(plugin)

            if len(ready_plugins) == len(required_plugins):
                return {"ready": True, "plugins": ready_plugins}
            return None

        return wait_for_condition(
            condition,
            f"plugin coordination: {required_plugins}",
            timeout_ms=coordination_timeout_ms
        )
```

## Examples

### Example 1: Dynamic Context Optimization

```python
# Instead of fixed optimization intervals
def dynamic_optimization_loop():
    while True:
        # Wait for actual pressure, not arbitrary time
        pressure_info = wait_for_context_pressure(threshold=0.6)

        # Optimize based on actual need
        result = optimize_context(
            target_reduction=0.3,
            strategy="priority"
        )

        # Wait for completion before continuing
        wait_for_optimization_completion(
            result["optimization_id"],
            success_condition=lambda r: r["compression_ratio"] > 0.25
        )

        print(f"Optimization completed: {result['compression_ratio']:.2f}")
```

### Example 2: Plugin Resource Coordination

```python
def coordinate_plugin_resources(plugins: List[str]):
    """Coordinate resource usage across multiple plugins"""

    # Wait for all plugins to be ready
    coordination = wait_for_condition(
        lambda: all(check_plugin_ready(p) for p in plugins),
        f"plugin readiness: {plugins}",
        timeout_ms=10000
    )

    # Monitor collective resource usage
    while True:
        total_usage = sum(get_plugin_resource_usage(p) for p in plugins)

        if total_usage > RESOURCE_LIMIT:
            # Trigger optimization across plugins
            optimize_result = wait_for_condition(
                lambda: trigger_collective_optimization(plugins),
                "collective optimization",
                timeout_ms=15000
            )

            # Wait for optimizations to take effect
            wait_for_condition(
                lambda: sum(get_plugin_resource_usage(p) for p in plugins) < RESOURCE_LIMIT,
                "resource usage reduction",
                timeout_ms=10000
            )

        time.sleep(1)  # Normal monitoring interval
```

## Benefits

1. **Eliminates Race Conditions**: No more arbitrary timing guesses
2. **Responsive Optimization**: React to actual conditions, not timers
3. **Resource Efficient**: No wasted polling or unnecessary delays
4. **Better Error Messages**: Clear indication of what was waited for
5. **Testable**: Conditions can be mocked and verified
6. **Composable**: Multiple conditions can be combined

## Best Practices

1. **Always Include Timeouts**: Prevent infinite waiting
2. **Clear Descriptions**: Error messages should explain what was expected
3. **Appropriate Polling**: Default to 10ms, not 1ms (wastes CPU) or 100ms (slows response)
4. **Condition Functions**: Should be fast and side-effect free
5. **Document Conditions**: Explain WHY we're waiting for specific conditions
