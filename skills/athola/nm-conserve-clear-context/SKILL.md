---
name: clear-context
description: |
  Automatic context management with graceful handoff to a continuation subagent at 80% usage
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/conserve", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: conserve
---

> **Night Market Skill** — ported from [claude-night-market/conserve](https://github.com/athola/claude-night-market/tree/master/plugins/conserve). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Quick Start](#quick-start)
- [When to Use](#when-to-use)
- [The Auto-Clear Pattern](#the-auto-clear-pattern)
- [Thresholds](#thresholds)
- [Auto-Clear Workflow](#auto-clear-workflow)
- [Integration with Existing Hooks](#integration-with-existing-hooks)
- [Self-Monitoring Pattern](#self-monitoring-pattern)

# Clear Context Skill

## Quick Start

When context pressure reaches critical levels (80%+), invoke this skill to:
1. Save current session state
2. Delegate continuation to a fresh subagent
3. Continue work without manual intervention

```
Skill(conserve:clear-context)
```

## When To Use

- **Proactively**: Before starting large multi-chained tasks
- **Reactively**: When context warning indicates 80%+ usage
- **Automatically**: Integrated into long-running workflows

## When NOT To Use

- Context usage is under 50% - continue working normally
- Mid-critical-operation where handoff would lose state
- **Consider "Summarize from here" first** (Claude Code 2.1.32+): Before full auto-clear,
  try partial summarization via the message selector. This compresses older context while
  preserving recent work — often sufficient to relieve pressure without a full handoff.

## The Auto-Clear Pattern

Since `/clear` requires user action, we achieve automatic context clearing without interruption through **subagent delegation**:

```
Main Agent (high context)
    ↓
    Saves state to .claude/session-state.md
    ↓
    Spawns continuation subagent (fresh context)
    ↓
    Subagent reads state, continues work
```

## Thresholds

| Level | Threshold | Action |
|-------|-----------|--------|
| WARNING | 40% | Monitor, plan optimization |
| CRITICAL | 50% | Prepare for handoff |
| EMERGENCY | 80% | **Execute auto-clear now** |

**Configuration** (environment variables):
- `CONSERVE_EMERGENCY_THRESHOLD`: Override 80% default (e.g., `0.75` for 75%)
- `CONSERVE_SESSION_STATE_PATH`: Override `.claude/session-state.md` default

## Auto-Clear Workflow

### Step 1: Assess Current State

Before triggering auto-clear, gather:
- Current task/goal description
- Progress made so far
- Key decisions and rationale
- Files being actively worked on
- Open TodoWrite items

### Step 1.5: Finalize Task List Before Handoff

**Important**: Before saving state or spawning a continuation agent, reconcile the task list:

1. **Review all tasks** via `TaskList`
2. **Mark completed tasks** as `completed` via `TaskUpdate` — do NOT leave done work as `in_progress`
3. **Record existing task IDs** — collect all task IDs (pending and in_progress) to pass in the session state so the continuation agent references them instead of creating duplicates
4. **Include task IDs in session state** under the `existing_task_ids` field (see Step 2)

This prevents the continuation agent from creating duplicate tasks.

### Step 2: Save Session State

**Important**: If `.claude/session-state.md` already exists, always Read it first before writing (Claude Code requires reading existing files before overwriting). Create the `.claude/` directory if it doesn't exist.

Write to `.claude/session-state.md` (or `$CONSERVE_SESSION_STATE_PATH`):

```markdown
# Session State Checkpoint
state_version: 1
Generated: [timestamp]
Reason: Context threshold exceeded (80%+)

## Execution Mode

**Mode**: [unattended | interactive | dangerous]
**Auto-Continue**: [true | false]
**Source Command**: [do-issue | execute-plan | etc.]
**Remaining Tasks**: [list of pending items]

> **Important**: If `auto_continue: true` or mode is `dangerous`/`unattended`,
> the continuation agent should not pause for user confirmation.
> Continue executing all remaining tasks until completion.

## Current Task
[What we're trying to accomplish]

## Progress Summary
[What's been done so far]

## Key Decisions
- Decision 1: [rationale]
- Decision 2: [rationale]

## Active Files
- path/to/file1.py - [status]
- path/to/file2.md - [status]

## Pending TodoWrite Items
- [ ] Item 1
- [ ] Item 2

## Existing Task IDs
[List task IDs from TaskList so the continuation agent can reference them
instead of creating duplicates. Example:]
- Task #1: "Implement feature X" (in_progress)
- Task #2: "Write tests for feature X" (pending)

## Continuation Instructions
[Specific next steps for the continuation agent]
```

**Execution Mode Detection**:

Before writing state, detect the execution mode:

```python
# Detect execution mode from environment/context
execution_mode = {
    "mode": "interactive",  # default
    "auto_continue": False,
    "source_command": None,
    "remaining_tasks": [],
    "dangerous_mode": False
}

# Check for dangerous/unattended mode indicators
if os.environ.get("CLAUDE_DANGEROUS_MODE") == "1":
    execution_mode["mode"] = "dangerous"
    execution_mode["auto_continue"] = True
    execution_mode["dangerous_mode"] = True
elif os.environ.get("CLAUDE_UNATTENDED") == "1":
    execution_mode["mode"] = "unattended"
    execution_mode["auto_continue"] = True

# Inherit from parent session state if exists
if parent_state and parent_state.get("execution_mode"):
    execution_mode = parent_state["execution_mode"]
```

### Step 3: Spawn Continuation Agent

Use the Task tool to delegate. **Important**: Include execution mode in the task prompt:

```
Task: Continue the work from session checkpoint

Instructions:
1. Read .claude/session-state.md for full context
2. Check the "Execution Mode" section FIRST
3. If `auto_continue: true` or mode is `dangerous`/`unattended`:
   - DO NOT pause for user confirmation
   - Continue executing ALL remaining tasks until completion
   - Only stop on actual errors or when all work is done
4. **TASK LIST**: Do NOT create new tasks via TaskCreate. The parent agent
   already created the task list. Use TaskList to see existing tasks, and
   TaskUpdate to mark them in_progress/completed. Check the "Existing Task IDs"
   section in the session state for the authoritative list.
5. Verify understanding of current task and progress
6. Continue from where the previous agent left off
7. If you also approach 80% context, repeat this handoff process
   - PRESERVE the execution mode when creating your own checkpoint

The session state file contains all necessary context to continue without interruption.

**Execution mode inheritance**: Always inherit and propagate the execution
mode from the session state. If the parent was in dangerous/unattended mode,
you are also in that mode. Do not ask the user for confirmation.

**Task deduplication**: Do not create duplicate tasks. The parent has already
populated the task list. Use TaskUpdate on existing task IDs only.
```

**For batch/multi-issue workflows** (e.g., `/do-issue 42 43 44`):

```
Task: Continue batch processing from session checkpoint

Instructions:
1. Read .claude/session-state.md for full context
2. EXECUTION MODE: This is a batch operation with auto_continue=true
3. Process ALL remaining tasks in the queue:
   - Remaining: [issue #43, issue #44]
4. DO NOT stop between tasks - continue until all are complete
5. If you hit 80% context, hand off with the same execution mode
6. Only pause for:
   - Actual errors requiring human judgment
   - Completion of ALL tasks

This is an unattended batch operation. Continue without user prompts.
```

**Task Tool Details:**
- Spawns subagent with fresh 1M context window
- Up to 10 parallel agents supported
- ~20k token overhead per subagent

### Step 3 Fallback: Graceful Wrap-Up

If Task tool is unavailable (permissions, context restrictions):

1. **Complete current in-progress work** (finish edits, commits)
2. **Summarize remaining tasks** in your response
3. **Let auto-compact handle continuation** - Claude Code compresses context automatically
4. **Manual continuation options**:
   - `claude --continue` to resume session
   - New session + `/catchup` to understand changes
   - Read `.claude/session-state.md` for saved context

> **Fixed in 2.1.63**: `/clear` now properly resets cached skills. Previously, stale skill content could persist into the new conversation. The `/clear` + `/catchup` pattern is now fully reliable.

> **Fixed in 2.1.72**: `/clear` now only clears foreground tasks. Background agent and bash tasks continue running. Previously, `/clear` would kill all tasks including background ones, which was problematic for long-running background agents that should survive context resets.

## Integration with Existing Hooks

This skill works with `context_warning.py` hook:

1. Hook fires on PreToolUse
2. At 80%+ threshold, hook injects emergency guidance
3. Guidance recommends invoking this skill
4. Skill executes auto-clear workflow

## Module Loading

For detailed session state format and examples:
- See `modules/session-state.md` for checkpoint format and handoff patterns
- See `modules/session-state-schema.md` for versioned schema and migration logic

## Self-Monitoring Pattern

For workflows that might exceed context, add periodic checks:

```python
# Pseudocode for context-aware workflow
def long_running_task():
    for step in task_steps:
        execute_step(step)

        # Check context after each major step
        if estimate_context_usage() > 0.80:
            invoke_skill("conserve:clear-context")
            return  # Continuation agent takes over
```

## Context Measurement Methods

### Precise (Headless/Batch)

For accurate token breakdown in automation:

```bash
claude -p "/context" --verbose --output-format json
```

See `/conserve:optimize-context` for full headless documentation.

### Fast Estimation (Real-time Hooks)

For hooks where speed matters, use heuristics:

1. **JSONL file size**: ~800KB ≈ 100% context (used by context_warning hook)
2. **Turn count**: ~5-10K tokens per complex turn
3. **Tool invocations**: Heavy tool use = faster growth

## Example: Brainstorm with Auto-Clear

```markdown
## Brainstorm Session with Context Management

1. Before starting, note current context level
2. Set checkpoint after each brainstorm phase:
   - Problem definition checkpoint
   - Constraints checkpoint
   - Approaches checkpoint
   - Selection checkpoint

3. If context exceeds 80% at any checkpoint:
   - Save brainstorm state
   - Delegate to continuation agent
   - Agent continues from checkpoint
```

## Best Practices

1. **Checkpoint Frequently**: During long tasks, save state at natural breakpoints
2. **Clear Instructions**: Continuation agent needs specific, actionable guidance
3. **Verify Handoff**: Ensure state file is written before spawning subagent
4. **Monitor Recursion**: Continuation agents can also hit limits - design for chaining

## Troubleshooting

### Continuation agent doesn't have full context
- Ensure session-state.md is comprehensive
- Include all relevant file paths
- Document implicit assumptions

### Subagent fails to continue properly
- Check that state file path is correct
- Verify file permissions
- Add more specific continuation instructions

### Context threshold not detected
- CLAUDE_CONTEXT_USAGE may not be set
- The `context_warning` hook uses fallback estimation from session file size
- Manual invocation always works

## Hook Integration

This skill is triggered automatically by the **context_warning hook** (`hooks/context_warning.py`):

- **40% usage**: WARNING - plan optimization soon
- **50% usage**: CRITICAL - immediate optimization required
- **80% usage**: EMERGENCY - this skill should be invoked immediately

The hook monitors context via:
1. `CLAUDE_CONTEXT_USAGE` environment variable (when available)
2. Fallback: estimates from session JSONL file size (~800KB = 100%)

Configure thresholds via environment:
- `CONSERVE_EMERGENCY_THRESHOLD`: Override 80% default (e.g., "0.75")
- `CONSERVE_CONTEXT_ESTIMATION`: Set to "0" to disable fallback
- `CONSERVE_CONTEXT_WINDOW_BYTES`: Override 800000 byte estimate
