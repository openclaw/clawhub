---
name: usage-logging
description: Consult this skill when implementing usage logging and audit trails
version: 1.8.1
triggers:
  - logging
  - usage
  - audit
  - metrics
  - sessions
  - analytics
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/leyline", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: leyline
---

> **Night Market Skill** — ported from [claude-night-market/leyline](https://github.com/athola/claude-night-market/tree/master/plugins/leyline). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Core Concepts](#core-concepts)
- [Session Management](#session-management)
- [Log Entry Structure](#log-entry-structure)
- [Quick Start](#quick-start)
- [Initialize Logger](#initialize-logger)
- [Log Operations](#log-operations)
- [Query Usage](#query-usage)
- [Integration Pattern](#integration-pattern)
- [Log Storage](#log-storage)
- [Detailed Resources](#detailed-resources)
- [Exit Criteria](#exit-criteria)


# Usage Logging

## Overview

Session-aware logging infrastructure for tracking operations across plugins. Provides structured JSONL logging with automatic session management for audit trails and analytics.

## When To Use

- Need audit trails for operations
- Tracking costs across sessions
- Building usage analytics
- Debugging with operation history

## When NOT To Use

- Simple operations without logging needs

## Core Concepts

### Session Management

Sessions group related operations:
- Auto-created on first operation
- Timeout after 1 hour of inactivity
- Unique session IDs for tracking

### Log Entry Structure

```json
{
  "timestamp": "2025-12-05T10:30:00Z",
  "session_id": "session_1733394600",
  "service": "my-service",
  "operation": "analyze_files",
  "tokens": 5000,
  "success": true,
  "duration_seconds": 2.5,
  "metadata": {}
}
```
**Verification:** Run the command with `--help` flag to verify availability.

## Quick Start

### Initialize Logger
```python
from leyline.usage_logger import UsageLogger

logger = UsageLogger(service="my-service")
```
**Verification:** Run the command with `--help` flag to verify availability.

### Log Operations
```python
logger.log_usage(
    operation="analyze_files",
    tokens=5000,
    success=True,
    duration=2.5,
    metadata={"files": 10}
)
```
**Verification:** Run the command with `--help` flag to verify availability.

### Query Usage
```python
# Recent operations
recent = logger.get_recent_operations(hours=24)

# Usage summary
summary = logger.get_usage_summary(days=7)
print(f"Total tokens: {summary['total_tokens']}")
print(f"Total cost: ${summary['estimated_cost']:.2f}")

# Recent errors
errors = logger.get_recent_errors(count=10)
```
**Verification:** Run the command with `--help` flag to verify availability.

## Integration Pattern

```yaml
# In your skill's frontmatter
dependencies: [leyline:usage-logging]
```
**Verification:** Run the command with `--help` flag to verify availability.

Standard integration flow:
1. Initialize logger for your service
2. Log operations after completion
3. Query for analytics and debugging

## Log Storage

Default location: `~/.claude/leyline/usage/{service}.jsonl`

```bash
# View recent logs
tail -20 ~/.claude/leyline/usage/my-service.jsonl | jq .

# Query by date
grep "2025-12-05" ~/.claude/leyline/usage/my-service.jsonl
```
**Verification:** Run the command with `--help` flag to verify availability.

## Detailed Resources

- **Session Patterns**: See `modules/session-patterns.md` for session management
- **Log Formats**: See `modules/log-formats.md` for structured formats

## Exit Criteria

- Operation logged with all required fields
- Session tracked for grouping
- Logs queryable for analytics
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
