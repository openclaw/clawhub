# Performance Guidelines for Hooks

Optimization techniques for writing fast, efficient hooks that don't degrade agent performance.

## Performance Principles

### Core Performance Rules

1. **Non-Blocking**: Use async/await, never block the event loop
2. **Fast Validation**: < 1s for PreToolUse hooks
3. **Async I/O**: Use async file/network operations
4. **Batch Operations**: Queue and batch writes
5. **Memory Efficient**: Don't accumulate unbounded state
6. **Fail Fast**: Early returns, quick validation

## Performance Budgets

### Hook Timing Targets

| Hook Type | Target | Maximum | Rationale |
|-----------|--------|---------|-----------|
| **PreToolUse** | < 100ms | 1s | Blocks tool execution |
| **PostToolUse** | < 500ms | 5s | Blocks output processing |
| **UserPromptSubmit** | < 200ms | 2s | Blocks message processing |
| **Stop** | < 2s | 10s | Final cleanup, less critical |
| **SubagentStop** | < 1s | 5s | May have multiple instances |
| **TeammateIdle** | < 1s | 5s | Agent teams coordination |
| **TaskCompleted** | < 1s | 5s | Task completion handling |
| **PreCompact** | < 1s | 3s | Blocks context compaction |

### Measuring Hook Performance

```python
import time
from claude_agent_sdk import AgentHooks

class PerformanceMonitoringHooks(AgentHooks):
    """Monitor hook execution time."""

    def __init__(self):
        self._hook_timings = []

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Measure validation time."""
        start = time.perf_counter()

        try:
            result = await self._validate(tool_input)
            return result

        finally:
            duration_ms = (time.perf_counter() - start) * 1000
            self._hook_timings.append({
                'hook': 'pre_tool_use',
                'tool': tool_name,
                'duration_ms': duration_ms
            })

            if duration_ms > 100:  # Warn if over target
                print(f"[WARN]  Slow hook: {tool_name} validation took {duration_ms:.2f}ms")

    async def on_stop(self, reason: str, result: Any) -> None:
        """Report hook performance."""
        if self._hook_timings:
            avg_time = sum(t['duration_ms'] for t in self._hook_timings) / len(self._hook_timings)
            max_time = max(t['duration_ms'] for t in self._hook_timings)

            print(f"\nHook Performance:")
            print(f"  Average: {avg_time:.2f}ms")
            print(f"  Maximum: {max_time:.2f}ms")
            print(f"  Total calls: {len(self._hook_timings)}")
```

## Non-Blocking Operations

### Async I/O

Always use async I/O for file and network operations:

```python
import asyncio
import aiofiles
from claude_agent_sdk import AgentHooks

class AsyncIOHooks(AgentHooks):
    """Use async I/O for performance."""

    async def on_post_tool_use(
        self, tool_name: str, tool_input: dict, tool_output: str
    ) -> str | None:
        """Log asynchronously without blocking."""
        #  BLOCKING (slow)
        # with open('log.txt', 'a') as f:
        #     f.write(f"{tool_name}\n")

        #  NON-BLOCKING (fast)
        async with aiofiles.open('log.txt', 'a') as f:
            await f.write(f"{tool_name}\n")

        return None

    async def _fetch_config(self) -> dict:
        """Async HTTP request."""
        import aiohttp

        #  BLOCKING
        # import requests
        # return requests.get('http://api.example.com/config').json()

        #  NON-BLOCKING
        async with aiohttp.ClientSession() as session:
            async with session.get('http://api.example.com/config') as resp:
                return await resp.json()
```

### Background Tasks

Use background tasks for non-critical operations:

```python
import asyncio
from claude_agent_sdk import AgentHooks

class BackgroundTaskHooks(AgentHooks):
    """Offload work to background tasks."""

    def __init__(self):
        self._log_queue = asyncio.Queue()
        self._background_task = None

    async def on_post_tool_use(
        self, tool_name: str, tool_input: dict, tool_output: str
    ) -> str | None:
        """Queue log entry without blocking."""
        # Add to queue (fast, non-blocking)
        await self._log_queue.put({
            'tool': tool_name,
            'timestamp': time.time(),
            'output_size': len(tool_output)
        })

        # Start background writer if not running
        if self._background_task is None or self._background_task.done():
            self._background_task = asyncio.create_task(self._write_logs())

        return None

    async def _write_logs(self) -> None:
        """Background task to write logs."""
        while not self._log_queue.empty():
            try:
                entry = await asyncio.wait_for(self._log_queue.get(), timeout=1.0)

                # Write to file (in background)
                async with aiofiles.open('audit.log', 'a') as f:
                    await f.write(json.dumps(entry) + '\n')

            except asyncio.TimeoutError:
                break

    async def on_stop(self, reason: str, result: Any) -> None:
        """validate background tasks complete."""
        if self._background_task and not self._background_task.done():
            await self._background_task
```

## Batch Operations

### Batch Writes

Batch multiple writes to reduce I/O overhead:

```python
import asyncio
import aiofiles
from claude_agent_sdk import AgentHooks

class BatchWriteHooks(AgentHooks):
    """Batch writes for efficiency."""

    def __init__(self, batch_size: int = 10, flush_interval: float = 5.0):
        self._batch: list[dict] = []
        self._batch_size = batch_size
        self._flush_interval = flush_interval
        self._last_flush = time.time()

    async def on_post_tool_use(
        self, tool_name: str, tool_input: dict, tool_output: str
    ) -> str | None:
        """Add to batch, flush when full."""
        self._batch.append({
            'tool': tool_name,
            'timestamp': time.time()
        })

        # Flush if batch is full or time elapsed
        should_flush = (
            len(self._batch) >= self._batch_size or
            time.time() - self._last_flush >= self._flush_interval
        )

        if should_flush:
            await self._flush_batch()

        return None

    async def _flush_batch(self) -> None:
        """Write entire batch at once."""
        if not self._batch:
            return

        # Write all entries in one operation
        async with aiofiles.open('audit.log', 'a') as f:
            lines = '\n'.join(json.dumps(entry) for entry in self._batch)
            await f.write(lines + '\n')

        # Clear batch
        self._batch.clear()
        self._last_flush = time.time()

    async def on_stop(self, reason: str, result: Any) -> None:
        """Flush remaining batch."""
        await self._flush_batch()
```

## Memory Management

### Bounded State

Never accumulate unbounded state:

```python
from collections import deque
from claude_agent_sdk import AgentHooks

class BoundedStateHooks(AgentHooks):
    """Maintain bounded state to prevent memory growth."""

    def __init__(self, max_history: int = 1000):
        #  UNBOUNDED (memory leak)
        # self._all_operations = []

        #  BOUNDED (fixed size)
        self._recent_operations = deque(maxlen=max_history)
        self._tool_counts = {}  # OK - bounded by number of tools

    async def on_post_tool_use(
        self, tool_name: str, tool_input: dict, tool_output: str
    ) -> str | None:
        """Track recent operations with bounded memory."""
        # Automatically evicts oldest when full
        self._recent_operations.append({
            'tool': tool_name,
            'timestamp': time.time()
        })

        # Update counts (bounded by tool types)
        self._tool_counts[tool_name] = self._tool_counts.get(tool_name, 0) + 1

        return None
```

### Cleanup Old State

Periodically clean up old state:

```python
import time
from claude_agent_sdk import AgentHooks

class CleanupHooks(AgentHooks):
    """Periodically clean up old state."""

    def __init__(self, max_age_seconds: int = 3600):
        self._operations: list[dict] = []
        self._max_age = max_age_seconds
        self._last_cleanup = time.time()

    async def on_post_tool_use(
        self, tool_name: str, tool_input: dict, tool_output: str
    ) -> str | None:
        """Track with periodic cleanup."""
        self._operations.append({
            'tool': tool_name,
            'timestamp': time.time()
        })

        # Cleanup every 100 operations
        if len(self._operations) % 100 == 0:
            self._cleanup_old_operations()

        return None

    def _cleanup_old_operations(self) -> None:
        """Remove operations older than max_age."""
        cutoff = time.time() - self._max_age
        self._operations = [
            op for op in self._operations
            if op['timestamp'] > cutoff
        ]
```

## Fast Validation

### Early Returns

Return as soon as possible:

```python
from claude_agent_sdk import AgentHooks

class FastValidationHooks(AgentHooks):
    """Optimize validation with early returns."""

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Fast validation with early returns."""
        # Quick checks first
        if tool_name not in ["Bash", "Edit"]:
            return None  # No validation needed

        # Only validate Bash/Edit
        if tool_name == "Bash":
            command = tool_input.get("command", "")

            # Fast length check
            if len(command) > 10_000:
                raise ValueError("Command too long")

            # Quick pattern check (compiled regex)
            if self._dangerous_pattern.search(command):
                raise ValueError("Dangerous command")

        return None

    # Compile regex once at init
    def __init__(self):
        import re
        self._dangerous_pattern = re.compile(
            r'rm\s+-rf\s+/|:(){ :|:& };:',
            re.IGNORECASE
        )
```

### Compiled Patterns

Pre-compile expensive operations:

```python
import re
from claude_agent_sdk import AgentHooks

class CompiledPatternHooks(AgentHooks):
    """Use compiled patterns for speed."""

    def __init__(self):
        #  SLOW: Compile every time
        # self.pattern_str = r'rm\s+-rf'

        #  FAST: Compile once
        self.dangerous_cmd = re.compile(r'rm\s+-rf\s+/', re.IGNORECASE)
        self.secret_api_key = re.compile(r'(api[_-]?key["\s:=]+)([^\s,}]+)', re.IGNORECASE)
        self.secret_token = re.compile(r'(token["\s:=]+)([^\s,}]+)', re.IGNORECASE)

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Fast pattern matching with compiled regex."""
        if tool_name == "Bash":
            command = tool_input.get("command", "")

            # Fast: pattern already compiled
            if self.dangerous_cmd.search(command):
                raise ValueError("Dangerous command")

        return None
```

## Caching

### Expensive Computations

Cache expensive operations:

```python
from functools import lru_cache
from claude_agent_sdk import AgentHooks

class CachingHooks(AgentHooks):
    """Cache expensive computations."""

    @lru_cache(maxsize=128)
    def _is_safe_path(self, path: str) -> bool:
        """Cache path safety checks."""
        from pathlib import Path

        try:
            resolved = Path(path).resolve()
            # Expensive: file system operations
            return resolved.is_relative_to(Path.home())

        except (OSError, ValueError):
            return False

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Use cached path validation."""
        if tool_name == "Read":
            file_path = tool_input.get("file_path", "")

            # Fast: cache hit on repeated paths
            if not self._is_safe_path(file_path):
                raise ValueError("Unsafe path")

        return None
```

### TTL Cache

Cache with time-to-live:

```python
import time
from typing import Any
from claude_agent_sdk import AgentHooks

class TTLCacheHooks(AgentHooks):
    """Cache with expiration."""

    def __init__(self, cache_ttl: float = 300.0):  # 5 minutes
        self._cache: dict[str, tuple[Any, float]] = {}
        self._cache_ttl = cache_ttl

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Use TTL cache for config."""
        config = await self._get_config()  # Cached
        # Use config for validation...
        return None

    async def _get_config(self) -> dict:
        """Get config with TTL caching."""
        cache_key = 'validation_config'
        now = time.time()

        # Check cache
        if cache_key in self._cache:
            value, expires = self._cache[cache_key]
            if now < expires:
                return value  # Cache hit

        # Cache miss: fetch and cache
        config = await self._fetch_config()  # Expensive
        self._cache[cache_key] = (config, now + self._cache_ttl)
        return config

    async def _fetch_config(self) -> dict:
        """Expensive config fetch."""
        # Simulate slow operation
        await asyncio.sleep(0.1)
        return {'max_command_length': 10000}
```

## Profiling Hooks

### Identify Bottlenecks

```python
import cProfile
import pstats
from io import StringIO
from claude_agent_sdk import AgentHooks

class ProfilingHooks(AgentHooks):
    """Profile hook performance."""

    def __init__(self, enable_profiling: bool = False):
        self.enable_profiling = enable_profiling
        self._profiler = cProfile.Profile() if enable_profiling else None

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Profile validation."""
        if self.enable_profiling:
            self._profiler.enable()

        try:
            result = await self._validate(tool_input)
            return result

        finally:
            if self.enable_profiling:
                self._profiler.disable()

    async def on_stop(self, reason: str, result: Any) -> None:
        """Print profiling results."""
        if self.enable_profiling:
            s = StringIO()
            ps = pstats.Stats(self._profiler, stream=s)
            ps.sort_stats('cumulative')
            ps.print_stats(20)  # Top 20 functions
            print(s.getvalue())
```

## Performance Testing

### Benchmark Hooks

```python
import pytest
import time
from my_hooks import ValidationHooks

@pytest.mark.asyncio
async def test_validation_performance():
    """validate validation meets performance budget."""
    hooks = ValidationHooks()

    # Test 100 validations
    start = time.perf_counter()

    for _ in range(100):
        await hooks.on_pre_tool_use("Bash", {"command": "ls -la"})

    duration = time.perf_counter() - start
    avg_duration_ms = (duration / 100) * 1000

    # Assert meets target (< 100ms per validation)
    assert avg_duration_ms < 100, f"Validation too slow: {avg_duration_ms:.2f}ms"

@pytest.mark.asyncio
async def test_logging_performance():
    """validate logging doesn't block."""
    hooks = LoggingHooks()

    start = time.perf_counter()

    await hooks.on_post_tool_use("Bash", {"command": "ls"}, "output")

    duration_ms = (time.perf_counter() - start) * 1000

    # Logging should return quickly (< 500ms)
    assert duration_ms < 500, f"Logging too slow: {duration_ms:.2f}ms"
```

## Optimization Checklist

Before deploying hooks, verify:

- [ ] **Async I/O**: All I/O operations use async
- [ ] **Background Tasks**: Non-critical work runs in background
- [ ] **Batch Operations**: Multiple writes batched together
- [ ] **Bounded State**: No unbounded memory growth
- [ ] **Early Returns**: Fast paths return immediately
- [ ] **Compiled Patterns**: Regex patterns pre-compiled
- [ ] **Caching**: Expensive operations cached
- [ ] **Profiled**: Bottlenecks identified and optimized
- [ ] **Tested**: Performance tests verify budgets
- [ ] **Monitored**: Hook timing logged and tracked

## Common Performance Issues

### Issue 1: Blocking I/O

```python
#  SLOW: Blocking I/O
with open('log.txt', 'a') as f:
    f.write(f"{tool_name}\n")

#  FAST: Async I/O
async with aiofiles.open('log.txt', 'a') as f:
    await f.write(f"{tool_name}\n")
```

### Issue 2: Unbounded State

```python
#  MEMORY LEAK: Unbounded list
self._all_operations.append(operation)

#  BOUNDED: Fixed-size deque
self._recent_operations.append(operation)  # maxlen=1000
```

### Issue 3: Expensive Validation

```python
#  SLOW: Recompile every time
if re.search(r'dangerous', command):
    ...

#  FAST: Compiled once
if self._dangerous_pattern.search(command):
    ...
```

### Issue 4: Synchronous Network

```python
#  SLOW: Blocking HTTP
import requests
config = requests.get('http://api.example.com/config').json()

#  FAST: Async HTTP
import aiohttp
async with aiohttp.ClientSession() as session:
    async with session.get('http://api.example.com/config') as resp:
        config = await resp.json()
```

## Related Modules

- **hook-types.md**: Event types and timing budgets
- **sdk-callbacks.md**: Implementation patterns
- **security-patterns.md**: Security best practices
- **testing-hooks.md**: Performance testing strategies
