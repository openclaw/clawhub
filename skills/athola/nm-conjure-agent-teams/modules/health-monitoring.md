---
name: health-monitoring
description: Agent health tracking, stall detection, and automated recovery via heartbeat monitoring and claim expiry
parent_skill: conjure:agent-teams
category: delegation-framework
estimated_tokens: 250
---

# Health Monitoring

## Member Health Fields

Each team member's config gains a `health` object for tracking operational status:

```json
{
  "agent_id": "backend@my-team",
  "name": "backend",
  "role": "implementer",
  "health": {
    "status": "healthy",
    "last_heartbeat": "2026-02-07T22:15:00Z",
    "last_task_update": "2026-02-07T22:14:30Z",
    "stall_count": 0,
    "replacement_count": 0
  }
}
```

Members without a `health` object operate as before (no health monitoring — backward compatible).

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `healthy`, `stalled`, `unresponsive`, `replaced` |
| `last_heartbeat` | ISO 8601 | Last heartbeat message timestamp |
| `last_task_update` | ISO 8601 | Last task status change by this agent |
| `stall_count` | integer | Number of times this agent has been marked stalled |
| `replacement_count` | integer | Number of times this agent has been replaced |

## Task Claim Fields

Tasks gain claim tracking fields in metadata:

```json
{
  "id": "5",
  "owner": "backend@my-team",
  "metadata": {
    "claimed_at": "2026-02-07T22:10:00Z",
    "claim_expiry_seconds": 300
  }
}
```

| Field | Default | RED | CRITICAL |
|-------|---------|-----|----------|
| `claim_expiry_seconds` | 300 (5 min) | 600 (10 min) | 900 (15 min) |

Higher-risk tasks get longer claim windows because they legitimately take more time and require more careful execution.

## Health Check Protocol

### Lead Polling Loop

The lead agent checks team health every 60 seconds:

```
Every 60s:
  For each member where status != "replaced":
    1. Check last_heartbeat age
    2. If age > claim_expiry_seconds:
       → Enter 2-stage stall detection
    3. If status == "stalled" and stall_duration > 60s:
       → Mark as "unresponsive"
       → Trigger recovery
```

### 2-Stage Stall Detection

Stage 1 prevents false positives from temporary delays:

```
Stage 1: Probe
  Send health_check message to agent's inbox
  Wait 30 seconds

Stage 2: Confirm
  Check if agent responded with heartbeat
  If yes: Reset stall timer, mark "healthy"
  If no:  Mark "stalled", increment stall_count
```

### Recovery Actions

When an agent is confirmed stalled or unresponsive:

```
stalled (stall_count == 1):
  → Release claimed tasks (set owner = null, status = "pending")
  → Send stall_alert broadcast to team
  → Attempt restart: kill tmux pane, respawn with same identity

stalled (stall_count >= 2):
  → Mark as "unresponsive"
  → Release all tasks
  → Follow leyline:damage-control/modules/agent-crash-recovery.md
  → "Replace don't wait" doctrine: spawn fresh agent

replaced:
  → Agent is permanently decommissioned
  → Inbox preserved for audit
  → All tasks reassigned to other agents
```

## Member Health States

State machine for member health:

```
           heartbeat received
healthy ◄──────────────────── stalled
  │                              │
  │ no heartbeat                 │ no response to
  │ (> claim_expiry)             │ health_check (30s)
  │                              │
  v                              v
stalled ──────────────────► unresponsive
                                 │
                                 │ replacement spawned
                                 │
                                 v
                              replaced
```

**Transitions:**
- `healthy → stalled`: No heartbeat within claim_expiry_seconds
- `stalled → healthy`: Agent responds to health_check
- `stalled → unresponsive`: Agent fails to respond within 30s of health_check
- `unresponsive → replaced`: After 2 failed recovery attempts, fresh agent spawned
- `replaced`: Terminal state — agent is decommissioned

## Heartbeat Protocol

Agents send periodic heartbeat messages to maintain healthy status:

```json
{
  "from": "backend",
  "type": "heartbeat",
  "text": "{\"task_id\": \"5\", \"progress_percent\": 60}",
  "timestamp": "2026-02-07T22:15:00Z"
}
```

Heartbeats are sent:
- Every 60 seconds during active work
- After each task status change
- In response to `health_check` messages from the lead

## Teammate Memory Management (2.1.63+)

Long-running teammates previously retained all messages
in AppState even after conversation compaction. This
caused unbounded memory growth in sustained team
sessions. Fixed in 2.1.63: teammate message state is
now properly compacted. Heavy progress message payloads
are stripped during compaction, further reducing memory
pressure in teams with frequent status updates.

## TeammateIdle / TaskCompleted Shutdown (2.1.69+)

`TeammateIdle` and `TaskCompleted` hooks now support
returning `{"continue": false, "stopReason": "..."}` to
stop the teammate, matching `Stop` hook behavior. This
enables graceful teammate shutdown from hook logic
without requiring the lead to send explicit kill
signals.

Use cases for team health:

- Stop a teammate that has been idle too long
  (via `TeammateIdle` hook)
- Stop a teammate after completing its final task
  (via `TaskCompleted` hook)
- Implement budget-based shutdown (stop after N tasks
  or N tokens consumed)

```json
{
  "continue": false,
  "stopReason": "Budget exhausted after 5 tasks"
}
```

## Background Agent Notification Fix (2.1.71+)

Background agent completion notifications previously
omitted the output file path. This made it difficult
for parent agents (including team leads) to recover
agent results after context compaction. Fixed in 2.1.71:
completion notifications now include the output file
path, enabling reliable result retrieval even after
the parent's context has been compacted.

## `--print` Team Agent Fix (2.1.71+)

`--print` mode previously hung indefinitely when team
agents were configured, because the exit loop waited
on long-lived `in_process_teammate` tasks that never
complete. Fixed in 2.1.71: the exit loop no longer
blocks on teammate tasks. This unblocks CI/automation
workflows that use `--print` with team configurations.

## Team Agent Model Inheritance (2.1.72+)

Team agents now inherit the leader's model. Previously,
team agents used their own default model regardless of
the leader's configuration. This ensures consistent
model behavior across the team and eliminates the need
to configure each team agent's model separately.

## Subagent Model Downgrade Fix (2.1.73+)

Subagents with `model: opus`/`sonnet`/`haiku` were
silently downgraded to older model versions on Bedrock,
Vertex, and Microsoft Foundry. For example, `model: opus`
could resolve to Opus 4.1 instead of Opus 4.6 on these
providers. Fixed in 2.1.73: model aliases now resolve to
the current version on all providers, matching first-party
API behavior.

The default Opus model on these providers also changed
from 4.1 to 4.6, so both explicit alias resolution and
default behavior are now correct.

## Agent Resume via SendMessage (2.1.77+)

The Agent tool no longer accepts a `resume` parameter.
Use `SendMessage({to: agentId})` to continue a stopped
agent. SendMessage now auto-resumes stopped agents in the
background instead of returning an error. This simplifies
the recovery workflow: stopped agents no longer require
re-spawning, and the lead agent can resume team members
directly via SendMessage.

## Background Bash 5GB Output Limit (2.1.77+)

Background bash tasks are now killed if output exceeds
5GB, preventing runaway processes from filling disk. This
protects against infinite logging loops, verbose builds,
or accidental `cat /dev/urandom` in background tasks
within agent team workflows.

## Teammate Pane Close Fix (2.1.77+)

Fixed teammate panes not closing when the leader exits.
Previously, tmux panes for team agents could persist
after the leader session terminated, requiring manual
cleanup.

## Background Agent Partial Results Preserved (2.1.76+)

Killing a background agent now preserves whatever partial
results it had generated up to the point of termination.
Results appear in the conversation context, allowing the
main agent or the user to build on partial work instead
of starting over. Combined with 2.1.71 background agent
notification output file paths, partial results are
recoverable after both interruption and compaction.

This improves team resilience: if a team member agent is
killed due to a stall or timeout, its partial work is
not lost. The lead agent can incorporate partial results
when reassigning the task.

## Agent Teams Footer Hint Fix (2.1.75+)

Fixed the footer hint in agent teams showing "down to
expand" instead of the correct "shift + down to expand".
Users were pressing the wrong key combination based on
the incorrect hint. The footer now correctly indicates
`shift + down-arrow` for expanding agent output panels.

## Background Bash Process Cleanup (2.1.73+)

Background bash processes spawned by subagents were not
cleaned up when the agent exited, causing orphaned
processes to accumulate in long sessions. Fixed in
2.1.73: agent exit now properly terminates child bash
processes. This is particularly relevant for agent team
workflows where many subagents spawn bash commands
during parallel execution.

## Integration with Damage Control

When recovery actions fail, escalate through `leyline:damage-control`:

- Agent crash → `leyline:damage-control/modules/agent-crash-recovery.md`
- Context overflow detected → `leyline:damage-control/modules/context-overflow.md`
- Task failures after replacement → `leyline:damage-control/modules/partial-failure-handling.md`
