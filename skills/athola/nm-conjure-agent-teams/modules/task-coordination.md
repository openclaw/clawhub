---
name: task-coordination
description: Task CRUD, state machine, dependency graph, and cycle detection
parent_skill: conjure:agent-teams
category: delegation-framework
estimated_tokens: 200
---

# Task Coordination

## Task File Format

Tasks are numbered JSON files in `~/.claude/tasks/<team>/`:

```json
{
  "id": "1",
  "subject": "Implement user API",
  "description": "Create CRUD endpoints for user management",
  "status": "pending",
  "owner": null,
  "active_form": null,
  "blocks": ["3"],
  "blocked_by": [],
  "metadata": {
    "priority": "high",
    "estimated_hours": 2,
    "risk_tier": "GREEN"
  }
}
```

## Task State Machine

```
pending (0) --> in_progress (1) --> completed (2)
                                     |
                               [deleted] (removes file)
```

**Forward-only transitions**: Backward transitions (e.g., `completed` to `in_progress`) are prohibited. The numeric ordering enforces this: a task can only move to a higher-numbered state.

**Deleted**: Special status that unlinks the task file and removes all dependency references from other tasks.

## Dependency Management

### Fields

- `blocks`: List of task IDs that this task prevents from starting
- `blocked_by`: List of task IDs that must complete before this task can start

### Bidirectional Synchronization

When adding a dependency edge, both sides update automatically:
- Adding task `1` to task `3`'s `blocked_by` also adds `3` to task `1`'s `blocks`
- Removing a dependency cleans both directions

### Blocked Task Validation

A task cannot transition to `in_progress` while its `blocked_by` list contains any non-completed tasks. The update operation checks this constraint before allowing state changes.

## Cycle Detection (BFS)

Before adding a dependency edge, the system runs breadth-first search through the existing dependency graph to prevent circular dependencies:

```python
def _would_create_cycle(tasks: dict, from_id: str, to_id: str) -> bool:
    """BFS from to_id through 'blocks' edges. Cycle if we reach from_id."""
    visited = set()
    queue = [to_id]
    while queue:
        current = queue.pop(0)
        if current == from_id:
            return True  # Cycle detected
        if current in visited:
            continue
        visited.add(current)
        queue.extend(tasks[current].get("blocks", []))
    return False
```

The check examines both on-disk state and pending in-memory changes before allowing new edges.

## CRUD Operations

### Create
```python
task = create_task(team, subject, description, owner=None, blocks=[], metadata={})
# Auto-increments ID, writes <id>.json, returns created task
```

### Read
```python
task = get_task(team, task_id)       # Single task
tasks = list_tasks(team)             # All tasks
```

### Update
Three-phase operation within file lock:
1. **Read**: Load current task state from disk
2. **Validate**: Check state transition rules, dependency constraints
3. **Mutate**: Apply changes, flush related tasks atomically

When `owner` changes, the system auto-sends a task assignment message to the new assignee's inbox.

### Delete
Setting `status: "deleted"` triggers:
1. Remove all `blocks`/`blocked_by` references from other tasks
2. Unlink the task JSON file from disk

## Risk-Aware Task Assignment

When `leyline:risk-classification` is available, the lead validates risk tier before assigning tasks:

1. **Read `risk_tier`** from task metadata (default: `"GREEN"` if absent)
2. **Validate assignment**: Check that the assigned agent's role is compatible with the tier (see `conjure:agent-teams/modules/crew-roles.md`)
3. **Apply parallel constraints**: Respect the risk-tier parallel safety matrix — no RED+RED, never parallel CRITICAL
4. **Set verification gates**: Task completion requires passing the tier-appropriate verification gates from `leyline:risk-classification/modules/verification-gates.md`

## Concurrency Safety

All task operations use `fcntl` exclusive locks on `~/.claude/tasks/<team>/.lock` to prevent concurrent modification. The lock is held for the entire read-validate-mutate cycle.
