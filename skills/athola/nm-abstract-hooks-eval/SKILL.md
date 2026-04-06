---
name: hooks-eval
description: Evaluate hook security, performance, and SDK compliance. Use for audits
version: 1.8.1
triggers:
  - hooks
  - evaluation
  - security
  - performance
  - claude-sdk
  - agent-sdk
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/abstract", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.hook-scope-guide"]}}}
source: claude-night-market
source_plugin: abstract
---

> **Night Market Skill** — ported from [claude-night-market/abstract](https://github.com/athola/claude-night-market/tree/master/plugins/abstract). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [Key Capabilities](#key-capabilities)
- [Core Components](#core-components)
- [Quick Reference](#quick-reference)
- [Hook Event Types](#hook-event-types)
- [Hook Callback Signature](#hook-callback-signature)
- [Return Values](#return-values)
- [Quality Scoring (100 points)](#quality-scoring-(100-points))
- [Detailed Resources](#detailed-resources)
- [Basic Evaluation Workflow](#basic-evaluation-workflow)
- [Integration with Other Tools](#integration-with-other-tools)
- [Related Skills](#related-skills)


# Hooks Evaluation Framework

## Overview

This skill provides a detailed framework for evaluating, auditing, and implementing Claude Code hooks across all scopes (plugin, project, global) and both JSON-based and programmatic (Python SDK) hooks.

### Key Capabilities

- **Security Analysis**: Vulnerability scanning, dangerous pattern detection, injection prevention
- **Performance Analysis**: Execution time benchmarking, resource usage, optimization
- **Compliance Checking**: Structure validation, documentation requirements, best practices
- **SDK Integration**: Python SDK hook types, callbacks, matchers, and patterns

### Core Components

| Component | Purpose |
|-----------|---------|
| **Hook Types Reference** | Complete SDK hook event types and signatures |
| **Evaluation Criteria** | Scoring system and quality gates |
| **Security Patterns** | Common vulnerabilities and mitigations |
| **Performance Benchmarks** | Thresholds and optimization guidance |

## Quick Reference

### Hook Event Types

```python
HookEvent = Literal[
    "PreToolUse",       # Before tool execution
    "PostToolUse",      # After tool execution
    "UserPromptSubmit", # When user submits prompt
    "Stop",             # When stopping execution
    "SubagentStop",     # When a subagent stops
    "TeammateIdle",     # When teammate agent becomes idle (2.1.33+)
    "TaskCompleted",    # When a task finishes execution (2.1.33+)
    "PreCompact"        # Before message compaction
]
```
**Verification:** Run the command with `--help` flag to verify availability.

**Note**: Python SDK does not support `SessionStart`, `SessionEnd`, or `Notification` hooks due to setup limitations. However, plugins can define `SessionStart` hooks via `hooks.json` using shell commands (e.g., leyline's `detect-git-platform.sh`).

### Plugin-Level hooks.json

Plugins can declare hooks via `"hooks": "./hooks/hooks.json"` in plugin.json. The evaluator validates:
- Referenced hooks.json exists and is valid JSON
- Shell commands referenced in hooks exist and are executable
- Hook matchers use valid event types

### Hook Callback Signature

```python
async def my_hook(
    input_data: dict[str, Any],    # Hook-specific input
    tool_use_id: str | None,       # Tool ID (for tool hooks)
    context: HookContext           # Additional context
) -> dict[str, Any]:               # Return decision/messages
    ...
```
**Verification:** Run the command with `--help` flag to verify availability.

### Return Values

```python
return {
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",       # Match hook type
        "permissionDecision": "deny",        # Optional: block action
        "permissionDecisionReason": "...",   # Reason for denial
        "additionalContext": "...",          # Optional: context added
    }
}
```
**Verification:** Run the command with `--help` flag to verify availability.

### Quality Scoring (100 points)

| Category | Points | Focus |
|----------|--------|-------|
| Security | 30 | Vulnerabilities, injection, validation |
| Performance | 25 | Execution time, memory, I/O |
| Compliance | 20 | Structure, documentation, error handling |
| Reliability | 15 | Timeouts, idempotency, degradation |
| Maintainability | 10 | Code structure, modularity |

## Detailed Resources

- **SDK Hook Types**: See `modules/sdk-hook-types.md` for complete Python SDK type definitions, patterns, and examples
- **Evaluation Criteria**: See `modules/evaluation-criteria.md` for detailed scoring rubric and quality gates
- **Security Patterns**: See `modules/sdk-hook-types.md` for vulnerability detection and mitigation
- **Performance Guide**: See `modules/evaluation-criteria.md` for benchmarking and optimization

## Basic Evaluation Workflow

```bash
# 1. Run detailed evaluation
/hooks-eval --detailed

# 2. Focus on security issues
/hooks-eval --security-only --format sarif

# 3. Benchmark performance
/hooks-eval --performance-baseline

# 4. Check compliance
/hooks-eval --compliance-report
```
**Verification:** Run the command with `--help` flag to verify availability.

## Integration with Other Tools

```bash
# Complete plugin evaluation pipeline
/hooks-eval --detailed          # Evaluate all hooks
/analyze-hook hooks/specific.py      # Deep-dive on one hook
/validate-plugin .                   # Validate overall structure
```
**Verification:** Run the command with `--help` flag to verify availability.

## Related Skills

- `abstract:hook-scope-guide` - Decide where to place hooks (plugin/project/global)
- `abstract:hook-authoring` - Write hook rules and patterns
- `abstract:validate-plugin` - Validate complete plugin structure
## Troubleshooting

### Common Issues

**Hook not firing**
Verify hook pattern matches the event. Check hook logs for errors

**Syntax errors**
Validate JSON/Python syntax before deployment

**Permission denied**
Check hook file permissions and ownership
