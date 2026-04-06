---
name: error-patterns
description: |
  'Standardized error handling patterns with classification, recovery, and logging strategies. error handling, error recovery, graceful degradation, resilience.'
version: 1.8.1
triggers:
  - errors
  - error-handling
  - recovery
  - resilience
  - debugging
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/leyline", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.usage-logging"]}}}
source: claude-night-market
source_plugin: leyline
---

> **Night Market Skill** — ported from [claude-night-market/leyline](https://github.com/athola/claude-night-market/tree/master/plugins/leyline). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Error Classification](#error-classification)
- [By Severity](#by-severity)
- [By Recoverability](#by-recoverability)
- [Quick Start](#quick-start)
- [Standard Error Handler](#standard-error-handler)
- [Error Result](#error-result)
- [Common Patterns](#common-patterns)
- [Authentication Errors (401/403)](#authentication-errors-(401-403))
- [Rate Limit Errors (429)](#rate-limit-errors-(429))
- [Timeout Errors](#timeout-errors)
- [Context Too Large (400)](#context-too-large-(400))
- [Integration Pattern](#integration-pattern)
- [Detailed Resources](#detailed-resources)
- [Exit Criteria](#exit-criteria)


# Error Patterns

## Overview

Standardized error handling patterns for consistent, production-grade behavior across plugins. Provides error classification, recovery strategies, and debugging workflows.

## When To Use

- Building resilient integrations
- Need consistent error handling
- Want graceful degradation
- Debugging production issues

## When NOT To Use

- Project doesn't use the leyline infrastructure patterns
- Simple scripts without service architecture needs

## Error Classification

### By Severity

| Level | Action | Example |
|-------|--------|---------|
| **Critical** | Halt, alert | Auth failure, service down |
| **Error** | Retry or secondary strategy | Rate limit, timeout |
| **Warning** | Log, continue | Partial results, deprecation |
| **Info** | Log only | Non-blocking issues |

### By Recoverability

```python
class ErrorCategory(Enum):
    TRANSIENT = "transient"      # Retry likely to succeed
    PERMANENT = "permanent"       # Retry won't help
    CONFIGURATION = "config"      # User action needed
    RESOURCE = "resource"         # Quota/limit issue
```
**Verification:** Run the command with `--help` flag to verify availability.

## Quick Start

### Standard Error Handler
```python
from leyline.error_patterns import handle_error, ErrorCategory

try:
    result = service.execute(prompt)
except RateLimitError as e:
    return handle_error(e, ErrorCategory.RESOURCE, {
        "retry_after": e.retry_after,
        "service": "gemini"
    })
except AuthError as e:
    return handle_error(e, ErrorCategory.CONFIGURATION, {
        "action": "Run 'gemini auth login'"
    })
```
**Verification:** Run the command with `--help` flag to verify availability.

### Error Result
```python
@dataclass
class ErrorResult:
    category: ErrorCategory
    message: str
    recoverable: bool
    suggested_action: str
    metadata: dict
```
**Verification:** Run the command with `--help` flag to verify availability.

## Common Patterns

### Authentication Errors (401/403)
- Verify credentials exist
- Check token expiration
- Validate permissions/scopes
- Suggest re-authentication

### Rate Limit Errors (429)
- Extract retry-after header
- Log for quota tracking
- Implement backoff
- Consider alternative service

### Timeout Errors
- Increase timeout for retries
- Break into smaller requests
- Use async patterns
- Consider different model

### Context Too Large (400)
- Estimate tokens before request
- Split into multiple requests
- Reduce input content
- Use larger context model

## Integration Pattern

```yaml
# In your skill's frontmatter
dependencies: [leyline:error-patterns]
```
**Verification:** Run the command with `--help` flag to verify availability.

## Detailed Resources

- **Classification**: See `modules/classification.md` for error taxonomy
- **Recovery**: See `modules/recovery-strategies.md` for handling patterns
- **Agent Damage Control**: See `modules/agent-damage-control.md` for multi-agent error recovery and escalation

## Exit Criteria

- Error classified correctly
- Appropriate recovery attempted
- User-actionable message provided
- Error logged for debugging
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
