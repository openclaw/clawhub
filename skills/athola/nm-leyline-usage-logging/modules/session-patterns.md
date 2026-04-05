---
name: session-patterns
description: Patterns for session management in usage logging
estimated_tokens: 350
---

# Session Patterns

## Session Lifecycle

### Creation
```python
def _get_or_create_session(self) -> str:
    """Get existing session or create new one."""
    session_file = self.log_dir / "session.json"

    if session_file.exists():
        session = json.loads(session_file.read_text())
        # Check if session is still active (1 hour timeout)
        if time.time() - session["last_activity"] < 3600:
            return session["session_id"]

    # Create new session
    session_id = f"session_{int(time.time())}"
    session_file.write_text(json.dumps({
        "session_id": session_id,
        "created_at": time.time(),
        "last_activity": time.time()
    }))
    return session_id
```

### Activity Tracking
```python
def _update_session_activity(self):
    """Update session last activity timestamp."""
    session_file = self.log_dir / "session.json"
    if session_file.exists():
        session = json.loads(session_file.read_text())
        session["last_activity"] = time.time()
        session_file.write_text(json.dumps(session))
```

## Session Grouping

### Query by Session
```python
def get_session_operations(self, session_id: str) -> list[dict]:
    """Get all operations for a session."""
    operations = []
    for line in self.log_file.read_text().splitlines():
        entry = json.loads(line)
        if entry.get("session_id") == session_id:
            operations.append(entry)
    return operations
```

### Session Statistics
```python
def get_session_stats(self, session_id: str) -> dict:
    """Get statistics for a session."""
    ops = self.get_session_operations(session_id)
    return {
        "operation_count": len(ops),
        "total_tokens": sum(o.get("tokens", 0) for o in ops),
        "success_rate": sum(1 for o in ops if o["success"]) / len(ops),
        "total_duration": sum(o.get("duration_seconds", 0) for o in ops)
    }
```

## Cross-Service Sessions

### Shared Session IDs
When operations span multiple services:

```python
# Pass session_id between services
logger1 = UsageLogger(service="gemini", session_id=shared_session)
logger2 = UsageLogger(service="qwen", session_id=shared_session)
```

### Session Correlation
```python
def correlate_sessions(loggers: list[UsageLogger]) -> dict:
    """Correlate operations across services in same session."""
    all_ops = []
    for logger in loggers:
        all_ops.extend(logger.get_recent_operations(hours=1))

    # Sort by timestamp
    all_ops.sort(key=lambda x: x["timestamp"])
    return all_ops
```
