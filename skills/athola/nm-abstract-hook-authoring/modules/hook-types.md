# Hook Types Overview

Claude Code hook lifecycle events and their use cases. Hooks intercept specific moments in the session to inject context, validate actions, or transform outputs.

## Quick Reference (Claude Code 2.1.50)

### Lifecycle Hooks
- **Setup**: One-time plugin initialization
- **SessionStart**: Session initialization, context setup
- **SessionEnd**: Session cleanup, metrics collection
- **Stop**: Graceful shutdown, final logging

### Tool Execution Hooks
- **PreToolUse**: Validation, logging, state management
- **PostToolUse**: Result processing, metrics, cleanup
- **PostToolUseFailure**: Error handling, fallback (2.1.20+)

### Permission Hooks
- **PermissionRequest**: Auto-approve/deny patterns

### Communication Hooks
- **UserPromptSubmit**: Input validation, routing
- **Notification**: System notification forwarding (2.1.20+)

### Agent Coordination Hooks
- **SubagentStart**: Track agent spawns (2.1.20+)
- **SubagentStop**: Collect results, cleanup
- **TeammateIdle**: Work assignment (2.1.33+).
  Supports `{"continue": false}` to stop teammate
  (2.1.69+).
- **TaskCompleted**: Task chaining (2.1.33+).
  Supports `{"continue": false}` to stop teammate
  (2.1.69+).

### Configuration Hooks
- **ConfigChange**: React to settings changes (2.1.49+)
- **InstructionsLoaded**: Augment instructions (2.1.33+)

### Context Hooks
- **PreCompact**: Preserve critical context before compaction

### Worktree Hooks (2.1.50+, plugin fix 2.1.69+)
- **WorktreeCreate**: Initialize worktree state.
  Command-only (no Python SDK callback, no matchers).
  Must print absolute worktree path on stdout.
  Plugin-registered hooks were silently ignored before
  2.1.69; now they fire correctly.
- **WorktreeRemove**: Cleanup worktree state.
  Command-only (no Python SDK callback, no matchers).
  Receives `worktree_path` in input. Cannot block
  removal. Plugin-registered hooks were silently
  ignored before 2.1.69; now they fire correctly.

### ExitWorktree Tool (2.1.72+)

New built-in tool to leave an `EnterWorktree` session
mid-conversation. Parameters:

- `action` (required): `"keep"` (leave worktree on disk)
  or `"remove"` (delete worktree and branch)
- `discard_changes` (optional, default false): required
  `true` when action is `"remove"` and the worktree has
  uncommitted files or unmerged commits

Restores the session CWD and clears CWD-dependent
caches (system prompt, memory files, plans). Hooks can
match on `ExitWorktree` in `PreToolUse`/`PostToolUse`.

**Worktree isolation fixes (2.1.72+)**: Task tool
resume now correctly restores CWD in worktree sessions.
Background task notifications include `worktreePath`
and `worktreeBranch` fields.

### HTTP Hooks (2.1.63+)

Hooks can POST JSON to a URL instead of running shell
commands. Use `"type": "http"` with a `"url"` field.
The hook POSTs the standard hook input as JSON and
expects a standard hook response JSON body. Useful for
enterprise/sandboxed environments where shell execution
is restricted. See `Skill(abstract:hook-authoring)` for
full configuration details.

### Hook Event Fields: agent_id and agent_type (2.1.69+)

All hook events now include an `agent_id` field for
subagent sessions and an `agent_type` field for both
subagent sessions and `--agent` invocations. Use these
fields to distinguish which agent triggered the hook
and to implement agent-specific hook logic.

```json
{
  "session_id": "sess_abc",
  "hook_event_name": "PreToolUse",
  "agent_id": "backend@my-team",
  "agent_type": "implementer",
  "tool_name": "Bash",
  "tool_input": { "command": "make test" }
}
```

Status line hooks also gain a `worktree` field
(2.1.69+) containing `name`, `path`, `branch`, and
`originalRepoDir` when running in a `--worktree`
session.

### Cron Scheduling Tools (2.1.71+)

Three new built-in tools for scheduled tasks:
`CronCreate`, `CronList`, and `CronDelete`. Hooks can
match on these tool names in `PreToolUse` and
`PostToolUse` events. The `/loop` command uses
`CronCreate` internally.

**CronCreate parameters:**

- `cron` (string, required): Standard 5-field cron
  expression in local timezone
  (`minute hour day-of-month month day-of-week`)
- `prompt` (string, required): The prompt to enqueue
  at each fire time
- `recurring` (boolean, default true): true = fire on
  every cron match until deleted or auto-expired.
  false = fire once then auto-delete (one-shot reminders)
- `durable` (boolean, default false): true = persist to
  `.claude/scheduled_tasks.json` and survive restarts.
  false = in-memory only, dies when session ends

**CronList**: No parameters. Returns all tasks with IDs.

**CronDelete**: Takes `id` (string) from CronCreate.

**Scheduling behavior:**

- Sessions hold up to 50 tasks
- Recurring tasks auto-expire after 7 days
- Tasks fire only while the REPL is idle (not mid-query)
- Jitter: recurring tasks fire up to 10% of their period
  late (max 15 min); one-shot tasks at :00/:30 fire up
  to 90s early. Prefer off-minute scheduling to spread
  API load.
- Disable entirely with `CLAUDE_CODE_DISABLE_CRON=1`.
  As of 2.1.72, this also stops scheduled jobs
  mid-session (previously only prevented new jobs).

### Bash Auto-Approval Expansion (2.1.71+)

Added to the default bash auto-approval allowlist:
`fmt`, `comm`, `cmp`, `numfmt`, `expr`, `test`,
`printf`, `getconf`, `seq`, `tsort`, and `pr`. These
are standard POSIX text/math utilities that execute
without permission prompts. Hooks using
`PermissionRequest` should account for these commands
no longer triggering permission events.

### Heredoc Permission Fix (2.1.71+)

Compound bash commands containing heredoc commit
messages no longer trigger false-positive permission
prompts. This fixes the common pattern:

```bash
git commit -m "$(cat <<'EOF'
feat: my commit message
EOF
)"
```

Previously this could prompt for permission even when
`Bash(git commit *)` was in the allow list.

### Bash Auto-Approval Expansion (2.1.72+)

Added to the auto-approval allowlist: `lsof`, `pgrep`,
`tput`, `ss`, `fd`, and `fdfind`. These read-only
system inspection and file-finding utilities no longer
trigger `PermissionRequest` events.

### Skill Hook Double-Fire Fix (2.1.72+)

Skill hooks no longer fire twice per event when a
hooks-enabled skill is invoked by the model. Previously,
both the skill's hooks and the plugin's hooks would
fire for the same event, producing duplicate log
entries and potentially double-counting metrics.

### Hooks Fixes (2.1.72+)

- `transcript_path` now points to the correct directory
  for resumed (`--continue`) and forked (`/fork`)
  sessions. Previously it pointed to the original
  session's transcript.
- The agent prompt is no longer silently deleted from
  `settings.json` on every settings write.
- `PostToolUse` block reason no longer displays twice.
- Async hooks now receive stdin when using
  `bash read -r` (previously stdin was closed).

### CLAUDE.md Comment Hiding (2.1.72+)

HTML comments (`<!-- ... -->`) in CLAUDE.md files are
hidden from Claude when auto-injected into context.
Comments remain visible when read with the Read tool.
This means CLAUDE.md comments can contain human-only
notes without consuming context tokens.

### Permission Rule Matching Fixes (2.1.72+)

- Wildcard rules now match commands with heredocs,
  embedded newlines, or no arguments
- `sandbox.excludedCommands` works with env var
  prefixes (e.g., `FOO=bar command`)
- "Always Allow" no longer suggests overly broad
  prefixes for nested CLI tools
- Deny rules apply to all command forms

### Parallel Tool Call Cascade Fix (2.1.72+)

Failed `Read`, `WebFetch`, or `Glob` no longer cancels
sibling parallel tool calls. Only `Bash` errors
cascade. This improves reliability of parallel agent
dispatch and multi-file reading operations.

### Security: Workspace Trust (2.1.51+)

Hook commands that emit `statusLine` or `fileSuggestion`
now require workspace trust acceptance in interactive
mode. Untrusted hooks cannot execute these commands
until the user has accepted workspace trust. If your
hook outputs status line updates or file suggestions,
test it in both trusted and untrusted workspace contexts.

## Hook Source Display (2.1.75+)

When a hook requires user confirmation, the permission
prompt now displays the source of the hook: `settings`,
`plugin`, or `skill`. This improves visibility into
where permission requests originate. Use this to audit
which plugins trigger which permission prompts.

## Async Hook Completion Messages Suppressed (2.1.75+)

Async hook completion messages (e.g., "Async hook
UserPromptSubmit completed") are now suppressed by
default. Previously, every async hook completion
generated visible status line noise. Still visible via
`--verbose` flag, transcript mode, or `Ctrl+O` toggle.

Hooks that relied on visible completion messages for
debugging should use `--verbose` mode. No per-hook
`silent` configuration was added; the default behavior
changed globally.

## Hook Conditional `if` Field (2.1.85+)

Hooks now support an `if` field using permission rule
syntax to filter when they run. Only evaluated on tool
events: PreToolUse, PostToolUse, PostToolUseFailure,
PermissionRequest. On other events, hooks with `if`
never fire.

Reduces process spawning: without `if`, a hook with
`matcher: "Bash"` spawns a process for every Bash call.
With `if: "Bash(git *)"`, the condition is evaluated
in-process before any subprocess.

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "if": "Bash(rm -rf *)",
        "command": "block-rm.sh",
        "timeout": 10
      }]
    }]
  }
}
```

## PreToolUse Satisfies AskUserQuestion (2.1.85+)

PreToolUse hooks matching `AskUserQuestion` can return
`updatedInput` alongside `permissionDecision: "allow"`
to programmatically answer questions for headless
integrations:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": {
      "question": "Use PostgreSQL for the database"
    }
  }
}
```

## StopFailure Hook (2.1.78+)

Fires when a turn ends due to an API error (rate limit,
auth failure, etc.). **Non-blockable** (output/exit code
ignored). Matcher on error type: `rate_limit`,
`authentication_failed`, `billing_error`,
`invalid_request`, `server_error`, `max_output_tokens`,
`unknown`.

## TaskCreated Hook (2.1.84+)

Fires when a task is created via TaskCreate. **Blockable**
(exit code 2 or `continue: false`). No matcher support
(fires on every TaskCreate). Input includes `task_id`,
`task_subject`, `task_description`, `teammate_name`,
`team_name`.

## CwdChanged and FileChanged Hooks (2.1.83+)

**CwdChanged**: Fires on working directory change. Non-
blockable, no matcher. Input includes `cwd`. Has
`CLAUDE_ENV_FILE` access for persisting env vars.

**FileChanged**: Fires on watched file change. Non-
blockable. Matcher on filename (e.g., `.envrc`). Input
includes `file_path`. Has `CLAUDE_ENV_FILE` access.

## WorktreeCreate HTTP Hook Support (2.1.84+)

HTTP hooks (`type: "http"`) for WorktreeCreate can now
return the created worktree path via
`hookSpecificOutput.worktreePath` in the response JSON.
Previously only command hooks could return this via
stdout.

## PreToolUse "allow" Bypass Fix (2.1.77+)

PreToolUse hooks returning `{"decision": "allow"}` could
previously bypass `deny` permission rules, including
enterprise managed settings. A plugin hook could override
organization-wide security policies.

Fixed: hook `"allow"` decisions are now checked **after**
deny rules. The permission precedence order is:

1. Managed deny (highest, unbypassable)
2. Hook deny
3. Permission deny
4. Hook allow
5. Permission allow (lowest)

This is a **security-critical fix**. Enterprise `deny`
rules in managed settings can no longer be circumvented
by third-party plugin hooks.

## MCP Elicitation Hooks (2.1.76+)

Two new hook events for MCP elicitation workflows:

### Elicitation Hook

Fires when an MCP server sends an `elicitation/create`
request. **Blockable**: exit code 2 sends `decline` to
the server. Matcher filters on `mcp_server_name`.

Input includes `mcp_server_name`, `tool_name`, and
`form_schema` (the MCP `requestedSchema`). Supports
`hookSpecificOutput` to auto-approve, auto-decline, or
auto-fill responses without showing the dialog:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "Elicitation",
    "action": "accept",
    "content": { "env": "staging" }
  }
}
```

### ElicitationResult Hook

Fires after the user responds to an elicitation, before
the response reaches the MCP server. **Blockable**: exit
code 2 converts the action to `decline`. Matcher filters
on `mcp_server_name`.

Input includes `action` (`accept`/`decline`/`cancel`)
and `content` (form field values if `accept`). Supports
`hookSpecificOutput` to override the action and/or
content before it reaches the server. Use for validation,
transformation, or audit logging of user responses.

## PostCompact Hook (2.1.76+)

Fires after context compaction completes (manual
`/compact` or automatic). **Non-blockable** (compaction
already completed). Matcher filters on `trigger` value
(`"manual"` or `"auto"`).

Input includes `trigger` and `compact_summary` (the
generated conversation summary). Use for post-compaction
recovery: re-injecting framework instructions that were
paraphrased during compaction. PreCompact content gets
summarized (compliance drops ~95% to ~60-70%);
PostCompact content appears fresh and verbatim.

## SessionEnd Hooks Timeout Fix (2.1.74+)

SessionEnd hooks were previously killed after 1.5
seconds on exit regardless of the `hook.timeout` setting.
Fixed in 2.1.74: the exit timeout is now configurable
via `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` env var.
Set this to give SessionEnd hooks enough time to complete
(e.g., metrics upload, state persistence, notifications).

Example: allow 10 seconds for SessionEnd hooks:
```bash
export CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS=10000
```

The default remains 1500ms (1.5 seconds). Per-hook
`timeout` values are **capped** by this budget: a hook
with `timeout: 30` is still killed at 1.5s unless the
env var is raised. The budget applies to session exit,
`/clear`, and switching sessions via `/resume`.

SessionEnd matchers: `clear`, `resume`, `logout`,
`prompt_input_exit`, `bypass_permissions_disabled`,
`other`.

## New Hook Events (2.1.74+ documentation refresh)

The hooks documentation now includes several additional
event types beyond the 19 previously tracked:

- **CwdChanged**: Fires when the working directory
  changes. Observability-only (no decision control).
- **FileChanged**: Fires when a watched file changes.
  Observability-only.
- **PostCompact**: Fires after context compaction
  completes. Complements PreCompact.
- **TaskCreated**: Fires when a task is created.
  Blockable (can prevent task creation).
- **StopFailure**: Fires on API error (distinct from
  Stop, which fires on normal completion). No decision
  control.
- **Elicitation**: Fires when an MCP server requests
  user input. Blockable.
- **ElicitationResult**: Fires when the user responds
  to an MCP elicitation.

These expand the hook surface for directory tracking,
file watch integration, compaction response, and MCP
elicitation interception.

## SessionStart Resume Double-Fire Fix (2.1.73+)

SessionStart hooks previously fired twice when resuming
a session via `--resume` or `--continue`. Now they fire
exactly once. The `source` field in the hook input
distinguishes session types: `"startup"`, `"resume"`,
`"clear"`, or `"compact"`. Hooks that tracked
initialization state (counters, one-time setup) no
longer need deduplication guards for resumed sessions.

## JSON-Output Hooks Fix (2.1.73+)

JSON-output hooks previously injected no-op
system-reminder messages into the model's context on
every turn, causing token waste. Fixed in 2.1.73: hooks
using JSON output format no longer produce spurious
context injections. This is particularly relevant for
hooks that return `additionalContext` in their JSON
output, as those hooks were most affected by the
duplicate injection.

## Hook Selection Guide

| Use Case | Recommended Hook | Why |
|----------|------------------|-----|
| Log all tool calls | PreToolUse | Captures before execution |
| Track execution time | Pre + PostToolUse | Measure duration |
| Validate inputs | UserPromptSubmit | Before processing |
| Handle tool errors | PostToolUseFailure | Error-specific handling |
| Auto-approve tools | PermissionRequest | Bypass permission dialog |
| Initialize session | SessionStart | One-time setup |
| Cleanup resources | SessionEnd/Stop | Guaranteed cleanup |
| Multi-agent coordination | TeammateIdle/TaskCompleted | Agent team workflows |
| React to config | ConfigChange | Settings-driven behavior |

## See Complete Guide

The comprehensive hook types guide includes:
- Detailed lifecycle diagrams
- Complete code examples for each hook type
- Advanced patterns and combinations
- Performance considerations
- Migration guides

See `Skill(abstract:hook-authoring)` for the full hook development guide and examples.
