---
name: context-overflow
description: >
  Procedures for reconstructing decision context when the
  agent context window is exhausted mid-session. Covers
  handoff summaries, task list as ground truth, and safe
  continuation without replaying lost context.
parent_skill: leyline:damage-control
category: infrastructure
estimated_tokens: 260
---

# Context Overflow

## When This Module Applies

Use this module when the context window is near or at its limit
and the agent can no longer reliably recall earlier decisions,
completed steps, or the rationale behind current state.
Symptoms:

- Agent references a decision it cannot locate in the current
  window
- Agent re-does work already done in the same session
- Earlier tool call results are no longer visible
- The session produces contradictory outputs (second half
  disagrees with first half)

## Why Context Overflow Is Dangerous

Unlike a crash, context overflow produces no error. The agent
continues running but loses access to prior context. It may:

- Re-implement work already completed, creating duplicates
- Make decisions that contradict earlier reasoning
- Omit dependencies established in the now-invisible portion
- Silently discard constraints agreed on with the user

## Recovery Protocol

### Step 1: Stop and checkpoint

Before taking any further actions, write the current known
state to a durable anchor. The task list is the primary
anchor: it is outside the context window and survives session
boundaries.

For each task currently `in_progress`:

1. Record the last completed step in the task description
2. List any decisions made that affect downstream tasks
3. List any constraints or agreed deviations from the plan

### Step 2: Establish ground truth from durable sources

Context is gone. Recover state from sources that are not
inside the window:

| Source | What it tells you |
|---|---|
| Task list | Which tasks are done, in progress, or pending |
| `git log --oneline -20` | What was committed and when |
| `git diff HEAD` | Uncommitted work in progress |
| `git status` | Staged vs. unstaged state |
| Test results | Whether the last committed state is valid |

Do not trust the agent's recall of anything not confirmed by
one of these sources.

### Step 3: Summarize for continuation

Before ending the session or handing off to a new agent,
write a handoff summary. Place it as a comment in the task
description or in a temporary scratch note that the next
agent can read at session start:

```
## Handoff Summary — [timestamp]

### Completed this session
- [task IDs and one-line description of what was done]

### Decisions made (not yet committed anywhere)
- [decision: rationale]

### In-progress state
- Task T042: completed steps 1-3; step 4 (write tests) not yet started
- Files modified but not committed: src/auth/token.py

### Constraints to carry forward
- [any deviations agreed with human, constraints on implementation]

### Recommended next action
- Resume T042 at step 4
```

### Step 4: Hand off or end session cleanly

If handing off to a new agent:

- Commit all completed work before handoff
- Push the handoff summary to the task list
- The new agent reads the handoff summary before starting work

If ending the session:

- Stash or commit any in-progress work
- Do not leave staged changes without a note explaining them

### Recovering in the same session (partial overflow)

If context is not fully exhausted but early reasoning is no
longer visible:

- Run `git log --oneline` to anchor what was committed
- Re-read the task list to anchor task state
- Proceed only with actions the current visible context can
  fully justify. Do not act on half-remembered prior context

## Exit Criteria

- A handoff summary exists recording completed work,
  in-progress state, and decisions made
- All completed work is committed or stashed with a descriptive
  message
- The task list reflects the current completion status of every
  task touched this session
- The next agent (or resumed session) can restore full working
  context from the handoff summary plus git history alone,
  without relying on the overflowed context window
