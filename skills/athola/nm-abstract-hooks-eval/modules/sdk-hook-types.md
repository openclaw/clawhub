# Python SDK Hook Types

Complete reference for Claude Agent SDK hook types, callbacks, and matchers.

## Hook Events

### HookEvent

Supported hook event types in the Python SDK.

```python
from typing import Literal

HookEvent = Literal[
    "Setup",             # Called when plugin installed/enabled
    "SessionStart",      # Called when session begins
    "SessionEnd",        # Called when session ends normally
    "UserPromptSubmit",  # Called when user submits a prompt
    "PreToolUse",        # Called before tool execution
    "PostToolUse",       # Called after tool execution
    "PostToolUseFailure",# Called when tool execution fails (2.1.20+)
    "PermissionRequest", # Called when permission dialog would appear
    "Notification",      # Called on system notification (2.1.20+)
    "SubagentStart",     # Called when subagent spawns (2.1.20+)
    "SubagentStop",      # Called when a subagent stops
    "Stop",              # Called when stopping execution
    "TeammateIdle",      # Called when teammate agent becomes idle (2.1.33+)
    "TaskCompleted",     # Called when a task finishes execution (2.1.33+)
    "ConfigChange",      # Called when config is modified (2.1.49+)
    "InstructionsLoaded",# Called when instructions are loaded (2.1.33+)
    "PreCompact",        # Called before message compaction
    "WorktreeCreate",    # Called when git worktree is created (2.1.50+)
    "WorktreeRemove",    # Called when git worktree is removed (2.1.50+)
]
```

**SDK vs CLI availability**: Most events work in both JSON
hooks (CLI) and Python SDK hooks. `PermissionRequest` is
CLI-only. `Setup`, `SessionStart`, `SessionEnd`, and
`Notification` are CLI-only (JSON hooks).
`WorktreeCreate` and `WorktreeRemove` are command-only
hooks (no Python SDK callback). They do not support
matchers.

### Event Descriptions

| Event | Trigger | Common Uses |
|-------|---------|-------------|
| `Setup` | Plugin installed/enabled | One-time initialization |
| `SessionStart` | Session begins | Initialize state, load config |
| `SessionEnd` | Session ends normally | Cleanup, persist state |
| `UserPromptSubmit` | User submits input | Input validation, preprocessing, redaction |
| `PreToolUse` | Before any tool runs | Validation, blocking dangerous commands, logging |
| `PostToolUse` | After tool completes | Audit logging, result transformation, cleanup |
| `PostToolUseFailure` | Tool execution fails | Error handling, fallback logic (2.1.20+) |
| `PermissionRequest` | Permission dialog would appear | Auto-approve safe ops, block dangerous commands |
| `Notification` | System notification | Forward alerts, log events (2.1.20+) |
| `SubagentStart` | Subagent spawns | Track agent lifecycle (2.1.20+) |
| `SubagentStop` | Subagent completes | Coordination, result aggregation |
| `Stop` | Agent stops | Cleanup, final logging, state persistence |
| `TeammateIdle` | Teammate agent idle | Work assignment, load balancing (2.1.33+) |
| `TaskCompleted` | Task finishes | Coordination, chaining, reporting (2.1.33+) |
| `ConfigChange` | Config modified | React to settings changes (2.1.49+) |
| `InstructionsLoaded` | Instructions loaded | Augment instructions (2.1.33+) |
| `PreCompact` | Before message compaction | Context preservation, important info extraction |
| `WorktreeCreate` | Git worktree created | Initialize worktree state (2.1.50+) |
| `WorktreeRemove` | Git worktree removed | Cleanup worktree state (2.1.50+) |

### Hook Event Fields: agent_id and agent_type (2.1.69+)

All hook events now include `agent_id` (for subagent
sessions) and `agent_type` (for subagent and `--agent`
sessions). Evaluate whether hooks under review should
filter or branch on these fields for agent-specific
behavior.

### TeammateIdle / TaskCompleted: continue: false (2.1.69+)

`TeammateIdle` and `TaskCompleted` hooks now support
returning `{"continue": false, "stopReason": "..."}` to
stop the teammate, matching `Stop` hook behavior.
Evaluate whether hooks that respond to these events
should use this capability for graceful teammate
shutdown.

### WorktreeCreate / WorktreeRemove Plugin Fix (2.1.69+)

Plugin-registered WorktreeCreate and WorktreeRemove
hooks were silently ignored before 2.1.69. They now
fire correctly. If evaluating plugins that register
these hooks, verify they were tested on 2.1.69+.

### Cron Scheduling Tools (2.1.71+)

Three new built-in tools: `CronCreate`, `CronList`,
`CronDelete`. These appear as tool names in
`PreToolUse` and `PostToolUse` hook events. The `/loop`
command uses `CronCreate` internally.

`CronCreate` accepts: `cron` (5-field expression in
local timezone), `prompt`, `recurring` (default true),
and `durable` (default false; true persists to
`.claude/scheduled_tasks.json` across restarts).
Recurring tasks auto-expire after 7 days. Tasks fire
only while the REPL is idle, with deterministic jitter.

Evaluate whether hooks matching on tool names need to
handle these new tools (e.g., quota tracking, audit
logging, budget enforcement for durable tasks).

### Heredoc Permission Fix (2.1.71+)

Compound bash commands containing heredoc commit
messages no longer trigger false-positive permission
prompts. `PermissionRequest` hooks should not expect
to see these commands. The fix applies to the built-in
allowlist pattern matching, not to hook behavior.

### ExitWorktree Tool (2.1.72+)

New `ExitWorktree` tool (actions: `"keep"`, `"remove"`)
appears in `PreToolUse`/`PostToolUse` events. Evaluate
whether hooks matching on tool names need to handle
worktree exit (e.g., cleanup, state persistence).

### Bash Allowlist Expansion (2.1.72+)

Added `lsof`, `pgrep`, `tput`, `ss`, `fd`, `fdfind`
to auto-approval. These no longer trigger
`PermissionRequest` events.

### Hooks Fixes (2.1.72+)

When evaluating hooks, check for these fixed issues:

- **Skill hook double-fire**: Hooks-enabled skills no
  longer fire hooks twice per event. If a hook relied
  on the duplicate behavior, it needs adjustment.
- **transcript_path**: Now correct for resumed/forked
  sessions. Hooks using this field for log correlation
  get accurate paths.
- **Agent prompt persistence**: Agent prompt is no
  longer silently deleted from settings.json on every
  settings write.
- **PostToolUse block reason**: No longer displays
  twice. Hooks that parsed doubled reasons need update.
- **Async hooks stdin**: Now receive stdin with
  `bash read -r`. Hooks using interactive input work.

### CLAUDE.md Comment Visibility (2.1.72+)

HTML comments (`<!-- ... -->`) in CLAUDE.md are hidden
from auto-injection but visible via Read tool. Evaluate
whether hooks relying on comment content in
`InstructionsLoaded` events are affected.

### Parallel Tool Call Cascade (2.1.72+)

Failed `Read`/`WebFetch`/`Glob` no longer cancel
sibling tool calls. Only `Bash` errors cascade.
Evaluate whether `PostToolUseFailure` hooks need
adjustment for the changed cascade behavior.

### Hook Source Display (2.1.75+)

Permission prompts for hooks now display the hook source:
`settings`, `plugin`, or `skill`. Evaluate whether hooks
under review that require confirmation benefit from
clearer source attribution for user trust decisions.

### Async Hook Messages Suppressed (2.1.75+)

Async hook completion messages are suppressed by default.
Visible via `--verbose`, transcript mode, or `Ctrl+O`.
Evaluate whether hooks under review relied on visible
completion messages for debugging or user feedback.
Those hooks should document the `--verbose` requirement.

### Hook Conditional `if` Field (2.1.85+)

Hooks support `if` field (permission rule syntax, e.g.,
`"Bash(git *)"`) on tool events only. Reduces process
spawning by evaluating conditions in-process. Evaluate
whether hooks under review can use `if` to narrow
execution scope and reduce overhead.

### PreToolUse AskUserQuestion Support (2.1.85+)

PreToolUse hooks can match `AskUserQuestion` and return
`updatedInput` with `permissionDecision: "allow"` to
answer programmatically. Evaluate whether hooks under
review target headless/CI scenarios requiring this.

### StopFailure Hook (2.1.78+)

Non-blockable. Matcher on error type (`rate_limit`,
`authentication_failed`, etc.). Evaluate for logging
and alerting.

### TaskCreated Hook (2.1.84+)

Blockable (exit code 2). No matcher. Evaluate for task
audit or policy enforcement.

### CwdChanged/FileChanged Hooks (2.1.83+)

Both non-blockable. CwdChanged: no matcher. FileChanged:
matcher on filename. Both have CLAUDE_ENV_FILE access.
Evaluate for reactive environment hooks (direnv).

### WorktreeCreate HTTP Support (2.1.84+)

HTTP hooks can return worktree path via
`hookSpecificOutput.worktreePath`. Evaluate for remote
worktree creation services.

### PreToolUse "allow" Bypass Fix (2.1.77+)

PreToolUse hooks returning `"allow"` could bypass `deny`
permission rules including managed settings. Fixed: hook
allow decisions are now checked after deny rules.
Precedence: managed deny > hook deny > permission deny >
hook allow > permission allow. Evaluate whether hooks
under review depend on `"allow"` overriding deny rules
(this is no longer possible and was a security bug).

### MCP Elicitation Hooks (2.1.76+)

Two new events: `Elicitation` (blockable, fires on
`elicitation/create` from MCP server) and
`ElicitationResult` (blockable, fires after user
responds before response reaches server). Both support
`hookSpecificOutput` for auto-filling or overriding
responses. Matcher filters on `mcp_server_name`.
Evaluate whether hooks under review should intercept
MCP elicitation for audit logging, policy enforcement,
or response validation.

### PostCompact Hook (2.1.76+)

Fires after context compaction completes (manual or
auto). Non-blockable. Input includes `trigger`
(`"manual"`/`"auto"`) and `compact_summary`. Evaluate
whether hooks under review should re-inject critical
instructions post-compaction (PreCompact content gets
summarized and loses fidelity; PostCompact content
appears verbatim).

### SessionEnd Hooks Timeout Fix (2.1.74+)

SessionEnd hooks were killed after 1.5s regardless of
`hook.timeout`. Now configurable via
`CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`. Evaluate
whether hooks under review that use SessionEnd for
cleanup or metrics need this timeout extended.

### New Hook Events (2.1.74+)

Documentation now includes: `CwdChanged`, `FileChanged`,
`PostCompact`, `TaskCreated` (blockable), `StopFailure`,
`Elicitation` (blockable), `ElicitationResult`. Evaluate
whether hooks under review should handle these events
for directory tracking, file watching, compaction
response, or MCP elicitation interception.

### SessionStart Resume Double-Fire Fix (2.1.73+)

SessionStart hooks previously fired twice when resuming
via `--resume` or `--continue`. Now they fire once.
Evaluate whether hooks that perform one-time
initialization in SessionStart need deduplication guards
removed (they are no longer necessary on 2.1.73+).

### JSON-Output Hooks Fix (2.1.73+)

JSON-output hooks previously injected no-op
system-reminder messages into model context on every
turn. Fixed in 2.1.73. Evaluate whether hooks using
JSON output format were affected by inflated token
counts from spurious context injections.

### HTTP Hooks (2.1.63+)

Hooks can use `"type": "http"` to POST JSON to a URL
instead of running shell commands. Evaluate whether
hooks under review could benefit from HTTP execution
(enterprise environments, sandboxed runtimes, webhook
integrations).

### Security: Workspace Trust (2.1.51+)

`statusLine` and `fileSuggestion` hook commands now
require workspace trust acceptance in interactive mode.
Hooks that output these commands will fail silently in
untrusted workspaces. Evaluate whether any hooks under
review depend on these output types.

## Type Definitions

### HookCallback

Type definition for hook callback functions.

```python
from typing import Any, Awaitable, Callable

HookCallback = Callable[
    [dict[str, Any], str | None, HookContext],
    Awaitable[dict[str, Any]]
]
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `input_data` | `dict[str, Any]` | Hook-specific input data (varies by event) |
| `tool_use_id` | `str \| None` | Tool use identifier (for tool-related hooks) |
| `context` | `HookContext` | Additional context information |

**Returns:** `dict[str, Any]` containing optional fields:

| Field | Type | Description |
|-------|------|-------------|
| `decision` | `str` | Set to `"block"` to block the action |
| `systemMessage` | `str` | System message to add to transcript |
| `hookSpecificOutput` | `dict` | Hook-specific output data |

### HookContext

Context information passed to hook callbacks.

```python
from dataclasses import dataclass
from typing import Any

@dataclass
class HookContext:
    signal: Any | None = None  # Future: abort signal support
```

**Note**: The `signal` field is reserved for future abort signal support.

### HookMatcher

Configuration for matching hooks to specific events or tools.

```python
from dataclasses import dataclass, field
from typing import List

@dataclass
class HookMatcher:
    matcher: str | None = None        # Tool name or pattern (e.g., "Bash", "Write|Edit")
    hooks: list[HookCallback] = field(default_factory=list)  # Callbacks to run
    timeout: float | None = None      # Timeout in seconds (default: 60)
```

**Matcher Patterns:**

| Pattern | Matches |
|---------|---------|
| `"Bash"` | Only Bash tool |
| `"Write\|Edit"` | Write OR Edit tools |
| `"Read"` | Only Read tool |
| `None` | All tools (universal matcher) |

**Timeout Behavior:**
- Default timeout is 60 seconds
- Set custom timeout per matcher
- Hook is cancelled if timeout exceeded

## Complete Usage Example

```python
from claude_agent_sdk import query, ClaudeAgentOptions, HookMatcher, HookContext
from typing import Any

async def validate_bash_command(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext
) -> dict[str, Any]:
    """Validate and potentially block dangerous bash commands."""
    if input_data['tool_name'] == 'Bash':
        command = input_data['tool_input'].get('command', '')
        if 'rm -rf /' in command:
            return {
                'hookSpecificOutput': {
                    'hookEventName': 'PreToolUse',
                    'permissionDecision': 'deny',
                    'permissionDecisionReason': 'Dangerous command blocked'
                }
            }
    return {}

async def log_tool_use(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext
) -> dict[str, Any]:
    """Log all tool usage for auditing."""
    print(f"Tool used: {input_data.get('tool_name')}")
    return {}

# Configure hooks
options = ClaudeAgentOptions(
    hooks={
        'PreToolUse': [
            HookMatcher(
                matcher='Bash',
                hooks=[validate_bash_command],
                timeout=120  # 2 minutes for validation
            ),
            HookMatcher(
                hooks=[log_tool_use]  # Applies to all tools (default 60s)
            )
        ],
        'PostToolUse': [
            HookMatcher(hooks=[log_tool_use])
        ]
    }
)

# Run with hooks
async for message in query(
    prompt="Analyze this codebase",
    options=options
):
    print(message)
```

## Input Data by Event Type

### PreToolUse Input

```python
{
    "tool_name": "Bash",           # Name of tool being called
    "tool_input": {                # Tool-specific parameters
        "command": "ls -la",
        "timeout": 30000
    }
}
```

### PostToolUse Input

```python
{
    "tool_name": "Bash",
    "tool_input": {"command": "ls -la"},
    "tool_result": "file1.txt\nfile2.txt",  # Tool output
    "error": None                            # Error if failed
}
```

### PermissionRequest Input (Claude Code CLI only)

```python
{
    "session_id": "abc123",
    "hook_event_name": "PermissionRequest",
    "tool_name": "Bash",
    "tool_input": {
        "command": "npm install"
    },
    "tool_use_id": "toolu_01ABC123...",
    "permission_mode": "default",
    "cwd": "/path/to/project",
    "transcript_path": "/Users/.../.claude/projects/.../session.jsonl"
}
```

**PermissionRequest Output** (JSON to stdout):

```python
# To allow (bypasses permission dialog)
{
    "hookSpecificOutput": {
        "hookEventName": "PermissionRequest",
        "decision": {
            "behavior": "allow",
            "updatedInput": {"command": "npm install --save"}  # Optional
        }
    }
}

# To deny (blocks operation)
{
    "hookSpecificOutput": {
        "hookEventName": "PermissionRequest",
        "decision": {
            "behavior": "deny",
            "message": "Reason for denial",  # Optional
            "interrupt": True                 # Optional: stop execution
        }
    }
}
```

### UserPromptSubmit Input

```python
{
    "prompt": "User's input text",
    "conversation_id": "conv_123"
}
```

### TeammateIdle Input (2.1.33+)

```python
{
    "agent_id": "teammate-abc123",   # ID of the idle teammate
    "session_id": "sess_456"         # Session the teammate belongs to
}
```

### TaskCompleted Input (2.1.33+)

```python
{
    "task_id": "task_789",           # ID of the completed task
    "result": "...",                 # Task result/output
    "duration_ms": 15000,            # Time taken
    "token_count": 8500              # Tokens consumed
}
```

### Stop / SubagentStop Input

```python
{
    "reason": "completed",         # Why stopped
    "final_message": "..."         # Last assistant message
}
```

### PreCompact Input

```python
{
    "messages": [...],             # Messages to be compacted
    "token_count": 50000           # Current token count
}
```

### WorktreeCreate Input (2.1.50+, command-only)

WorktreeCreate hooks are command-only (`type: "command"`).
They do not support matchers and always fire on every
worktree creation. The hook MUST print the absolute path
to the created worktree directory on stdout. If the hook
fails or produces no output, worktree creation fails.

```python
# Input (JSON on stdin)
{
    "session_id": "sess_abc123",
    "hook_event_name": "WorktreeCreate",
    "cwd": "/path/to/project",
    "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
    "name": "feature-branch"        # Requested worktree name
}
# Output: print absolute worktree path on stdout
# e.g., print("/tmp/worktrees/feature-branch")
```

### WorktreeRemove Input (2.1.50+, command-only)

WorktreeRemove hooks cannot block removal. They fire for
cleanup (removing VCS state, archiving changes). No
matchers supported.

```python
# Input (JSON on stdin)
{
    "session_id": "sess_abc123",
    "hook_event_name": "WorktreeRemove",
    "cwd": "/path/to/project",
    "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
    "worktree_path": "/tmp/worktrees/feature-branch"
}
```

## Hook Return Patterns

### Allow (Default)

```python
return {}  # Empty dict = allow action to proceed
```

### Block Action

```python
return {
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "Explanation of why blocked"
    }
}
```

### Add System Message

```python
return {
    "systemMessage": "Important context added to conversation"
}
```

### Block with Reason

```python
return {
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "Contains dangerous pattern",
    }
}
```

## Common Hook Patterns

### Security Validation Hook

```python
DANGEROUS_PATTERNS = ['rm -rf', 'DROP TABLE', ':(){:|:&};:']

async def security_validator(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext
) -> dict[str, Any]:
    """Block commands containing dangerous patterns."""
    if input_data['tool_name'] == 'Bash':
        command = input_data['tool_input'].get('command', '')
        for pattern in DANGEROUS_PATTERNS:
            if pattern in command:
                return {
                    'hookSpecificOutput': {
                        'hookEventName': 'PreToolUse',
                        'permissionDecision': 'deny',
                        'permissionDecisionReason': f'Blocked: contains "{pattern}"'
                    }
                }
    return {}
```

### Audit Logging Hook

```python
import json
from datetime import datetime

async def audit_logger(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext
) -> dict[str, Any]:
    """Log all tool usage to audit file."""
    log_entry = {
        'timestamp': datetime.now().isoformat(),
        'tool_name': input_data.get('tool_name'),
        'tool_use_id': tool_use_id,
        'input_summary': str(input_data.get('tool_input', {}))[:200]
    }
    with open('audit.log', 'a') as f:
        f.write(json.dumps(log_entry) + '\n')
    return {}
```

### Rate Limiting Hook

```python
from collections import defaultdict
from time import time

call_counts: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT = 10  # calls per minute

async def rate_limiter(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext
) -> dict[str, Any]:
    """Limit tool calls to prevent runaway invocations."""
    tool_name = input_data.get('tool_name', 'unknown')
    now = time()

    # Clean old entries
    call_counts[tool_name] = [t for t in call_counts[tool_name] if now - t < 60]

    if len(call_counts[tool_name]) >= RATE_LIMIT:
        return {
            'hookSpecificOutput': {
                'hookEventName': 'PreToolUse',
                'permissionDecision': 'deny',
                'permissionDecisionReason': f'Rate limit exceeded for {tool_name}'
            }
        }

    call_counts[tool_name].append(now)
    return {}
```

## Best Practices

### Performance

- Keep hooks fast (<100ms for PreToolUse, <200ms for PostToolUse)
- Use appropriate timeouts to prevent hangs
- Avoid blocking I/O in hook callbacks
- Cache expensive computations

### Security

- Validate all input data before processing
- Never use dynamic code evaluation with hook input
- Sanitize any data written to logs
- Use allowlists over blocklists when possible

### Reliability

- Always return a dict (even empty `{}`)
- Handle exceptions gracefully
- Design hooks to be idempotent
- Include meaningful error messages in block reasons

### Testing

- Test hooks with various input patterns
- Verify timeout behavior
- Test error conditions
- Benchmark performance under load
