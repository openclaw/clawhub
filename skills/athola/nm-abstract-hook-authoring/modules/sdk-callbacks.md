# SDK Callbacks and Implementation Patterns

Complete guide to implementing Claude Agent SDK hooks with Python, including patterns, best practices, and production examples.

## AgentHooks Base Class

The `AgentHooks` class from `claude_agent_sdk` provides the foundation for all SDK hooks:

```python
from claude_agent_sdk import AgentHooks

class MyHooks(AgentHooks):
    """Custom hooks for agent lifecycle events."""

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Hook before tool execution."""
        pass

    async def on_post_tool_use(
        self, tool_name: str, tool_input: dict, tool_output: str
    ) -> str | None:
        """Hook after tool execution."""
        pass

    async def on_post_tool_use_failure(
        self, tool_name: str, tool_input: dict, error: str
    ) -> str | None:
        """Hook when tool execution fails (2.1.20+)."""
        pass

    async def on_user_prompt_submit(self, message: str) -> str | None:
        """Hook when user submits a message."""
        pass

    async def on_stop(self, reason: str, result: Any) -> None:
        """Hook when agent stops."""
        pass

    async def on_subagent_start(self, subagent_id: str, task: Any) -> None:
        """Hook when subagent spawns (2.1.20+)."""
        pass

    async def on_subagent_stop(self, subagent_id: str, result: Any) -> None:
        """Hook when subagent completes."""
        pass

    async def on_permission_request(
        self, tool_name: str, tool_input: dict
    ) -> dict | None:
        """Hook when permission dialog would appear."""
        pass

    async def on_teammate_idle(self, teammate_id: str) -> None:
        """Hook when teammate agent becomes idle (2.1.33+)."""
        pass

    async def on_task_completed(self, task_id: str, result: Any) -> None:
        """Hook when task finishes execution (2.1.33+)."""
        pass

    async def on_pre_compact(self, context_size: int) -> dict | None:
        """Hook before context compaction."""
        pass
```

All callbacks are **optional** - implement only the hooks you need.

## Implementation Patterns

### Pattern 1: Validation Hook

Block operations that violate security policies:

```python
from typing import Any
from claude_agent_sdk import AgentHooks

class ValidationHooks(AgentHooks):
    """Validate tool inputs against security policies."""

    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or {}
        self.blocked_patterns = self.config.get('blocked_patterns', [
            r'rm\s+-rf\s+/',
            r':(){ :|:& };:',  # Fork bomb
            r'dd\s+if=/dev/zero',
        ])

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Validate tool inputs before execution."""
        if tool_name == "Bash":
            command = tool_input.get("command", "")

            # Check for dangerous patterns
            import re
            for pattern in self.blocked_patterns:
                if re.search(pattern, command):
                    raise ValueError(
                        f"Command blocked by security policy: pattern '{pattern}' matched"
                    )

            # Check for production access
            if "production" in command.lower() and not self._has_production_approval():
                raise ValueError("Production access requires approval")

        elif tool_name == "Edit":
            file_path = tool_input.get("file_path", "")

            # Block edits to sensitive files
            sensitive_paths = ["/etc/", "/sys/", "/production/"]
            if any(sensitive in file_path for sensitive in sensitive_paths):
                raise ValueError(f"Cannot edit protected path: {file_path}")

        return None  # Allow operation

    def _has_production_approval(self) -> bool:
        """Check if production access is approved."""
        # Implementation: check environment, file, or API
        import os
        return os.getenv("PRODUCTION_APPROVED") == "true"
```

### Pattern 2: Logging Hook

detailed audit logging with sanitization:

```python
import asyncio
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from claude_agent_sdk import AgentHooks

class LoggingHooks(AgentHooks):
    """Audit logging for all tool operations."""

    # Patterns that might contain secrets
    SECRET_PATTERNS = [
        r'(api[_-]?key["\s:=]+)([^\s,}]+)',
        r'(password["\s:=]+)([^\s,}]+)',
        r'(token["\s:=]+)([^\s,}]+)',
        r'(secret["\s:=]+)([^\s,}]+)',
        r'(auth["\s:=]+)([^\s,}]+)',
    ]

    def __init__(self, log_file: Path | None = None):
        self.log_file = log_file or Path.home() / ".claude" / "audit.log"
        self._log_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._log_task: asyncio.Task[None] | None = None

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Log tool use initiation."""
        await self._queue_log({
            'event': 'pre_tool_use',
            'tool': tool_name,
            'input_size': len(str(tool_input)),
            'timestamp': datetime.now().isoformat()
        })
        return None

    async def on_post_tool_use(
        self, tool_name: str, tool_input: dict, tool_output: str
    ) -> str | None:
        """Log tool completion with sanitized output."""
        safe_output = self._sanitize_secrets(tool_output)

        await self._queue_log({
            'event': 'post_tool_use',
            'tool': tool_name,
            'input_size': len(str(tool_input)),
            'output_size': len(tool_output),
            'output_preview': safe_output[:200],
            'timestamp': datetime.now().isoformat()
        })
        return None

    async def on_stop(self, reason: str, result: Any) -> None:
        """Log session completion."""
        await self._queue_log({
            'event': 'stop',
            'reason': reason,
            'timestamp': datetime.now().isoformat()
        })

        # validate all logs are written before exit
        await self._flush_logs()

    def _sanitize_secrets(self, text: str) -> str:
        """Remove potential secrets from text."""
        for pattern in self.SECRET_PATTERNS:
            text = re.sub(pattern, r'\1***REDACTED***', text, flags=re.IGNORECASE)
        return text

    async def _queue_log(self, entry: dict[str, Any]) -> None:
        """Add log entry to queue for async writing."""
        await self._log_queue.put(entry)

        # Start background writer if not running
        if self._log_task is None or self._log_task.done():
            self._log_task = asyncio.create_task(self._write_logs())

    async def _write_logs(self) -> None:
        """Background task to write logs asynchronously."""
        while not self._log_queue.empty():
            try:
                entry = await asyncio.wait_for(self._log_queue.get(), timeout=1.0)

                # Append to log file
                async with asyncio.Lock():
                    with open(self.log_file, 'a') as f:
                        f.write(json.dumps(entry) + '\n')

            except asyncio.TimeoutError:
                break

    async def _flush_logs(self) -> None:
        """Wait for all queued logs to be written."""
        if self._log_task and not self._log_task.done():
            await self._log_task
```

### Pattern 3: Transformation Hook

Modify tool inputs or outputs:

```python
from claude_agent_sdk import AgentHooks

class TransformationHooks(AgentHooks):
    """Transform tool inputs and outputs."""

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Transform tool inputs before execution."""
        if tool_name == "Read":
            # Normalize file paths
            file_path = tool_input.get("file_path", "")
            normalized = self._normalize_path(file_path)

            if normalized != file_path:
                # Return modified input
                return {**tool_input, "file_path": normalized}

        return None  # No transformation needed

    async def on_post_tool_use(
        self, tool_name: str, tool_input: dict, tool_output: str
    ) -> str | None:
        """Transform tool outputs after execution."""
        if tool_name == "Bash" and "ls" in tool_input.get("command", ""):
            # Add metadata to ls output
            enhanced = f"Directory listing:\n{tool_output}\n\nTotal items: {len(tool_output.splitlines())}"
            return enhanced

        return None  # No transformation

    def _normalize_path(self, path: str) -> str:
        """Normalize file path to absolute path."""
        from pathlib import Path
        return str(Path(path).resolve())
```

### Pattern 4: Metrics Collection Hook

Track performance and usage metrics:

```python
import time
from collections import defaultdict
from typing import Any
from claude_agent_sdk import AgentHooks

class MetricsHooks(AgentHooks):
    """Collect performance and usage metrics."""

    def __init__(self):
        self._tool_counts: defaultdict[str, int] = defaultdict(int)
        self._tool_durations: dict[str, list[float]] = defaultdict(list)
        self._start_times: dict[str, float] = {}
        self._session_start = time.time()
        self._tool_instance_counter = 0

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Record tool invocation start time."""
        self._tool_instance_counter += 1
        instance_id = f"{tool_name}_{self._tool_instance_counter}"
        self._start_times[instance_id] = time.time()
        self._tool_counts[tool_name] += 1
        return None

    async def on_post_tool_use(
        self, tool_name: str, tool_input: dict, tool_output: str
    ) -> str | None:
        """Record tool execution duration."""
        # Find most recent instance of this tool
        instance_id = f"{tool_name}_{self._tool_counts[tool_name]}"

        if instance_id in self._start_times:
            duration = time.time() - self._start_times[instance_id]
            self._tool_durations[tool_name].append(duration)
            del self._start_times[instance_id]

        return None

    async def on_stop(self, reason: str, result: Any) -> None:
        """Generate and display metrics summary."""
        session_duration = time.time() - self._session_start

        print("\n=== Session Metrics ===")
        print(f"Total Duration: {session_duration:.2f}s")
        print(f"Tools Used: {sum(self._tool_counts.values())}")
        print(f"\nTool Breakdown:")

        for tool, count in sorted(self._tool_counts.items()):
            durations = self._tool_durations[tool]
            avg_duration = sum(durations) / len(durations) if durations else 0
            print(f"  {tool}: {count} calls, avg {avg_duration:.3f}s")

        # Save metrics to file
        await self._save_metrics({
            'session_duration': session_duration,
            'tool_counts': dict(self._tool_counts),
            'tool_durations': {k: sum(v) for k, v in self._tool_durations.items()},
            'stop_reason': reason
        })

    async def _save_metrics(self, metrics: dict[str, Any]) -> None:
        """Save metrics to JSON file."""
        import json
        from pathlib import Path
        from datetime import datetime

        metrics_file = Path.home() / ".claude" / "metrics" / f"{datetime.now().isoformat()}.json"
        metrics_file.parent.mkdir(exist_ok=True)

        with open(metrics_file, 'w') as f:
            json.dump(metrics, f, indent=2)
```

### Pattern 5: Context Injection Hook

Enhance user prompts with additional context:

```python
from pathlib import Path
from claude_agent_sdk import AgentHooks

class ContextInjectionHooks(AgentHooks):
    """Inject project context into user prompts."""

    def __init__(self, project_root: Path):
        self.project_root = project_root

    async def on_user_prompt_submit(self, message: str) -> str | None:
        """Inject relevant project context."""
        # Detect if user is asking about code/files
        code_keywords = ['file', 'function', 'class', 'code', 'implement', 'edit', 'change']

        if any(kw in message.lower() for kw in code_keywords):
            context = await self._load_project_context()
            enhanced = f"{context}\n\nUser Request: {message}"
            return enhanced

        return None

    async def _load_project_context(self) -> str:
        """Load relevant project context."""
        context_parts = []

        # Add README if exists
        readme = self.project_root / "README.md"
        if readme.exists():
            content = readme.read_text()
            context_parts.append(f"Project Overview:\n{content[:500]}...")

        # Add coding conventions if exists
        conventions = self.project_root / "CONVENTIONS.md"
        if conventions.exists():
            content = conventions.read_text()
            context_parts.append(f"Coding Conventions:\n{content}")

        # Add architecture notes if exists
        architecture = self.project_root / "ARCHITECTURE.md"
        if architecture.exists():
            content = architecture.read_text()
            context_parts.append(f"Architecture:\n{content[:300]}...")

        return "\n\n".join(context_parts) if context_parts else ""
```

## State Management

### Session State

Maintain state across hook invocations within a session:

```python
from claude_agent_sdk import AgentHooks

class StatefulHooks(AgentHooks):
    """Maintain state across hook invocations."""

    def __init__(self):
        self._session_state = {
            'tools_used': [],
            'errors': [],
            'warnings': []
        }

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Track tool usage."""
        self._session_state['tools_used'].append(tool_name)
        return None

    async def on_post_tool_use(
        self, tool_name: str, tool_input: dict, tool_output: str
    ) -> str | None:
        """Detect errors in output."""
        if "error" in tool_output.lower():
            self._session_state['errors'].append({
                'tool': tool_name,
                'output': tool_output[:200]
            })
        return None

    async def on_stop(self, reason: str, result: Any) -> None:
        """Report session state."""
        print(f"\nSession Summary:")
        print(f"Tools used: {', '.join(set(self._session_state['tools_used']))}")
        print(f"Errors encountered: {len(self._session_state['errors'])}")
```

### Persistent State

Save state across sessions:

```python
import json
from pathlib import Path
from claude_agent_sdk import AgentHooks

class PersistentHooks(AgentHooks):
    """Maintain state across sessions."""

    def __init__(self, state_file: Path | None = None):
        self.state_file = state_file or Path.home() / ".claude" / "hook_state.json"
        self._state = self._load_state()

    def _load_state(self) -> dict:
        """Load state from file."""
        if self.state_file.exists():
            return json.loads(self.state_file.read_text())
        return {'session_count': 0, 'total_tools': 0}

    def _save_state(self) -> None:
        """Save state to file."""
        self.state_file.parent.mkdir(exist_ok=True)
        self.state_file.write_text(json.dumps(self._state, indent=2))

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Increment tool counter."""
        self._state['total_tools'] += 1
        self._save_state()
        return None

    async def on_stop(self, reason: str, result: Any) -> None:
        """Increment session counter."""
        self._state['session_count'] += 1
        self._save_state()
        print(f"Session #{self._state['session_count']}, Total tools: {self._state['total_tools']}")
```

## Error Handling

### Graceful Degradation

```python
import logging
from claude_agent_sdk import AgentHooks

logger = logging.getLogger(__name__)

class ResilientHooks(AgentHooks):
    """Handle errors gracefully without blocking agent."""

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Validate with graceful error handling."""
        try:
            if not self._is_valid_input(tool_input):
                raise ValueError("Invalid input")

        except Exception as e:
            logger.error(f"Validation error (non-blocking): {e}")
            # Don't block operation on validation errors
            return None

        return None

    async def on_post_tool_use(
        self, tool_name: str, tool_input: dict, tool_output: str
    ) -> str | None:
        """Log with error handling."""
        try:
            await self._log_operation(tool_name, tool_output)

        except Exception as e:
            logger.error(f"Logging failed: {e}")
            # Don't block on logging failures

        return None

    def _is_valid_input(self, tool_input: dict) -> bool:
        """Validate tool input."""
        # Validation logic
        return True
```

### Timeout Handling

```python
import asyncio
from claude_agent_sdk import AgentHooks

class TimeoutHooks(AgentHooks):
    """Apply timeouts to hook operations."""

    HOOK_TIMEOUT = 5.0  # seconds

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Validation with timeout."""
        try:
            result = await asyncio.wait_for(
                self._validate_input(tool_input),
                timeout=self.HOOK_TIMEOUT
            )
            return result

        except asyncio.TimeoutError:
            logger.warning(f"Validation timeout for {tool_name}")
            return None  # Allow on timeout

    async def _validate_input(self, tool_input: dict) -> dict | None:
        """Async validation logic."""
        # Potentially slow validation
        await asyncio.sleep(0.1)
        return None
```

## Testing SDK Hooks

### Unit Tests

```python
import pytest
from my_hooks import ValidationHooks, LoggingHooks

@pytest.mark.asyncio
async def test_validation_blocks_dangerous_command():
    hooks = ValidationHooks()

    with pytest.raises(ValueError, match="blocked by security policy"):
        await hooks.on_pre_tool_use("Bash", {"command": "rm -rf /"})

@pytest.mark.asyncio
async def test_validation_allows_safe_command():
    hooks = ValidationHooks()
    result = await hooks.on_pre_tool_use("Bash", {"command": "ls -la"})
    assert result is None

@pytest.mark.asyncio
async def test_logging_sanitizes_secrets():
    import tempfile
    from pathlib import Path

    with tempfile.NamedTemporaryFile(delete=False) as f:
        log_file = Path(f.name)

    hooks = LoggingHooks(log_file)

    await hooks.on_post_tool_use(
        "Bash",
        {"command": "echo"},
        "api_key=secret123"
    )

    await hooks._flush_logs()

    log_content = log_file.read_text()
    assert "secret123" not in log_content
    assert "REDACTED" in log_content

    log_file.unlink()
```

### Integration Tests

```python
import pytest
from claude_agent_sdk import Agent
from my_hooks import MyHooks

@pytest.mark.asyncio
async def test_hooks_integration():
    hooks = MyHooks()
    agent = Agent(hooks=hooks)

    # Execute agent with hooks
    result = await agent.run("List files in current directory")

    # Verify hooks were called
    assert len(hooks._log_entries) > 0
    assert any(entry['tool'] == 'Bash' for entry in hooks._log_entries)
```

## Related Modules

- **hook-types.md**: Event signatures and parameters
- **security-patterns.md**: Security best practices
- **performance-guidelines.md**: Optimization techniques
- **testing-hooks.md**: detailed testing strategies
