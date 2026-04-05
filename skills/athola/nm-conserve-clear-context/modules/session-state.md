---
name: session-state
description: |
  Session state persistence format and management for context handoffs.
  Defines the checkpoint structure that enables seamless continuation.
category: conservation
---

# Session State Module

## Overview

This module defines the session state format used for context handoffs. A well-structured state file enables continuation agents to seamlessly pick up where the previous agent left off.

## State File Location

**Default**: `.claude/session-state.md`

**Override**: Set `CONSERVE_SESSION_STATE_PATH` environment variable

```bash
export CONSERVE_SESSION_STATE_PATH="/tmp/my-session-state.md"
```

## State File Format

### Full Template

```markdown
# Session State Checkpoint
state_version: 1

**Generated**: YYYY-MM-DD HH:MM:SS
**Reason**: [Context threshold | Manual checkpoint | Task boundary]
**Context Level**: [Estimated percentage if known]

---

## Current Objective

[One clear sentence describing what we're trying to accomplish]

### Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

---

## Progress Summary

### Completed
- [x] Step 1: [Brief description]
- [x] Step 2: [Brief description]

### In Progress
- [ ] Step 3: [What's currently being worked on]

### Remaining
- [ ] Step 4: [Next step]
- [ ] Step 5: [Future step]

---

## Key Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Decision 1 | Why we chose this | Option A, Option B |
| Decision 2 | Why we chose this | Option C, Option D |

---

## Active Context

### Files Being Modified
| File | Status | Notes |
|------|--------|-------|
| path/to/file1.py | In progress | Adding function X |
| path/to/file2.md | Pending review | Needs formatting |

### Files Read (Reference)
- `path/to/reference1.py` - Used for pattern reference
- `path/to/reference2.md` - Contains requirements

### Open TodoWrite Items
```json
[
  {"id": "todo-1", "status": "pending", "description": "Item 1"},
  {"id": "todo-2", "status": "in_progress", "description": "Item 2"}
]
```

### Existing Task IDs

**IMPORTANT**: List all task IDs from TaskList so the continuation agent
references them via TaskUpdate instead of creating duplicates.

| Task ID | Subject | Status |
|---------|---------|--------|
| #1 | Task subject | in_progress |
| #2 | Task subject | pending |

> The continuation agent MUST use TaskUpdate on these IDs.
> It MUST NOT create new tasks via TaskCreate unless genuinely new work is discovered.

---

## Continuation Instructions

### Immediate Next Step
[Specific action to take first]

### Context to Re-read
1. [File path 1] - [Why it's needed]
2. [File path 2] - [Why it's needed]

### Warnings/Gotchas
- [Any pitfalls the continuation agent should avoid]
- [Known issues encountered]

### If Blocked
[What to do if the immediate next step fails]

---

## Execution Mode

**CRITICAL**: Capture and propagate execution mode for unattended workflows.

```markdown
## Execution Mode

**Mode**: [unattended | interactive | dangerous]
**Auto-Continue**: [true | false]
**Source Command**: [do-issue | execute-plan | batch-process | etc.]
**Remaining Tasks**: [list of pending task IDs or issue numbers]

### Flags Inherited
- `--dangerous`: Continue executing without user prompts
- `--no-confirm`: Skip confirmation dialogs
- `--batch`: Processing multiple items
```

| Mode | Behavior | Use Case |
|------|----------|----------|
| `interactive` | Pause at checkpoints, ask user | Normal development |
| `unattended` | Continue automatically, log decisions | CI/CD, batch processing |
| `dangerous` | Like unattended + skip permissions | Fully automated pipelines |

**Detection**: Check environment variables and session context:
- `CLAUDE_DANGEROUS_MODE=1` → dangerous mode
- `CLAUDE_UNATTENDED=1` → unattended mode
- Presence of `--dangerous` in original command → dangerous mode
- Multiple issues/tasks in queue → likely batch mode

---

## Metadata

```json
{
  "checkpoint_version": "1.1",
  "parent_session_id": null,
  "handoff_count": 0,
  "estimated_remaining_work": "medium",
  "priority": "high",
  "execution_mode": {
    "mode": "interactive",
    "auto_continue": false,
    "source_command": null,
    "remaining_tasks": [],
    "dangerous_mode": false
  },
  "existing_task_ids": []
}
```
```

## Minimal Template

For quick checkpoints:

```markdown
# Quick Checkpoint
state_version: 1

**Task**: [What we're doing]
**Progress**: [Where we are]
**Next**: [Immediate next step]
**Files**: [Key files to read]
```

## Writing Session State

### When to Write

1. **Context threshold exceeded** (80%+)
2. **Natural task boundary** (phase complete)
3. **Before risky operation** (safety checkpoint)
4. **Manual checkpoint request**

### What to Include

**Essential** (always include):
- Current objective
- Progress summary
- Immediate next step
- Key files

**Important** (include when relevant):
- Decisions made with rationale
- Open TodoWrite items
- Warnings/gotchas

**Optional** (include for complex tasks):
- Alternatives considered
- Blocked items
- Detailed metadata

### Writing Checklist

Before writing session state:

- [ ] Objective is clear and specific
- [ ] Progress accurately reflects completed work
- [ ] Next step is actionable (not vague)
- [ ] File paths are correct and accessible
- [ ] Decisions are documented with rationale
- [ ] No sensitive information included

## Reading Session State

### Continuation Agent Protocol

When a continuation agent starts:

1. **Read state file first**
   ```
   Read .claude/session-state.md
   ```

2. **Verify understanding**
   - Summarize the objective
   - Confirm progress status
   - Identify immediate next step

3. **Re-read critical files**
   - Files listed in "Context to Re-read"
   - Files marked "In Progress"

4. **Acknowledge handoff**
   - Confirm readiness to continue
   - Note any questions or ambiguities

5. **Execute continuation**
   - Start from "Immediate Next Step"
   - Follow task workflow

### Handling Ambiguity

If state file is unclear:

1. **Check for related files**
   - Recent git changes
   - Open PRs/issues
   - Project documentation

2. **Make reasonable assumptions**
   - Document assumptions made
   - Proceed with caution

3. **Flag uncertainties**
   - Note areas of confusion
   - Ask for clarification if critical

## State File Lifecycle

```
┌─────────────────┐
│ Task Started    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Work in Progress│◄──────────────┐
└────────┬────────┘               │
         │                        │
         ▼                        │
┌─────────────────┐    No        │
│ Context > 80%?  │──────────────┘
└────────┬────────┘
         │ Yes
         ▼
┌─────────────────┐
│ Write State File│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Spawn Subagent  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Subagent Reads  │
│ State File      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Continue Work   │──────────────►(Back to Work in Progress)
└─────────────────┘
```

## Multi-Handoff Chains

For very long tasks, multiple handoffs may occur:

```markdown
## Metadata

```json
{
  "checkpoint_version": "1.0",
  "parent_session_id": "handoff-001",
  "handoff_count": 2,
  "handoff_history": [
    {"id": "handoff-001", "reason": "context_threshold", "timestamp": "..."},
    {"id": "handoff-002", "reason": "context_threshold", "timestamp": "..."}
  ]
}
```
```

Each continuation agent increments `handoff_count` and adds to `handoff_history`.

**Recommended max**: Set a limit of 5-10 handoffs to prevent infinite chains. If `handoff_count` exceeds the limit, stop and report to the user rather than spawning another continuation agent.

## Best Practices

1. **Be Specific**: "Add validation to parse_config()" not "Continue working on config"

2. **Include Context**: Don't assume continuation agent knows anything

3. **Document Decisions**: Future agents need to understand WHY, not just WHAT

4. **Test File Paths**: Ensure all referenced files exist and are readable

5. **Keep It Updated**: Stale state files cause confusion

6. **Clean Up**: Remove old state files after task completion

## Example: Real Handoff

### Original Agent State

```markdown
# Session State Checkpoint
state_version: 1

**Generated**: 2025-01-15 14:30:00
**Reason**: Context threshold exceeded (82%)
**Context Level**: ~82%

---

## Current Objective

Implement the `clear-context` skill for the conserve plugin, including
the main skill file, session-state module, and hook integration.

### Success Criteria
- [x] Create skill directory structure
- [x] Write main SKILL.md
- [ ] Write session-state module
- [ ] Update context_warning.py hook
- [ ] Create continuation agent definition
- [ ] Test the full workflow

---

## Progress Summary

### Completed
- [x] Created /plugins/conserve/skills/clear-context/
- [x] Created /plugins/conserve/skills/clear-context/modules/
- [x] Wrote SKILL.md with full documentation

### In Progress
- [ ] Writing session-state.md module (this file)

### Remaining
- [ ] Update context_warning.py with 80% threshold
- [ ] Create continuation-agent.md
- [ ] Integration testing

---

## Key Decisions Made

| Decision | Rationale | Alternatives |
|----------|-----------|--------------|
| Use subagent delegation | Can't programmatically /clear | Manual clear workflow |
| 80% default threshold | Leaves 20% buffer | 75%, 85% |
| .claude/session-state.md | Project-scoped | /tmp, ~/.claude |

---

## Continuation Instructions

### Immediate Next Step
Complete the session-state.md module, then update context_warning.py

### Context to Re-read
1. `/plugins/conserve/skills/clear-context/SKILL.md` - Main skill reference
2. `/plugins/conserve/hooks/context_warning.py` - Hook to update

### Warnings/Gotchas
- CLAUDE_CONTEXT_USAGE env var may not be set
- Design must work with estimation fallback
```

### Continuation Agent Response

```
I've read the session state checkpoint. Let me verify my understanding:

**Objective**: Implement clear-context skill for conserve plugin
**Progress**: SKILL.md is complete, session-state module in progress
**Next Step**: Complete session-state.md, then update context_warning.py

Reading the referenced files now to continue...
```
