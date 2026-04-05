---
name: agent-teams
description: Coordinate Claude Code Agent Teams through filesystem-based protocol. Use
version: 1.8.1
triggers:
  - agent-teams
  - multi-agent
  - coordination
  - tmux
  - task-management
  - messaging
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/conjure", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.delegation-core", "night-market.leyline:damage-control", "night-market.leyline:risk-classification"]}}}
source: claude-night-market
source_plugin: conjure
---

> **Night Market Skill** — ported from [claude-night-market/conjure](https://github.com/athola/claude-night-market/tree/master/plugins/conjure). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Prerequisites](#prerequisites)
- [Protocol Architecture](#protocol-architecture)
- [Quick Start](#quick-start)
- [Coordination Workflow](#coordination-workflow)
- [Module Reference](#module-reference)
- [Integration with Conjure](#integration-with-conjure)
- [Troubleshooting](#troubleshooting)
- [Exit Criteria](#exit-criteria)


# Agent Teams Coordination

## Overview

Claude Code Agent Teams enables multiple Claude CLI processes to collaborate on shared work through a filesystem-based coordination protocol. Each teammate runs as an independent `claude` process in a tmux pane, communicating via JSON files guarded by `fcntl` locks. No database, no daemon, no network layer.

This skill provides the patterns for orchestrating agent teams effectively.

## When To Use

- Parallel implementation across multiple files or modules
- Multi-agent code review (one agent reviews, another implements fixes)
- Large refactoring requiring coordinated changes across subsystems
- Tasks with natural parallelism that benefit from concurrent agents

## When NOT To Use

- Single-file changes or small tasks (overhead exceeds benefit)
- Tasks requiring tight sequential reasoning (agents coordinate loosely)
- When `claude` CLI is not available or tmux is not installed

## Prerequisites

```bash
# Verify Claude Code CLI
claude --version

# Verify tmux (required for split-pane mode)
tmux -V

# Enable experimental feature (set by spawner automatically)
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

## Protocol Architecture

```
~/.claude/
  teams/<team-name>/
    config.json            # Team metadata + member roster
    inboxes/
      <agent-name>.json    # Per-agent message queue
      .lock                # fcntl exclusive lock
  tasks/<team-name>/
    1.json ... N.json      # Auto-incrementing task files
    .lock                  # fcntl exclusive lock
```

**Design principles:**
- **Filesystem is the database**: JSON files, atomic writes via `tempfile` + `os.replace`
- **fcntl locking**: Prevents concurrent read/write corruption on inboxes and tasks
- **Numbered tasks**: Auto-incrementing IDs with sequential file naming
- **Loose coupling**: Agents poll their own inbox; no push notifications

## Quick Start

### 1. Create a Team

```bash
# Programmatic team setup (via MCP or direct API)
# Team config written to ~/.claude/teams/<team-name>/config.json
```

The team config contains:
- `name`, `description`, `created_at` (ms timestamp)
- `lead_agent_id`, `lead_session_id`
- `members[]` — array of LeadMember and TeammateMember objects

### 2. Spawn Teammates

Each teammate is a separate `claude` CLI process launched with identity flags:

```bash
claude --agent-id "backend@my-team" \
       --agent-name "backend" \
       --team-name "my-team" \
       --agent-color "#FF6B6B" \
       --parent-session-id "$SESSION_ID" \
       --agent-type "general-purpose" \
       --model sonnet
```

See `modules/spawning-patterns.md` for tmux pane management and color assignment.

### 3. Create Tasks with Dependencies

```json
{
  "id": "1",
  "subject": "Implement API endpoints",
  "description": "Create REST endpoints for user management",
  "status": "pending",
  "owner": null,
  "blocks": ["3"],
  "blocked_by": [],
  "metadata": {}
}
```

See `modules/task-coordination.md` for state machine and dependency management.

### 4. Coordinate via Messages

```json
{
  "from": "team-lead",
  "text": "API endpoints are ready for integration testing",
  "timestamp": "2026-02-07T22:00:00Z",
  "read": false,
  "summary": "API ready"
}
```

See `modules/messaging-protocol.md` for message types and inbox operations.

## Coordination Workflow

1. **`agent-teams:team-created`** — Initialize team config and directories
2. **`agent-teams:teammates-spawned`** — Launch agents in tmux panes
3. **`agent-teams:tasks-assigned`** — Create tasks with dependencies, assign owners
4. **`agent-teams:coordination-active`** — Agents claim tasks, exchange messages, mark completion
5. **`agent-teams:team-shutdown`** — Graceful shutdown with approval protocol

## Crew Roles

Each team member has a `role` that determines their capabilities and task compatibility. Five roles are defined: `implementer` (default), `researcher`, `tester`, `reviewer`, and `architect`. Roles constrain which risk tiers an agent can handle — see `modules/crew-roles.md` for the full capability matrix and role-risk compatibility table.

## Team Formation

For mission-level team sizing, use the Team Formation rules
from `references/team-formation.md`. This defines:

- **Role definitions**: Coordinator (mission lead), Agents (task owners),
  Reviewer (adversarial challenger)
- **Team sizing rules**: Simple (1), Moderate (2-4), Complex (5-7),
  Critical (5-10)
- **Maximum team size**: 10 agents (coordination overhead limit)
- **File ownership rules**: Prevent conflicts with clear ownership

See `references/team-formation.md` for full team sizing
guidance and example team formations.

## Health Monitoring

Team members can be monitored for health via heartbeat messages and claim expiry. The lead polls team health every 60s with a 2-stage stall detection protocol (health_check probe + 30s wait). Stalled agents have their tasks released and are restarted or replaced following the "replace don't wait" doctrine. See `modules/health-monitoring.md` for the full protocol and state machine.

## Module Reference

- **team-management.md**: Team lifecycle, config format, member management
- **messaging-protocol.md**: Message types, inbox operations, locking patterns
- **task-coordination.md**: Task CRUD, state machine, dependency cycle detection
- **spawning-patterns.md**: tmux spawning, CLI flags, pane management
- **crew-roles.md**: Role taxonomy, capability matrix, role-risk compatibility
- **health-monitoring.md**: Heartbeat protocol, stall detection, automated recovery

## Integration with Conjure

Agent Teams extends the conjure delegation model:

| Conjure Pattern | Agent Teams Equivalent |
|-----------------|----------------------|
| `delegation-core:task-assessed` | `agent-teams:team-created` |
| `delegation-core:handoff-planned` | `agent-teams:tasks-assigned` |
| `delegation-core:results-integrated` | `agent-teams:team-shutdown` |
| External LLM execution | Teammate agent execution |

Use `Skill(conjure:delegation-core)` first to determine if the task benefits from multi-agent coordination vs. single-service delegation.

## Worktree Isolation Alternative (Claude Code 2.1.49+)

For parallel agents that modify files, `isolation: worktree` provides a lightweight alternative to filesystem-based coordination. Each agent runs in its own temporary git worktree, eliminating the need for `fcntl` locking or inbox-based conflict avoidance on shared files.

- **When to prefer worktrees over agent teams messaging**: Agents work on overlapping files but don't need mid-execution communication
- **When to prefer agent teams messaging**: Agents need to coordinate discoveries or adjust plans based on each other's progress
- **Combine both**: Use agent teams for coordination with `isolation: worktree` per teammate for filesystem safety

## Troubleshooting

### Common Issues

**tmux not found**
Install via package manager: `brew install tmux` / `apt install tmux`

**Stale lock files**
If an agent crashes mid-operation, lock files may persist. Remove `.lock` files manually from `~/.claude/teams/<team>/inboxes/` or `~/.claude/tasks/<team>/`

**Orphaned tasks**
Tasks claimed by a crashed agent stay `in_progress` indefinitely. Use `modules/health-monitoring.md` for heartbeat-based stall detection and automatic task release. The health monitoring protocol detects unresponsive agents within 60s + 30s probe window and releases their tasks for reassignment.

**Message ordering**
Filesystem timestamp resolution varies (HFS+ = 1s granularity). Use numbered filenames or UUID-sorted names to avoid collision on rapid message bursts.

**Model errors on Bedrock/Vertex/Foundry (pre-2.1.39)**
Teammate agents could use incorrect model identifiers on enterprise providers, causing 400 errors. Upgrade to Claude Code 2.1.39+ for correct model ID qualification across all providers.

**Nested session guard (2.1.39+)**
If `claude` refuses to launch within an existing session, ensure you're using tmux pane splitting (not subshell invocation). The guard is intentional — see `modules/spawning-patterns.md` for details.

## Exit Criteria

- [ ] Team created with config and directories
- [ ] Teammates spawned and registered in config
- [ ] Tasks created with dependency graph (no cycles)
- [ ] Agents coordinating via inbox messages
- [ ] Graceful shutdown completed
