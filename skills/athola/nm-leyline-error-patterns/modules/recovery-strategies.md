---
name: recovery-strategies
description: Error recovery strategies and implementation patterns
estimated_tokens: 400
---

# Recovery Strategies

## Strategy Selection

```python
def select_recovery_strategy(error: LeylineError) -> RecoveryStrategy:
    strategies = {
        ErrorCategory.TRANSIENT: RetryWithBackoff(),
        ErrorCategory.RESOURCE: WaitOrSecondary(),
        ErrorCategory.CONFIGURATION: UserActionRequired(),
        ErrorCategory.PERMANENT: ReportAndAbort(),
    }
    return strategies[error.category]
```

## Retry With Backoff

```python
class RetryWithBackoff:
    def __init__(self, max_retries=3, base_delay=1.0):
        self.max_retries = max_retries
        self.base_delay = base_delay

    def execute(self, operation, *args, **kwargs):
        for attempt in range(self.max_retries):
            try:
                return operation(*args, **kwargs)
            except LeylineError as e:
                if e.category != ErrorCategory.TRANSIENT:
                    raise
                if attempt < self.max_retries - 1:
                    delay = self.base_delay * (2 ** attempt)
                    time.sleep(delay)
        raise MaxRetriesExceededError()
```

## Wait or Secondary

class WaitOrSecondary:
    def execute(self, error: RateLimitError, secondary_service=None):
        retry_after = error.metadata.get("retry_after", 60)

        if retry_after < 30:  # Short wait
            time.sleep(retry_after)
            return "retry"

        if secondary_service:
            return ("secondary", secondary_service)

        return ("defer", retry_after)
```

## User Action Required

```python
class UserActionRequired:
    def execute(self, error: ConfigurationError) -> dict:
        actions = {
            "auth": "Run '{service} auth login' or set {ENV_VAR}",
            "model": "Check available models with '{service} --help'",
            "config": "Verify configuration in ~/.claude/leyline/",
        }

        return {
            "status": "user_action_required",
            "message": error.message,
            "suggested_action": actions.get(
                error.metadata.get("type"),
                "Check service documentation"
            )
        }
```

## Graceful Degradation

```python
def execute_with_degradation(
    primary_fn,
            secondary_fn=None,

    degraded_fn=None
):
    """Execute with graceful degradation."""
    try:
        return primary_fn()
    except LeylineError as e:
        if e.category == ErrorCategory.TRANSIENT and secondary_fn:
            return secondary_fn()
        if degraded_fn:
            return degraded_fn(partial=True)
        raise
```

## Logging and Alerting

```python
def log_error_with_context(error: LeylineError, context: dict):
    """Log error with full context for debugging."""
    log_entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "error_type": type(error).__name__,
        "category": error.category.value,
        "message": str(error),
        "recoverable": error.category in [
            ErrorCategory.TRANSIENT,
            ErrorCategory.RESOURCE
        ],
        "context": context
    }

    logger.error(json.dumps(log_entry))

    # Alert on critical errors
    if error.category == ErrorCategory.PERMANENT:
        send_alert(log_entry)
```
