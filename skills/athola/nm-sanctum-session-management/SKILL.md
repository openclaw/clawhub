---
name: session-management
description: Manage Claude Code sessions with naming, checkpointing, and resume strategies
version: 1.8.1
triggers:
  - session
  - resume
  - checkpoint
  - debugging
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/sanctum", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: sanctum
---

> **Night Market Skill** — ported from [claude-night-market/sanctum](https://github.com/athola/claude-night-market/tree/master/plugins/sanctum). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Session Management


## When To Use

- Managing session checkpoints and state preservation
- Resuming work across Claude Code sessions

## When NOT To Use

- Short sessions that do not need checkpoints
- Fresh starts where no prior session context exists

## Overview

Claude Code supports named sessions for better workflow organization. Use this skill to manage complex, long-running work across multiple sessions.

## Available Commands

| Command | Description |
|---------|-------------|
| `/rename` | Name the current session (auto-generates name if no argument given, 2.1.41+) |
| `/resume` | Resume a previous session (REPL) |
| `claude --resume <name>` | Resume from terminal |

## Workflow Patterns

### 1. Debugging Sessions

Name debug sessions for easy resumption:

```
# Start debugging
/rename debugging-auth-issue

# ... work on the issue ...

# If you need to pause, session is auto-saved
# Resume later:
claude --resume debugging-auth-issue
```

### 2. Feature Development Checkpoints

Create checkpoints during long feature work:

```
# After completing milestone 1
/rename feature-x-milestone-1

# Continue in new session
# Reference old session if needed
```

### 3. PR Review Sessions

For complex PR reviews that span multiple sittings:

```
# Start review
/rename pr-review-123

# Take breaks without losing context
# Resume:
claude --resume pr-review-123
```

### 4. PR-Linked Sessions (Claude Code 2.1.27+)

Sessions are automatically linked to PRs when created via `gh pr create`. Resume PR-specific sessions later:

```
# Resume session for a specific PR
claude --from-pr 156
claude --from-pr https://github.com/org/repo/pull/156

# Workflow: review → pause → resume with full context
/rename pr-review-156
# ... review work ...
# Later:
claude --from-pr 156
```

### 5. Investigation Sessions

When investigating issues that may require research:

```
# Start investigation
/rename investigate-memory-leak

# Pause to gather more info externally
# Resume with full context:
claude --resume investigate-memory-leak
```

## Resume Screen Features

The `/resume` screen provides:

- **Grouped forked sessions**: See related sessions together
- **Keyboard shortcuts** (defaults, customizable via `/keybindings`):
  - Preview session content
  - Rename a session
- **Recent sessions**: Sorted by last activity

### 6. Resume Hint on Exit (Claude Code 2.1.31+)

Claude Code now shows a resume hint when you exit, displaying the command to continue your conversation. This makes session resumption more discoverable — users no longer need to know about `--resume` beforehand.

## Best Practices

### Naming Conventions

Use descriptive, hyphenated names:

| Pattern | Example | Use Case |
|---------|---------|----------|
| `debugging-<issue>` | `debugging-auth-401` | Bug investigation |
| `feature-<name>-<milestone>` | `feature-search-v2` | Feature development |
| `pr-review-<number>` | `pr-review-156` | PR reviews |
| `investigate-<topic>` | `investigate-perf` | Research |
| `refactor-<area>` | `refactor-api-layer` | Refactoring work |

### When to Name Sessions

Name sessions when:
- Work will span multiple days
- You might need to pause unexpectedly
- The session contains valuable context
- You want to reference it later

### Session Cleanup

Unnamed sessions are eventually garbage collected. Named sessions persist longer. Periodically clean up old named sessions you no longer need.

## Integration with Sanctum

Combine session management with other Sanctum skills:

1. **Before starting**: Run `Skill(sanctum:git-workspace-review)` to capture context
2. **Name the session**: `/rename <descriptive-name>`
3. **Work**: Use appropriate skills for the task
4. **Resume if needed**: `claude --resume <name>`

## Troubleshooting

### Session Not Found

If a named session isn't appearing in `/resume`:
- Check for typos in the name
- Sessions may expire after extended inactivity
- Use `/resume` screen to browse available sessions

### Duplicate Sessions in VS Code

If you see duplicate session entries when resuming in VS Code:
- **Claude Code 2.1.38+**: Fixed — resume now correctly reuses the existing session without creating duplicates
- **Older versions**: Ignore the duplicate entries; they point to the same underlying session

### Lost Context After Resume

If context seems incomplete or resume is slow:
- **Claude Code 2.1.30+**: 68% memory reduction for `--resume` via stat-based session loading with progressive enrichment — especially impactful for users with many sessions. Also fixes hangs when resuming sessions with corrupted transcript files (parentUuid cycles).
- **Claude Code 2.1.29+**: Fixed slow startup when resuming sessions with many `once: true` hooks — `saved_hook_context` loading is now optimized
- **Claude Code 2.1.21+**: Fixed API errors when resuming sessions interrupted during tool execution — previously these sessions could fail to resume entirely
- **Claude Code 2.1.20+**: Session compaction/resume is now fixed — resume correctly loads the compact summary instead of full history
- Use `/catchup` to refresh git state
- Use `/debug` (Claude Code 2.1.30+) for session troubleshooting diagnostics
- Re-run `Skill(sanctum:git-workspace-review)` if needed
- If on older versions: resumed sessions may reload uncompacted history, increasing context usage unexpectedly

### macOS Orphaned Processes (Claude Code 2.1.46+)

Previously, disconnecting from a terminal on macOS could leave orphaned Claude Code processes running. This is now fixed in 2.1.46+. If you encounter stale CC processes on older versions, manually check and kill them:

```bash
# Find orphaned claude processes
ps aux | grep -i claude | grep -v grep
```

### 7. Automatic Memory (Claude Code 2.1.32+)

Claude now automatically records and recalls memories as it works. Session summaries, key results, and work logs are captured implicitly and recalled in future sessions. This provides passive cross-session continuity without manual checkpoint management.

- **No action required**: Memory recording is automatic on first-party Anthropic API
- **Complements named sessions**: Automatic memory handles implicit continuity; named sessions provide explicit organization
- **Token overhead**: Recalled memories add to baseline context — factor this into MECW budgets

### 8. Agent Persistence on Resume (Claude Code 2.1.32+)

`--resume` now re-uses the `--agent` value from the previous conversation by default. Agent-specific workflows that are resumed will continue with the same agent configuration without needing to re-specify it.

```
# Start with a specific agent
claude --agent my-agent

# Resume later — my-agent is automatically used
claude --resume
```

## See Also

- `/catchup` - Refresh context from git changes
- `/clear` - Start fresh session
- `Skill(sanctum:git-workspace-review)` - Capture repo context
