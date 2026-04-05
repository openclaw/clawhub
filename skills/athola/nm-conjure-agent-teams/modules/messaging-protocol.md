---
name: messaging-protocol
description: Message types, inbox operations, and fcntl-based concurrency control
parent_skill: conjure:agent-teams
category: delegation-framework
estimated_tokens: 200
---

# Messaging Protocol

## Inbox Structure

Each agent has a dedicated inbox file:

```
~/.claude/teams/<team>/inboxes/<agent-name>.json
```

Content is a JSON array of message objects. An empty inbox is `[]`.

## Message Format (InboxMessage)

```json
{
  "from": "team-lead",
  "text": "Implement the auth middleware next",
  "timestamp": "2026-02-07T22:00:00Z",
  "read": false,
  "summary": "Auth middleware task",
  "color": "#FF6B6B"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | yes | Sender agent name |
| `type` | string | no | Message type: `"heartbeat"`, `"health_check"`, `"stall_alert"`, `"plan_approval"`, `"shutdown"`. Omit for plain direct messages. |
| `text` | string | yes | Message body (plain text or serialized JSON) |
| `timestamp` | string | yes | ISO 8601 timestamp |
| `read` | boolean | yes | Read-state flag (default: `false`) |
| `summary` | string | no | Short summary for quick scanning |
| `color` | string | no | Display color for UI |

## Message Types

### Direct Messages
Plain text or structured payloads sent to a specific agent's inbox.

```python
send_plain_message(team, to_agent, text, summary=None)
```

### Broadcast Messages
Sent to all team members' inboxes simultaneously.

```python
send_broadcast(team, from_agent, text, summary=None)
```

### Task Assignments
Structured notification when a task's `owner` field changes.

```python
send_task_assignment(team, to_agent, task)
```

### Shutdown Requests
Structured request with a unique ID for graceful agent termination.

```python
send_shutdown_request(team, to_agent, request_id)
```

### Heartbeat
Periodic health signal from agent to lead. Includes current task and progress.

```json
{
  "from": "backend",
  "type": "heartbeat",
  "text": "{\"task_id\": \"5\", \"progress_percent\": 60}",
  "timestamp": "2026-02-07T22:15:00Z",
  "summary": "heartbeat: T5 60%"
}
```

### Health Check
Request from lead to verify agent is responsive. Agent must respond with a heartbeat within 30s.

```json
{
  "from": "team-lead",
  "type": "health_check",
  "text": "{\"request_id\": \"hc-001\"}",
  "timestamp": "2026-02-07T22:16:00Z",
  "summary": "health check request"
}
```

### Stall Alert
Broadcast from lead when an agent is detected as stalled. Includes stalled agent identity and released tasks.

```json
{
  "from": "team-lead",
  "type": "stall_alert",
  "text": "{\"stalled_agent\": \"backend\", \"released_tasks\": [\"5\", \"6\"]}",
  "timestamp": "2026-02-07T22:17:00Z",
  "summary": "backend stalled, tasks 5,6 released"
}
```

### Plan Approvals
Response messages confirming or rejecting proposed plans.

```json
{
  "from": "team-lead",
  "type": "plan_approval",
  "text": "{\"task_id\": \"3\", \"approved\": true, \"notes\": \"Proceed with approach A\"}",
  "timestamp": "2026-02-07T22:20:00Z",
  "summary": "plan approved: T3"
}
```

```python
send_plan_approval(team, to_agent, task_id, approved, notes=None)
```

## fcntl File Locking

All inbox operations use exclusive file locks to prevent concurrent corruption:

```python
import fcntl

lock_path = inbox_dir / ".lock"
lock_path.touch()

with open(lock_path) as lock_fd:
    fcntl.flock(lock_fd, fcntl.LOCK_EX)   # Acquire exclusive lock
    try:
        # Read, modify, write inbox JSON
        messages = json.loads(inbox_path.read_text())
        messages.append(new_message)
        inbox_path.write_text(json.dumps(messages))
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)  # Release lock
```

**Crash recovery**: If an agent dies while holding a lock, the OS releases the `fcntl` lock automatically. However, the inbox file may be in an inconsistent state if the write was interrupted. Wrap writes in the atomic pattern from `team-management.md`.

## Read Operations

`read_inbox(agent)` supports:
- `unread_only=True`: Filter to messages where `read == false`
- `mark_as_read=True`: Set `read = true` on returned messages within the lock

## Polling Pattern

Agents poll their inbox on a timer (no push mechanism). The MCP server implements `poll_inbox()` with a 30-second maximum wait, returning early when new messages arrive.
