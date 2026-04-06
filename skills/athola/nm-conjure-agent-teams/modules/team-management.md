---
name: team-management
description: Team lifecycle, config format, member management, and atomic persistence patterns
parent_skill: conjure:agent-teams
category: delegation-framework
estimated_tokens: 200
---

# Team Management

## Directory Structure

```
~/.claude/teams/<team-name>/
  config.json        # Team metadata + member roster
  inboxes/           # Per-agent message queues
    .lock            # Shared lock file
~/.claude/tasks/<team-name>/
  .lock              # Task directory lock
```

## Team Config Schema

```json
{
  "name": "my-team",
  "description": "Backend refactoring team",
  "created_at": 1738972800000,
  "lead_agent_id": "team-lead@my-team",
  "lead_session_id": "sess_abc123",
  "members": [
    {
      "agent_id": "team-lead@my-team",
      "name": "team-lead",
      "agent_type": "lead",
      "model": "sonnet",
      "joined_at": 1738972800000,
      "tmux_pane_id": "%0",
      "cwd": "/home/user/project"
    },
    {
      "agent_id": "backend@my-team",
      "name": "backend",
      "agent_type": "general-purpose",
      "role": "implementer",
      "model": "sonnet",
      "joined_at": 1738972801000,
      "tmux_pane_id": "%1",
      "cwd": "/home/user/project",
      "health": {
        "status": "healthy",
        "last_heartbeat": "2026-02-07T22:00:01Z",
        "last_task_update": null,
        "stall_count": 0,
        "replacement_count": 0
      }
    }
  ]
}
```

## Team Name Validation

Names must match `^[A-Za-z0-9_-]+$` and be under 64 characters. This ensures filesystem-safe directory names across platforms.

Invalid: `my team`, `team/name`, `team.v2`
Valid: `my-team`, `backend_v2`, `refactor-2026`

## Member Management

**Adding**: Validate name uniqueness within the team, append to `members[]`, persist config.

**Removing**: Filter out target member by name. The `team-lead` member cannot be removed. Write updated config atomically.

## Atomic Write Pattern

Config persistence uses a two-phase atomic write to prevent partial reads from concurrent agents:

1. Create temporary file via `mkstemp()` in the same directory
2. Write full JSON content to temp file
3. `os.replace(temp_path, config_path)` — atomic on POSIX systems

This guarantees that any agent reading `config.json` sees either the old or new version, never a partial write.

## Team Lifecycle

1. **Create**: Initialize directories, write initial config with lead member
2. **Grow**: Spawn teammates, register in config via atomic write
3. **Operate**: Agents coordinate through tasks and messages
4. **Shrink**: Remove completed teammates, clean up their inboxes
5. **Delete**: Requires all non-lead members removed first; purges both `teams/` and `tasks/` directories

## Member Health States

Members with a `health` object follow a state machine for health tracking:

```
healthy → stalled → unresponsive → replaced
  ▲          │
  └──────────┘ (recovery succeeds)
```

- **healthy**: Agent is responsive, heartbeat within claim expiry
- **stalled**: No heartbeat received within claim_expiry_seconds, health_check sent
- **unresponsive**: Failed to respond to health_check within 30s
- **replaced**: Agent decommissioned, fresh agent spawned with new identity

Members without a `health` object work as before (no health monitoring). See `modules/health-monitoring.md` for full protocol. The `role` field (default: `"implementer"`) determines the agent's capability set — see `modules/crew-roles.md`.

## Single Team Per Session

Each MCP server session manages exactly one team. This simplifies state management and prevents cross-team interference.
