---
name: hook-authoring
description: |
  Guide for creating Claude Code hooks with security-first design. Use for validation, logging, and policy enforcement
version: 1.8.1
triggers:
  - hooks
  - sdk
  - security
  - performance
  - automation
  - validation
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/abstract", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: abstract
---

> **Night Market Skill** — ported from [claude-night-market/abstract](https://github.com/athola/claude-night-market/tree/master/plugins/abstract). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [Key Capabilities](#key-capabilities)
- [Quick Start](#quick-start)
- [Your First Hook (JSON - Claude Code)](#your-first-hook-json-claude-code)
- [Your First Hook (Python - Claude Agent SDK)](#your-first-hook-python-claude-agent-sdk)
- [Hook Event Types](#hook-event-types)
- [Claude Code vs SDK](#claude-code-vs-sdk)
- [JSON Hooks (Claude Code)](#json-hooks-claude-code)
- [Python SDK Hooks](#python-sdk-hooks)
- [Security Essentials](#security-essentials)
- [Critical Security Rules](#critical-security-rules)
- [Example: Secure Logging Hook](#example-secure-logging-hook)
- [Performance Guidelines](#performance-guidelines)
- [Performance Best Practices](#performance-best-practices)
- [Example: Efficient Hook](#example-efficient-hook)
- [Scope Selection](#scope-selection)
- [Decision Framework](#decision-framework)
- [Scope Comparison](#scope-comparison)
- [Common Patterns](#common-patterns)
- [Validation Hook](#validation-hook)
- [Logging Hook](#logging-hook)
- [Context Injection Hook](#context-injection-hook)
- [Testing Hooks](#testing-hooks)
- [Unit Testing](#unit-testing)
- [Module References](#module-references)
- [Tools](#tools)
- [Related Skills](#related-skills)
- [Next Steps](#next-steps)
- [References](#references)


# Hook Authoring Guide

## Overview

Hooks are event interceptors that allow you to extend Claude Code and Claude Agent SDK behavior by executing custom logic at specific points in the agent lifecycle. They enable validation before tool use, logging after actions, context injection, workflow automation, and security enforcement.

This skill teaches you how to write effective, secure, and performant hooks for both declarative JSON (Claude Code) and programmatic Python (Claude Agent SDK) use cases.

### Key Capabilities

- **PreToolUse**: Validate, filter, or transform tool inputs before execution; inject context (2.1.9+)
- **PostToolUse**: Log, analyze, or modify tool outputs after execution
- **UserPromptSubmit**: Inject context or filter user messages before processing
- **Stop/SubagentStop**: Cleanup, final reporting, or result aggregation
- **TeammateIdle/TaskCompleted**: Multi-agent coordination and orchestration (2.1.33+)
- **PreCompact**: State preservation before context window compaction

> **New in 2.1.9**: PreToolUse hooks can now return `additionalContext` to inject information before a tool executes. This enables patterns like cache hints, security warnings, or relevant context injection.

## Quick Start

### Your First Hook (JSON - Claude Code)

Create a simple logging hook in `.claude/settings.json`:

```json
{
  "PostToolUse": [
    {
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "echo \"$(date): Executed $CLAUDE_TOOL_NAME\" >> ~/.claude/audit.log"
      }]
    }
  ]
}
```

**Note**: Use string matchers (`"Bash"`) not object matchers (`{"toolName": "Bash"}`).

**Verification:** Run the command with `--help` flag to verify availability.

This logs every Bash command execution with a timestamp.

### Your First Hook (Python - Claude Agent SDK)

Create a validation hook using the SDK:

```python
from claude_agent_sdk import AgentHooks

class ValidationHooks(AgentHooks):
    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        """Validate tool inputs before execution."""
        if tool_name == "Bash":
            command = tool_input.get("command", "")
            if "rm -rf /" in command:
                raise ValueError("Dangerous command blocked by hook")

        # Return None to proceed unchanged, or modified dict to transform
        return None
```
**Verification:** Run the command with `--help` flag to verify availability.

## Hook Event Types

Quick reference for all supported hook events:

| Event | Trigger Point | Parameters | Common Use Cases |
|-------|--------------|------------|------------------|
| **PreToolUse** | Before tool execution | `tool_name`, `tool_input` | Validation, filtering, input transformation |
| **PostToolUse** | After tool execution | `tool_name`, `tool_input`, `tool_output` | Logging, metrics, output transformation |
| **UserPromptSubmit** | User sends message | `message` | Context injection, content filtering |
| **PermissionRequest** | Permission dialog shown | `tool_name`, `tool_input` | Auto-approve/deny with custom logic |
| **Notification** | Claude Code sends notification | `message` | Custom notification handling |
| **Stop** | Agent completes | `reason`, `result` | Final cleanup, summary reports |
| **SubagentStop** | Subagent completes | `subagent_id`, `result` | Result processing, aggregation |
| **TeammateIdle** | Teammate agent becomes idle | `agent_id`, `session_id` | Work assignment, load balancing (2.1.33+) |
| **TaskCompleted** | Task finishes execution | `task_id`, `result` | Coordination, chaining, reporting (2.1.33+) |
| **PreCompact** | Before context compact | `context_size` | State preservation, checkpointing |
| **SessionStart** | Session starts/resumes | `session_id`, `source`, `agent_type` | Initialization, context loading |
| **SessionEnd** | Session terminates | `session_id` | Cleanup, final logging |
| **WorktreeCreate** | Agent worktree created | `worktree_path`, `session_id` | Custom VCS setup, symlink .venv, pre-populate caches (2.1.50+) |
| **WorktreeRemove** | Agent worktree removed | `worktree_path`, `session_id` | Cleanup temp files, teardown worktree-scoped resources (2.1.50+) |

### SessionStart Input Schema (Claude Code 2.1.2+)

The SessionStart hook receives JSON input via stdin with these fields:

```json
{
  "session_id": "abc123",
  "source": "startup",
  "agent_type": "my-agent"
}
```

Fields: `source` is one of `"startup"`, `"resume"`, `"clear"`, or `"compact"`. `agent_type` is populated when the `--agent` flag is used.

**`agent_type` field**: When Claude Code is launched with `--agent my-agent`, this field contains the agent name, enabling agent-specific initialization:

```python
# Python example: Agent-aware SessionStart hook
input_data = json.loads(sys.stdin.read())
agent_type = input_data.get("agent_type", "")

if agent_type in ["code-reviewer", "quick-query"]:
    # Skip heavy context injection for lightweight agents
    print(json.dumps({"hookSpecificOutput": {"additionalContext": "Minimal context"}}))
else:
    # Full initialization for implementation agents
    print(json.dumps({"hookSpecificOutput": {"additionalContext": full_context}}))
```

```bash
# Bash example: Agent-aware SessionStart hook
HOOK_INPUT=$(cat)
AGENT_TYPE=$(echo "$HOOK_INPUT" | jq -r '.agent_type // empty')

case "$AGENT_TYPE" in
    code-reviewer|quick-query)
        echo '{"hookSpecificOutput": {"additionalContext": "Minimal context"}}'
        ;;
    *)
        echo '{"hookSpecificOutput": {"additionalContext": "Full context"}}'
        ;;
esac
```

## Hooks in Frontmatter (Claude Code 2.1.0+)

**New in 2.1.0:** Define hooks directly in skill, command, or agent frontmatter. These hooks are scoped to the component's lifecycle.

### Skill/Command/Agent Frontmatter Hooks

```yaml
---
name: validated-skill
description: Skill with lifecycle hooks
hooks:
  PreToolUse:
    - matcher: "Bash"
      command: "./validate-command.sh"
      once: true  # NEW: Run only once per session
    - matcher: "Write|Edit"
      command: "./pre-edit-check.sh"
  PostToolUse:
    - matcher: "Write|Edit"
      command: "./format-on-save.sh"
  Stop:
    - command: "./cleanup-and-report.sh"
---
```

### The `once: true` Configuration

**New in 2.1.0:** Use `once: true` to execute a hook only once per session, ideal for:
- One-time setup/initialization
- Resource allocation that shouldn't repeat
- Session-level configuration

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      command: "./setup-environment.sh"
      once: true  # Runs only on first Bash call
  SessionStart:
    - command: "./initialize-session.sh"
      once: true  # Runs only once at session start
```

### Frontmatter vs Settings Hooks

| Aspect | Frontmatter Hooks | Settings Hooks |
|--------|-------------------|----------------|
| Scope | Component lifecycle | Global/project |
| Location | In skill/agent/command | settings.json |
| Persistence | Active only when component runs | Always active |
| Use case | Component-specific validation | Cross-cutting concerns |

### PreToolUse updatedInput (2.1.0 Fix)

PreToolUse hooks can now return `updatedInput` when returning `ask` permission decision, enabling hooks to act as middleware while still requesting user consent:

```json
{
  "decision": "ask",
  "updatedInput": {
    "command": "modified-command --safe-flag"
  }
}
```

## Claude Code vs SDK

### JSON Hooks (Claude Code)

**Declarative configuration** in `.claude/settings.json`, project `.claude/settings.json`, or plugin `hooks/hooks.json`:

```json
{
  "PreToolUse": [
    {
      "matcher": "Edit",
      "hooks": [{
        "type": "command",
        "command": "echo 'WARNING: Editing production file' >&2"
      }]
    }
  ]
}
```

**Important**: Use string matchers (regex patterns), not object matchers. The object format `{"toolName": "Edit"}` is deprecated.

**Matcher patterns**:
- `"Edit"` - Match single tool
- `"Read|Write|Edit"` - Match multiple tools (regex OR)
- `".*"` - Match all tools

**Verification:** Run the command with `--help` flag to verify availability.

**Pros:** Simple, no code required, easy to version control
**Cons:** Limited logic capabilities, shell command only

### HTTP Hooks (Claude Code 2.1.63+)

**New in 2.1.63:** Hooks can POST JSON to a URL and receive JSON responses instead of running shell commands. Use `"type": "http"` with a `"url"` field:

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [{
        "type": "http",
        "url": "https://my-service.example.com/hooks/validate-bash"
      }]
    }
  ]
}
```

The hook POSTs the standard hook input as JSON and expects a standard hook response JSON body.

**When to use HTTP hooks over command hooks:**
- Enterprise environments where shell execution is restricted
- Centralized hook logic shared across teams via a web service
- Sandboxed or containerized setups without local script access
- Integration with external validation/logging services

**Pros:** No local scripts needed, centralized logic, works in sandboxed environments
**Cons:** Network latency, requires running HTTP service, external dependency

### Python SDK Hooks

**Programmatic callbacks** using `AgentHooks` base class:

```python
from claude_agent_sdk import AgentHooks

class MyHooks(AgentHooks):
    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        # Complex validation logic
        if self._is_dangerous(tool_input):
            raise ValueError("Operation blocked")
        return None  # or return modified input
```
**Verification:** Run the command with `--help` flag to verify availability.

**Pros:** Full Python capabilities, complex logic, state management
**Cons:** Requires Python, more complex setup

## Bash Permission Matching Notes

### Environment Variable Wrappers (2.1.38+)

Permission rules now correctly match commands prefixed with environment variable assignments. Before 2.1.38, `NODE_ENV=production npm test` would not match a rule for `Bash(npm *)`.

```
# These now all match `Bash(npm *)`:
npm test
NODE_ENV=production npm test
FORCE_COLOR=1 CI=true npm test
```

When writing PreToolUse hooks that inspect bash commands, be aware that the permission system strips env var prefixes for matching, but your hook receives the full command string including prefixes.

### Heredoc Delimiter Security (2.1.38+)

Claude Code now validates heredoc delimiters to prevent command smuggling. The recommended pattern `<<'EOF'` (single-quoted) remains the safest approach. Always use single-quoted delimiters in heredoc patterns to prevent variable expansion.

## Security Essentials

### Critical Security Rules

1. **Input Validation**: Always validate tool inputs before processing
2. **No Secret Logging**: Never log API keys, tokens, passwords, or credentials
3. **Sandbox Awareness**: Respect sandbox boundaries, don't escape. Note: `.claude/skills/` is read-only in sandbox mode (2.1.38+)
4. **Fail-Safe Defaults**: Return None on error instead of blocking the agent
5. **Rate Limiting**: Prevent hook abuse from malicious or buggy code
6. **Injection Prevention**: Sanitize all logged content to prevent log injection

### Example: Secure Logging Hook

```python
import re
from claude_agent_sdk import AgentHooks

class SecureLoggingHooks(AgentHooks):
    # Patterns that might contain secrets
    SECRET_PATTERNS = [
        r'api[_-]?key',
        r'password',
        r'token',
        r'secret',
        r'credential',
        r'auth',
    ]

    def _sanitize_output(self, text: str) -> str:
        """Remove potential secrets from log output."""
        for pattern in self.SECRET_PATTERNS:
            text = re.sub(
                rf'({pattern}["\s:=]+)([^\s,}}]+)',
                r'\1***REDACTED***',
                text,
                flags=re.IGNORECASE
            )
        return text

    async def on_post_tool_use(
        self, tool_name: str, tool_input: dict, tool_output: str
    ) -> str | None:
        """Log tool use with sanitization."""
        safe_output = self._sanitize_output(tool_output)
        # Log safe_output...
        return None  # Don't modify output
```
**Verification:** Run the command with `--help` flag to verify availability.

See `modules/testing-hooks.md` for detailed security guidance.

## Performance Guidelines

### Performance Best Practices

1. **Non-Blocking**: Use `async`/`await` properly, don't block the event loop
2. **Timeout Handling**: Hook timeout is 10 minutes (increased from 60s in 2.1.3). For most hooks, aim for < 30s; use extended time only for CI/CD integration, complex validation, or external API calls
3. **Efficient Logging**: Batch writes, use async I/O
4. **Memory Management**: Don't accumulate unbounded state
5. **Fail Fast**: Quick validation, early returns, avoid expensive operations

### Example: Efficient Hook

```python
import asyncio
from claude_agent_sdk import AgentHooks

class EfficientHooks(AgentHooks):
    def __init__(self):
        self._log_queue = asyncio.Queue()
        self._log_task = None

    async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
        # Quick validation only
        if not self._is_valid_input(tool_input):
            raise ValueError("Invalid input")
        return None

    async def on_post_tool_use(
        self, tool_name: str, tool_input: dict, tool_output: str
    ) -> str | None:
        # Queue log entry without blocking
        await self._log_queue.put({
            'tool': tool_name,
            'timestamp': time.time()
        })
        return None

    def _is_valid_input(self, tool_input: dict) -> bool:
        """Fast validation check."""
        # Simple checks only, < 10ms
        return len(str(tool_input)) < 1_000_000
```
**Verification:** Run the command with `--help` flag to verify availability.

See `modules/performance-guidelines.md` for detailed optimization techniques.

## Scope Selection

Choose the right location for your hooks based on audience and purpose.

### Important: Auto-Loading Behavior

> **`hooks/hooks.json` is automatically loaded** when a plugin is enabled.
> Do NOT add `"hooks": "./hooks/hooks.json"` to `plugin.json` - this causes duplicate load errors.
> Only use the `hooks` field for additional hook files beyond the standard location.

### Decision Framework

```
**Verification:** Run the command with `--help` flag to verify availability.
Is this hook part of a plugin's core functionality?
├─ YES → Plugin hooks (hooks/hooks.json in plugin)
└─ NO ↓

Should all team members on this project have this hook?
├─ YES → Project hooks (.claude/settings.json)
└─ NO ↓

Should this hook apply to all my Claude sessions?
├─ YES → Global hooks (~/.claude/settings.json)
└─ NO → Reconsider if you need a hook at all
```
**Verification:** Run the command with `--help` flag to verify availability.

### Scope Comparison

| Scope | Location | Audience | Committed? | Example Use Case |
|-------|----------|----------|------------|------------------|
| **Plugin** | `hooks/hooks.json` | Plugin users | Yes (with plugin) | YAML validation in YAML plugin |
| **Project** | `.claude/settings.json` | Team members | Yes (in repo) | Block production config edits |
| **Global** | `~/.claude/settings.json` | Only you | Never | Personal audit logging |

See `modules/scope-selection.md` for detailed scope decision guidance.

## Common Patterns

### Validation Hook

Block dangerous operations before execution:

```python
async def on_pre_tool_use(self, tool_name: str, tool_input: dict) -> dict | None:
    if tool_name == "Bash":
        command = tool_input.get("command", "")

        # Block dangerous patterns
        if any(pattern in command for pattern in ["rm -rf /", ":(){ :|:& };:"]):
            raise ValueError(f"Dangerous command blocked: {command}")

        # Block production access
        if "production" in command and not self._has_approval():
            raise ValueError("Production access requires approval")

    return None
```
**Verification:** Run the command with `--help` flag to verify availability.

### Logging Hook

Audit all tool operations:

```python
async def on_post_tool_use(
    self, tool_name: str, tool_input: dict, tool_output: str
) -> str | None:
    await self._log_entry({
        'timestamp': datetime.now().isoformat(),
        'tool': tool_name,
        'input_size': len(str(tool_input)),
        'output_size': len(tool_output),
        'success': True
    })
    return None
```
**Verification:** Run the command with `--help` flag to verify availability.

### Context Injection Hook

Add relevant context before user prompts:

```python
async def on_user_prompt_submit(self, message: str) -> str | None:
    # Inject project-specific context
    context = await self._load_project_context()
    enhanced_message = f"{context}\n\n{message}"
    return enhanced_message
```

### PreToolUse Context Injection (Claude Code 2.1.9+)

Inject context before a tool executes using `additionalContext`:

```python
#!/usr/bin/env python3
"""PreToolUse hook that injects context before WebFetch."""
import json
import sys

def main():
    payload = json.load(sys.stdin)
    tool_name = payload.get("tool_name", "")

    if tool_name == "WebFetch":
        url = payload.get("tool_input", {}).get("url", "")
        # Check cache or knowledge base
        cached = lookup_knowledge_base(url)
        if cached:
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "additionalContext": f"Relevant cached info: {cached}"
                }
            }))
    sys.exit(0)

if __name__ == "__main__":
    main()
```

This pattern is useful for: cache hints before web requests, security warnings before risky operations, and injecting relevant project context before file operations.

## Testing Hooks

### Unit Testing

```python
import pytest
from my_hooks import ValidationHooks

@pytest.mark.asyncio
async def test_dangerous_command_blocked():
    hooks = ValidationHooks()

    with pytest.raises(ValueError, match="Dangerous command"):
        await hooks.on_pre_tool_use("Bash", {"command": "rm -rf /"})

@pytest.mark.asyncio
async def test_safe_command_allowed():
    hooks = ValidationHooks()
    result = await hooks.on_pre_tool_use("Bash", {"command": "ls -la"})
    assert result is None  # Allows execution
```
**Verification:** Run `pytest -v from` to verify.

See `modules/testing-hooks.md` for detailed testing strategies.

## Module References

For detailed guidance on specific topics:

- **Hook Types**: `modules/hook-types.md` - Detailed event signatures and parameters
- **SDK Callbacks**: `modules/sdk-callbacks.md` - Python SDK implementation patterns
- **Security Patterns**: `modules/testing-hooks.md` - detailed security guidance
- **Performance Guidelines**: `modules/performance-guidelines.md` - Optimization techniques
- **Scope Selection**: `modules/scope-selection.md` - Choosing plugin/project/global
- **Testing Hooks**: `modules/testing-hooks.md` - Testing strategies and fixtures

## Tools

- **hook_validator.py**: Validate hook structure and syntax (in `scripts/`)

## Related Skills

- **hook-scope-guide**: Decision framework for hook placement (existing)
- **modular-skills**: Design patterns for skill architecture
- **skills-eval**: Quality assessment and improvement framework

## Next Steps

1. Choose your hook type (JSON vs SDK) based on complexity needs
2. Select the appropriate scope (plugin/project/global)
3. Implement following security and performance best practices
4. Test thoroughly with unit and integration tests
5. Validate using `hook_validator.py` before deployment

## Environment Variables (Claude Code 2.1.2+)

### `FORCE_AUTOUPDATE_PLUGINS`

Forces plugin auto-update even when the main Claude Code auto-updater is disabled.

**Use cases**:
- CI/CD pipelines that need latest plugin versions
- Development environments testing plugin updates
- Controlled update rollouts in enterprise settings

```bash
# Enable forced plugin updates
export FORCE_AUTOUPDATE_PLUGINS=1
claude

# Or inline
FORCE_AUTOUPDATE_PLUGINS=1 claude --agent my-agent
```

**Note**: This only affects plugin updates, not Claude Code core updates.

## References

- [Claude Code Hooks Documentation](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [Claude Agent SDK Documentation](https://docs.anthropic.com/en/docs/claude-agent-sdk)
- [Settings Configuration](https://docs.anthropic.com/en/docs/claude-code/settings)
## Hook Exit Codes

Hooks communicate decisions to Claude Code via exit codes:

| Exit Code | Meaning | stdout | stderr |
|-----------|---------|--------|--------|
| **0** | Success/allow | Shown to Claude as system context | Ignored |
| **2** | Block/deny | Ignored | Shown to user as explanation (2.1.39+ fix) |
| **Other** | Error | Ignored | Shown to user as error message |

### Blocking with Exit Code 2 (2.1.39+)

Use exit code 2 to block an action and display a message to the user:

```bash
#!/bin/bash
# Example: Block force pushes with user-facing message
command=$(echo "$1" | jq -r '.tool_input.command // empty')
if echo "$command" | grep -q 'push.*--force'; then
  echo "Force push blocked: use --force-with-lease instead" >&2
  exit 2
fi
exit 0
```

**Important**: Before Claude Code 2.1.39, stderr from exit code 2 was silently swallowed ([#10964](https://github.com/anthropics/claude-code/issues/10964)). Users would see a generic "hook error" instead of the custom message. This is now fixed — stderr is properly displayed to the user.

**Plugin hooks**: Before 2.1.39, plugin-installed hooks had a separate code path that also failed to show stderr for exit code 2 ([#10412](https://github.com/anthropics/claude-code/issues/10412)). Both plugin and project hooks now work correctly.

## Troubleshooting

### Common Issues

**Hook not firing**
Verify hook pattern matches the event. Check hook logs for errors

**Syntax errors**
Validate JSON/Python syntax before deployment

**Permission denied**
Check hook file permissions and ownership

**Hook blocking message not shown (pre-2.1.39)**
If using exit code 2 to block with a user-facing message and the message isn't appearing, upgrade to Claude Code 2.1.39+. In older versions, use exit 0 with stdout as a workaround.
