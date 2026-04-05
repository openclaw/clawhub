---
name: spawning-patterns
description: tmux-based agent spawning, CLI identity flags, and pane management
parent_skill: conjure:agent-teams
category: delegation-framework
estimated_tokens: 200
---

# Spawning Patterns

## Overview

Each teammate runs as an independent `claude` CLI process in a tmux split pane. The team lead spawns teammates via `tmux split-window`, passing identity flags so each agent knows its role within the team.

## Required Environment Variables

```bash
export CLAUDECODE=1
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

These are set automatically by the spawner before launching each teammate.

### Nested Session Guard (Claude Code 2.1.39+)

Claude Code 2.1.39 added a guard that prevents launching `claude` inside another `claude` session. Agent teams are **unaffected** because:
- tmux `split-window` creates an independent shell environment
- The `CLAUDECODE=1` env var is set explicitly per pane, not inherited from a parent session
- The guard targets accidental recursive invocations, not intentional team spawning

If you encounter the guard unexpectedly, ensure you're using tmux or iTerm2 pane splitting (not subshell invocations like `claude -p "..." | ...` within an existing session).

## CLI Identity Flags

```bash
claude \
  --agent-id "backend@my-team" \
  --agent-name "backend" \
  --team-name "my-team" \
  --agent-color "#FF6B6B" \
  --agent-role "implementer" \
  --parent-session-id "$LEAD_SESSION_ID" \
  --agent-type "general-purpose" \
  --model sonnet
```

| Flag | Format | Description |
|------|--------|-------------|
| `--agent-id` | `<name>@<team>` | Unique agent identifier |
| `--agent-name` | string | Human-readable name |
| `--team-name` | string | Team this agent belongs to |
| `--agent-color` | hex color | Visual distinction in tmux |
| `--parent-session-id` | string | Links to lead agent's session |
| `--agent-type` | string | Role type (e.g., `general-purpose`) |
| `--agent-role` | string | Crew role: `implementer`, `researcher`, `tester`, `reviewer`, `architect` (default: `implementer`) |
| `--model` | string | Model selection: `sonnet`, `opus`, `haiku` (2.1.39+ correctly qualifies for Bedrock/Vertex/Foundry). **Always pass an explicit model name, never `inherit`** (see warning below) |
| `--plan-mode-required` | flag | Optional: enforce planning mode |

### Team Agent Model Bug (2.1.69+)

When spawning team agents via the `Agent` tool (not
tmux CLI), `inherit` is written as a literal string
into the team config instead of being resolved to the
lead's model. The spawned agent then fails with:

> There's an issue with the selected model (inherit).

**Workaround**: Always pass an explicit model name
(`sonnet`, `opus`, `haiku`) via `--model` when spawning
team agents. Never use `inherit` or omit the flag in
team contexts. This does not affect subagents (non-team
Agent tool calls), which resolve `inherit` correctly.

Tracked upstream: anthropics/claude-code#31069

### Subagent Model Downgrade Fix (2.1.73+)

Subagent `model: opus`/`sonnet`/`haiku` aliases were
silently downgraded to older versions on Bedrock,
Vertex, and Microsoft Foundry (e.g., Opus 4.1 instead
of 4.6). Fixed in 2.1.73: aliases now resolve to the
current version on all providers.

The default Opus model on Bedrock/Vertex/Foundry also
changed from 4.1 to 4.6 in this release.

### `--bare` Flag for Scripted Agents (2.1.81+)

Skips hooks, LSP, plugin sync, skill walks, auto-memory,
OAuth/keychain, CLAUDE.md, `.mcp.json`. Fastest startup
for CI/scripted use. Requires `ANTHROPIC_API_KEY` or
`apiKeyHelper` via `--settings`. Will become default for
`-p` in a future release.

### Agent `initialPrompt` Frontmatter (2.1.83+)

Agents can declare `initialPrompt` to auto-submit a
first turn on spawn without the parent providing an
initial message.

### Agent `effort`/`maxTurns`/`disallowedTools` (2.1.78+)

Plugin-shipped agents support effort level override,
turn limits, and tool restrictions in frontmatter.
Security: `hooks`, `mcpServers`, `permissionMode` NOT
supported for plugin agents.

### Worktree in Non-Git Repos Fix (2.1.85+)

Fixed `--worktree` exiting with error in non-git
repositories before the WorktreeCreate hook could run.

### Agent Tool `resume` Parameter Removed (2.1.77+)

The Agent tool no longer accepts a `resume` parameter.
Use `SendMessage({to: agentId})` to continue a previously
spawned agent. New Agent calls always start fresh and
need full task context. SendMessage now auto-resumes
stopped agents in the background (no error returned).

Update any spawning code that used `Agent(resume: true)`
or `Agent(resume: agentId)` to use SendMessage instead.

### Stale Worktree Cleanup Race Fix (2.1.77+)

Fixed a race condition where the 2.1.76 stale-worktree
cleanup could delete an agent worktree that was being
actively resumed from a previous crash. The cleanup now
checks whether the worktree is being recovered before
deleting it.

### `-n` / `--name` CLI Flag (2.1.76+)

Sets a display name for the session at startup:
`claude -n "refactor-auth"`. Name appears on the prompt
bar, session listings, Remote Control titles, and
transcript metadata. Combined with `/color` (2.1.75+),
provides complete session identification at launch
without needing `/rename` mid-session.

### `worktree.sparsePaths` Setting (2.1.76+)

For `claude --worktree` in large monorepos. Uses git
sparse-checkout (cone mode) to materialize only the
listed directories:

```json
{
  "worktree": {
    "sparsePaths": ["packages/my-app", "shared/utils"]
  }
}
```

Files outside `sparsePaths` are not checked out. Can
combine with `worktree.symlinkDirectories`. Reduces
checkout time and disk usage for parallel agent dispatch
in monorepos.

### Worktree Startup Performance (2.1.76+)

Two improvements for `claude --worktree`:

1. Reads `.git/refs/` and `.git/packed-refs` directly
   instead of shelling out to `git branch -r`
2. Skips redundant `git fetch` when the remote branch
   is already available locally

Reduces worktree creation latency, particularly on slow
networks where the 120s git timeout was a bottleneck.

### Stale Worktree Cleanup (2.1.76+)

Worktrees left behind after interrupted parallel runs
are now automatically cleaned up. Detects orphaned
worktrees whose associated session or agent is no longer
running. Prevents disk space accumulation from aborted
parallel agent runs.

### `--plugin-dir` Single Path (2.1.76+)

`--plugin-dir` now accepts only one path per flag. Use
repeated flags for multiple directories:
`claude --plugin-dir /a --plugin-dir /b`. Previously
accepted colon-separated paths.

### `/color` Command for Session Identification (2.1.75+)

The `/color` command sets a custom border color on the
prompt bar for the current session (e.g., `/color orange`,
`/color blue`). Does not persist across session resume.
Useful for visually distinguishing team agents in
different tmux panes or iTerm2 splits.

Can be invoked at session launch: `claude "/color yellow"`.
Slash command chaining is not supported, so combining
`/color` and `/rename` at startup requires a shell alias.

### Session Name on Prompt Bar (2.1.75+)

`/rename` now displays the session name on the prompt
bar and propagates it to the terminal title via OSC 0/2
escape sequences. Terminal emulators that support these
sequences show the name in tab/window titles. Combined
with `/color`, this gives each team agent a distinct
visual identity.

Related fix: `/resume` no longer loses session names
after resuming a forked or continued session.

### Full Model IDs in Agent Frontmatter (2.1.74+)

Agent `model:` fields now accept full model IDs (e.g.,
`claude-opus-4-6`, `claude-opus-4-5-20251101`) in
addition to aliases (`opus`, `sonnet`, `haiku`).
Previously, full IDs were silently ignored, falling
back to the default model. Agents now accept the same
values as `--model`: aliases, full IDs, and
provider-specific strings (Bedrock ARNs, Vertex names,
Foundry deployments).

## Agent ID Format

The agent-id follows the pattern `<name>@<team-name>`, creating a unique namespace:
- `backend@refactor-team`
- `frontend@refactor-team`
- `reviewer@code-review`

## tmux Pane Management

### Spawning

```bash
# Split current window horizontally, run claude in new pane
tmux split-window -h "CLAUDECODE=1 CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 \
  claude --agent-id backend@my-team --agent-name backend ..."
```

The spawner captures the new pane ID from tmux and stores it in the team config's member entry (`tmux_pane_id` field).

### Color Assignment

Colors are assigned from a palette based on member index:
```
["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F"]
```

### Killing a Pane

```bash
tmux kill-pane -t <pane_id>
```

Used during force-kill and graceful shutdown after approval.

## iTerm2 Alternative

Agent Teams also supports iTerm2 with the `it2` CLI as an alternative to tmux. The coordination protocol (files, messages, tasks) is identical — only the terminal multiplexer differs.

## Agent Name Validation

- Must match `^[A-Za-z0-9_-]+$`
- Under 64 characters
- Cannot be `team-lead` (reserved for the lead agent)
- Must be unique within the team

## Spawning Sequence

1. Validate agent name (uniqueness, format)
2. Assign color from palette
3. Create `TeammateMember` with metadata (model, type, cwd)
4. Register member in team config (atomic write)
5. Create empty inbox file for the agent
6. Send initial prompt to agent's inbox via messaging protocol
7. Execute `tmux split-window` with full CLI flags
8. Capture and store `tmux_pane_id` in member config

## Graceful Shutdown Protocol

1. Lead sends `shutdown_request` message with unique
   request ID
2. Teammate receives request, finishes current work
3. Teammate sends `shutdown_response` approving the
   shutdown
4. Lead calls `process_shutdown_approved` to clean up
   pane and config

### Bulk Agent Kill (2.1.53+)

Pressing `ctrl+f` kills all background agents with a
single aggregate notification instead of one per agent.
The command queue is properly cleared on bulk kill.
This prevents notification storms when terminating N
agents simultaneously and ensures no orphaned commands
remain in the queue after termination.
