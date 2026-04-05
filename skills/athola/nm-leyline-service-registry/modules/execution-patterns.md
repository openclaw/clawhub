---
name: execution-patterns
description: Advanced execution patterns for service registry
estimated_tokens: 400
---

# Execution Patterns

## Command Building

### Template Expansion
```python
def build_command(
    config: ServiceConfig,
    prompt: str,
    files: list[str],
    model: str = None
) -> str:
    """Build command from template."""
    file_args = " ".join(f"@{f}" for f in files)
    model = model or config.default_model

    return config.command_template.format(
        command=config.command,
        prompt=prompt,
        files=file_args,
        model=model
    )
```

### Safe Execution
```python
import subprocess
import shlex

def execute_safely(command: str, timeout: int = 60) -> ExecutionResult:
    """Execute command with safety measures."""
    start = time.time()

    try:
        result = subprocess.run(
            shlex.split(command),
            capture_output=True,
            text=True,
            timeout=timeout
        )

        return ExecutionResult(
            success=(result.returncode == 0),
            stdout=result.stdout,
            stderr=result.stderr,
            exit_code=result.returncode,
            duration=time.time() - start,
            tokens_used=estimate_tokens(result.stdout)
        )
    except subprocess.TimeoutExpired:
        return ExecutionResult(
            success=False,
            stderr="Command timed out",
            exit_code=-1,
            duration=timeout
        )
```

## Retry Patterns

### Exponential Backoff
```python
def execute_with_retry(
    registry: ServiceRegistry,
    service: str,
    prompt: str,
    max_retries: int = 3
) -> ExecutionResult:
    """Execute with exponential backoff retry."""
    for attempt in range(max_retries):
        result = registry.execute(service, prompt)

        if result.success:
            return result

        if "rate limit" in result.stderr.lower():
            wait_time = 2 ** attempt  # 1, 2, 4 seconds
            time.sleep(wait_time)
        else:
            break  # Non-retryable error

    return result
```

### Circuit Breaker
```python
class CircuitBreaker:
    def __init__(self, failure_threshold: int = 5, reset_timeout: int = 60):
        self.failures = 0
        self.threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self.last_failure = 0
        self.state = "closed"  # closed, open, half-open

    def can_execute(self) -> bool:
        if self.state == "closed":
            return True
        if self.state == "open":
            if time.time() - self.last_failure > self.reset_timeout:
                self.state = "half-open"
                return True
            return False
        return True  # half-open allows one attempt

    def record_result(self, success: bool):
        if success:
            self.failures = 0
            self.state = "closed"
        else:
            self.failures += 1
            self.last_failure = time.time()
            if self.failures >= self.threshold:
                self.state = "open"
```

## Parallel Execution

### Multi-Service Query
```python
import asyncio

async def execute_parallel(
    registry: ServiceRegistry,
    services: list[str],
    prompt: str
) -> dict[str, ExecutionResult]:
    """Execute same prompt across multiple services."""
    tasks = {
        service: asyncio.create_task(
            registry.execute_async(service, prompt)
        )
        for service in services
    }

    results = {}
    for service, task in tasks.items():
        results[service] = await task

    return results
```
