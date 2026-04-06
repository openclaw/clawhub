---
name: subagent-coordination
description: |
  Workflow decomposition and subagent delegation patterns for
  managing context-heavy operations.
category: conservation
---

# Subagent Coordination Module

## Overview

This module provides patterns for decomposing complex workflows and delegating to subagents to maintain MECW compliance.

## Auto-Compaction (Claude Code 2.1.1+)

**Critical Discovery**: Subagent conversations automatically compact when context reaches ~160k tokens.

### How It Works

Claude Code v2.1.1+ introduced automatic context compaction for "sidechain" (subagent) conversations:

```json
{
  "isSidechain": true,
  "agentId": "a2223d9",
  "type": "system",
  "subtype": "compact_boundary",
  "compactMetadata": {
    "trigger": "auto",
    "preTokens": 167189
  }
}
```

**Key observations**:
- **Threshold**: ~160k tokens triggers compaction
- **Automatic**: No configuration needed - system handles it
- **Transparent**: Subagent continues working after compaction
- **Logged**: Check agent logs for `compact_boundary` events

### Implications for Agent Design

1. **Long-running subagents are safe**: They won't crash at context limits
2. **No manual checkpointing needed**: System handles context overflow
3. **Design for continuity**: Ensure subagent state survives compaction
   - Store critical state in files, not just conversation
   - Use explicit progress markers (TodoWrite, checkpoints)
   - Avoid relying on early conversation context for late decisions

### Background Agent Permissions (Claude Code 2.1.20+)

Background agents now **prompt for tool permissions before launching** into the background. This means:

- When a user backgrounds a task (Ctrl+B), permissions are confirmed upfront
- Agents won't stall mid-execution waiting for permission approval
- Multi-agent workflows (e.g., `sanctum:do-issue`) may show permission prompts for each dispatched agent before they begin background work

**Design consideration**: If your workflow dispatches multiple agents in parallel, users will see permission prompts sequentially before agents start. This is expected behavior, not a bug.

### Session Resume Compaction (Claude Code 2.1.20+)

Fixed: `--resume` now correctly loads the compact summary instead of full history. Previously, resumed sessions could reload the entire uncompacted conversation, negating compaction benefits. Subagent state preservation patterns (TodoWrite checkpoints, file-based state) remain the recommended approach since compaction summaries may omit details.

### Task Tool Metrics (Claude Code 2.1.30+)

Task tool results now include **token count**, **tool uses**, and **duration** metrics. This enables data-driven delegation decisions instead of heuristic estimates.

**Key implications**:
- The `should_delegate()` decision framework can now incorporate **actual measured efficiency** from prior Task invocations
- Coordination metrics (line `track_coordination_metrics`) can use native duration instead of manual timing
- Post-execution validation can compare estimated vs. actual token spend per subagent

**Using Task metrics for delegation decisions**:
```python
def should_delegate_with_metrics(task, prior_task_results):
    """Enhanced delegation using real Task tool metrics."""
    # If we have prior data for similar tasks, use actual measurements
    similar = find_similar_prior_results(task, prior_task_results)
    if similar:
        avg_tokens = mean(r.token_count for r in similar)
        avg_duration = mean(r.duration for r in similar)
        efficiency = avg_tokens / (avg_tokens + BASE_OVERHEAD)
        return efficiency >= MIN_EFFICIENCY, f"Measured efficiency: {efficiency:.1%}"

    # Fall back to heuristic estimation for novel tasks
    return should_delegate(task, context_usage)
```

### Improved TaskStop Display (Claude Code 2.1.30+)

TaskStop now shows the **stopped command/task description** instead of a generic "Task stopped" message. This improves debugging of multi-agent workflows — when a subagent is stopped due to context pressure or timeout, you can now identify *which* task was affected without parsing logs.

### Auto-Compact Threshold Fix (Claude Code 2.1.21+)

Fixed: Auto-compact no longer triggers too early on models with large output token limits. Previously, models like Opus (with larger max output) could see compaction trigger significantly below the expected ~160k threshold because the effective context calculation didn't properly account for output token reservation. The thresholds in the table below are now accurate across all model tiers.

### When Auto-Compaction Triggers

| Context Usage | Behavior |
|--------------|----------|
| < 80% (~128k) | Normal operation |
| 80-90% (~128-144k) | Warning zone, plan wrap-up |
| > 90% (~144k+) | Compaction imminent |
| ~160k | **Auto-compaction triggers** |

### Worktree Isolation for Parallel Agents (Claude Code 2.1.49+)

Agents with `isolation: worktree` in their frontmatter run in a temporary git worktree, providing filesystem-level isolation for parallel execution.

- **Parallel safety**: Multiple agents can modify the same files without conflicts — each gets its own working directory
- **Auto-cleanup**: Worktree is removed if the agent makes no changes; preserved with commits if changes exist
- **Frontmatter**: Add `isolation: worktree` to any agent definition, or use `--worktree` CLI flag
- **Background agent constraint**: Agents with `background: true` **cannot use MCP tools or AskUserQuestion** — plan tool access accordingly when combining background execution with worktree isolation
- **First-launch fix (2.1.53+)**: `--worktree` was sometimes silently ignored on first launch — now reliable
- **Config and memory sharing (2.1.63+)**: Project configs and auto-memory are now shared across git worktrees of the same repository. Worktree-isolated agents inherit the parent repo's `.claude/` settings and memory.

### Memory Stability in Long Sessions (Claude Code 2.1.47+)

2.1.47 fixes an O(n^2) message accumulation issue and adds stream buffer release, reducing memory growth in long-running agent sessions. This is particularly relevant for multi-agent workflows where the parent dispatches many sequential subagents — previously, memory usage could grow disproportionately as each subagent's results accumulated. The fix makes sustained orchestration sessions (e.g., large map-reduce pipelines) more stable without requiring manual session restarts.

### Additional Memory Fixes (Claude Code 2.1.50+)

2.1.50 patches several leaks relevant to Task-heavy
workflows: completed TaskOutput and task state objects
are now freed, CircularBuffer no longer retains cleared
items, shell ChildProcess/AbortController references are
released after cleanup, and agent team teammate tasks are
garbage collected on completion. Internal caches are
cleared after compaction, large tool results are freed
after processing, and file history snapshots are capped.
Parallel execution patterns and agent teams are more
viable in long sessions as a result.

### Memory Leak Fixes (Claude Code 2.1.63+)

2.1.63 fixes 12+ memory leak sites: bridge polling,
MCP OAuth cleanup, hooks config menu, permission handler
auto-approvals, bash prefix cache, MCP tool/resource
cache on reconnect, IDE host IP cache, WebSocket
transport reconnect, git root detection cache, JSON
parsing cache, long-running teammate messages in
AppState, and MCP server fetch caches on disconnect.
Heavy progress message payloads are now stripped during
subagent context compaction. Long-running sessions and
multi-agent workflows are significantly more stable.

### Subagent Task State Release (Claude Code 2.1.59+)

2.1.59 releases completed subagent task state from
memory, further reducing RSS growth in Task-heavy
workflows. Combined with the 2.1.50 leak fixes, this
makes sustained multi-agent orchestration sessions more
stable without requiring manual session restarts.

### Tool Result Disk Persistence (Claude Code 2.1.51+)

Tool results larger than 50K characters are persisted to
disk instead of kept inline in conversation context
(previously 100K). This halves the threshold, meaning
more tool outputs are offloaded from the context window.
Subagent-heavy workflows benefit most: each agent's tool
results consume less parent context when aggregated.

### Best Practice: State Preservation

For subagents handling complex, multi-step workflows:

```python
# Pattern: Externalize critical state before compaction risk
def preserve_subagent_state(progress):
    """
    Write state to files so it survives compaction.
    """
    # Write to TodoWrite for task state
    todo_state = {
        'completed': progress.completed_tasks,
        'pending': progress.pending_tasks,
        'context': progress.critical_context
    }

    # Write to temporary file for complex state
    with open('/tmp/subagent_checkpoint.json', 'w') as f:
        json.dump(todo_state, f)

    # Key findings should be in output, not just memory
    return f"Checkpoint saved: {len(progress.completed_tasks)} complete"
```

### Monitoring Auto-Compaction

Check for compaction events in agent logs:

```bash
# Look for compaction boundaries in recent logs
grep -r "compact_boundary" ~/.claude/projects/*/agent_*.log | tail -5
```

## Critical: Subagent Overhead Reality

**Every subagent inherits ~16k+ tokens of system context** (tool definitions, permissions, system prompts) regardless of instruction length. This is the "base overhead" that makes subagents expensive for simple tasks.

### The Economics

| Task Type | Task Tokens | + Base Overhead | Total | Efficiency |
|-----------|-------------|-----------------|-------|------------|
| Simple commit | ~50 | +8,000 | 8,050 | **0.6%** ❌ |
| PR description | ~200 | +8,000 | 8,200 | **2.4%** ❌ |
| Code review | ~3,000 | +8,000 | 11,000 | **27%** ⚠️ |
| Architecture analysis | ~15,000 | +8,000 | 23,000 | **65%** ✅ |
| Multi-file refactor | ~25,000 | +8,000 | 33,000 | **76%** ✅ |

**Rule of Thumb**: If task reasoning < 2,000 tokens, parent agent should do it directly.

### Cost Comparison (Haiku vs Opus)

Even though Haiku is ~60x cheaper per token:
- Parent (Opus) doing simple commit: ~200 tokens = ~$0.009
- Subagent (Haiku) doing simple commit: ~8,700 tokens = ~$0.0065

**Marginal savings ($0.003) don't justify**:
- Latency overhead (subagent spin-up)
- Complexity cost (more failure modes)
- Opportunity cost (8k tokens could fund real reasoning)

## When to Delegate

### CRITICAL: Pre-Invocation Check

**The complexity check MUST happen BEFORE calling the Task tool.**

Once you invoke a subagent, it has already loaded ~8k+ tokens of system context.
A subagent that "bails early" still costs nearly the full overhead.

```
❌ WRONG: Invoke agent → Agent checks complexity → Agent bails → 8k tokens wasted

✅ RIGHT: Parent checks complexity → Skip invocation → 0 tokens spent
```

### Simple Task Threshold

**Before delegating, ask**: "Does this task require analysis, or just execution?"

| Task Type | Reasoning Required | Delegate? |
|-----------|-------------------|-----------|
| `git add && git commit && git push` | None | **NO** - parent does directly |
| "Classify changes and write commit" | Minimal | **NO** - parent does directly |
| "Review PR for security issues" | Substantial | **MAYBE** - if context pressure |
| "Analyze architecture and suggest refactors" | High | **YES** - benefits from fresh context |

### Pre-Invocation Checklist (Parent MUST verify)

Before calling ANY subagent via Task tool:

1. **Can I do this in one command?** → Do it directly
2. **Is the reasoning < 500 tokens?** → Do it directly
3. **Is this a "run X" request?** → Run X directly
4. **Check agent description for ⚠️ PRE-INVOCATION CHECK** → Follow it

### Delegation Triggers (Updated)

| Trigger | Threshold | Action |
|---------|-----------|--------|
| **Task reasoning** | < 2,000 tokens | ❌ Parent does directly |
| Task reasoning | > 2,000 tokens | Consider delegation |
| Context pressure | > 40% usage | Consider delegation |
| Task complexity | > 5 distinct steps | Recommend delegation |
| File operations | > 3 large files | Require delegation |
| Parallel work | Independent subtasks | Optimal for delegation |

### Decision Framework

```python
# Constants
BASE_OVERHEAD = 8000  # System context inherited by every subagent
MIN_EFFICIENCY = 0.20  # 20% minimum efficiency threshold

def should_delegate(task, context_usage):
    """
    Determine if task should be delegated to subagent.

    Key insight: Every subagent inherits ~8k tokens of system context.
    Simple tasks (git commit, file move) waste 99%+ on overhead.
    Only delegate when task reasoning justifies the base cost.
    """
    # FIRST CHECK: Is this a simple execution task?
    if task.estimated_reasoning_tokens < 500:
        return False, "Simple task - parent executes directly"

    # Calculate efficiency
    efficiency = task.estimated_reasoning_tokens / (
        task.estimated_reasoning_tokens + BASE_OVERHEAD
    )

    if efficiency < MIN_EFFICIENCY:
        return False, f"Efficiency {efficiency:.1%} below threshold - parent does it"

    # Context pressure override (delegate even if borderline efficient)
    if context_usage > 0.45:
        return True, "Context pressure requires delegation"

    # Recommended delegation for complex tasks
    if task.estimated_reasoning_tokens > 2000:
        return True, f"Substantial reasoning ({task.estimated_reasoning_tokens} tokens) justifies subagent"

    if task.is_parallelizable and len(task.subtasks) >= 3:
        return True, "Parallel subtasks can run concurrently"

    return False, "Task can be handled in current context"


def estimate_reasoning_tokens(task_description: str) -> int:
    """
    Estimate how many tokens of actual reasoning a task requires.

    Examples:
    - "git add && commit && push" → ~20 tokens (just commands)
    - "Write conventional commit for staged changes" → ~100 tokens
    - "Review PR for security issues" → ~3000 tokens
    - "Analyze architecture and propose refactors" → ~10000 tokens
    """
    # Simple heuristic based on task type
    simple_patterns = ["git add", "git commit", "git push", "mv ", "cp ", "rm "]
    if any(p in task_description.lower() for p in simple_patterns):
        return 50  # Pure execution, minimal reasoning

    analysis_patterns = ["review", "analyze", "evaluate", "assess", "audit"]
    if any(p in task_description.lower() for p in analysis_patterns):
        return 3000  # Substantial reasoning required

    creation_patterns = ["refactor", "implement", "design", "architect"]
    if any(p in task_description.lower() for p in creation_patterns):
        return 5000  # Heavy reasoning required

    return 500  # Default moderate reasoning
```

## Workflow Decomposition

### Breaking Down Complex Tasks

```python
def decompose_workflow(task):
    """
    Break complex task into delegatable units.
    """
    subtasks = []

    # Identify independent components
    for component in task.components:
        if component.has_no_dependencies():
            subtasks.append({
                'type': 'parallel',
                'component': component,
                'can_run_concurrently': True
            })
        else:
            subtasks.append({
                'type': 'sequential',
                'component': component,
                'dependencies': component.dependencies
            })

    return subtasks
```

### Task Packaging

When delegating to a subagent, package:
1. **Clear objective**: What the subagent should accomplish
2. **Required context**: Minimal context needed for the task
3. **Expected output**: Format and content of results
4. **Constraints**: Time limits, resource bounds, quality requirements

## Subagent Patterns

### Pattern 1: Parallel Exploration

```python
# Launch multiple subagents for independent searches
subagents = [
    Task(subagent_type="Explore", prompt="Find auth implementations"),
    Task(subagent_type="Explore", prompt="Find database models"),
    Task(subagent_type="Explore", prompt="Find API endpoints"),
]
# All run concurrently with fresh context each
```

### Pattern 2: Sequential Pipeline

```python
# Chain subagents where each builds on previous
def sequential_pipeline(tasks):
    context = {}
    for task in tasks:
        result = delegate_to_subagent(task, context)
        context.update(result.summary)  # Pass only summary
    return context
```

### Pattern 3: Map-Reduce

```python
# Split large operation, process in parallel, combine results
def map_reduce(files, operation):
    # Map phase: delegate each file to subagent
    results = parallel_delegate([
        {'file': f, 'operation': operation}
        for f in files
    ])

    # Reduce phase: synthesize results
    return synthesize_results(results)
```

## Execution Coordination

### Managing Subagent State

```python
class SubagentCoordinator:
    def __init__(self):
        self.active_subagents = []
        self.results = {}

    def dispatch(self, task_spec):
        """Dispatch task to subagent."""
        subagent_id = launch_subagent(task_spec)
        self.active_subagents.append(subagent_id)
        return subagent_id

    def collect_results(self):
        """
        Collect and synthesize subagent results.

        As of Claude Code 2.1.47, background agents return the final
        answer directly — no transcript parsing needed.
        """
        for subagent_id in self.active_subagents:
            self.results[subagent_id] = get_subagent_result(subagent_id)
        return self.synthesize()

    def synthesize(self):
        """Combine results from all subagents."""
        return {
            'status': 'completed',
            'results': list(self.results.values()),
            'summary': create_summary(self.results)
        }
```

## Result Synthesis

### Combining Subagent Output

1. **Extract key findings**: Pull essential information from each result
2. **Resolve conflicts**: Handle contradictory findings
3. **Build coherent summary**: Create unified view for parent context
4. **Preserve references**: Keep pointers to detailed results if needed

### Synthesis Patterns

```python
def synthesize_exploration_results(results):
    """
    Combine results from parallel exploration subagents.
    """
    synthesis = {
        'files_found': [],
        'patterns_identified': [],
        'recommendations': []
    }

    for result in results:
        synthesis['files_found'].extend(result.get('files', []))
        synthesis['patterns_identified'].extend(result.get('patterns', []))
        synthesis['recommendations'].extend(result.get('recommendations', []))

    # Deduplicate and prioritize
    synthesis['files_found'] = list(set(synthesis['files_found']))
    synthesis['recommendations'] = prioritize(synthesis['recommendations'])

    return synthesis
```

## Agent Teams (Experimental — Claude Code 2.1.32+)

Claude Code 2.1.32 introduces **agent teams** as a research preview for multi-agent collaboration. This is a fundamentally different coordination model from Task-based subagent delegation.

**Enable**: Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

### Agent Teams vs Task Tool

| Aspect | Task Tool (Current) | Agent Teams (Experimental) |
|--------|--------------------|-----------------------------|
| **Coordination** | Parent dispatches, collects results | Lead assigns, teammates message each other |
| **Communication** | One-way (parent→child→result) | Bidirectional (lead↔teammates, teammate↔teammate) |
| **State** | Independent context per subagent | Shared task list, message passing |
| **Parallelism** | Up to 10 concurrent tasks | Lead + multiple teammates |
| **Resume** | Sessions resumable | No resume with in-process teammates |
| **Nesting** | Subagents can spawn subagents | No nested teams |

### When to Use Agent Teams

- Complex multi-step projects where subtasks have **interdependencies**
- Workflows requiring **real-time coordination** between workers
- Situations where one agent's output directly feeds another's input

### When to Stick with Task Tool

- Independent, parallelizable subtasks (map-reduce patterns)
- Simple delegation with clear input→output contracts
- Workflows that need session resumption reliability

### Known Limitations

- **No session resumption**: `/resume` does not restore in-process teammates
- **Task status lag**: Teammates may not mark tasks complete — check manually if stuck
- **One team per session**: Clean up before starting a new team
- **Token-intensive**: Agent teams consume significantly more tokens than Task-based delegation

### Recommendation

Use Task tool patterns for production workflows. Consider agent teams for exploratory, complex coordination scenarios where inter-agent communication adds clear value. Monitor the experimental feature for stabilization before migrating critical workflows.

### Agent Teams Hook Events (Claude Code 2.1.33+)

Two new hook events enable tighter coordination in agent teams workflows:

- **`TeammateIdle`**: Triggered when a teammate agent becomes idle. Use for dynamic work assignment — detect when a teammate finishes and assign new work without polling.
- **`TaskCompleted`**: Triggered when a task finishes execution. Use for pipeline coordination — chain tasks, aggregate results, or trigger follow-up work automatically.

These complement Task tool metrics (2.1.30+) for data-driven orchestration. Example use case: a `TaskCompleted` hook that logs efficiency metrics and triggers the next pipeline stage.

### Sub-Agent Spawning Restrictions (Claude Code 2.1.33+)

Agent `tools` frontmatter now supports `Task(agent_type)` syntax to restrict which sub-agents can be spawned:

```yaml
# Agent can only spawn these specific sub-agents
tools:
  - Read
  - Bash
  - Grep
  - Task(code-reviewer)
  - Task(test-runner)
```

**Benefits**:
- Prevents uncontrolled delegation chains and scope creep
- Enforces pipeline discipline in multi-stage workflows
- Improves security by limiting agent capabilities

**Recommendation**: Add `Task(agent_type)` restrictions to pipeline agents (e.g., `sanctum/workflow-improvement-*`) and orchestrator agents that should only delegate to specific workers. Agents without `Task` in their tools list cannot spawn sub-agents at all — this is already the case for most ecosystem agents.

#### Background Agent Crash Fix (2.1.45+, improved in 2.1.47)

Backgrounded agents (`run_in_background: true`) no longer crash with a ReferenceError on completion. This improves reliability for all parallel dispatch patterns.

- **Before**: Background agents could silently crash, requiring retry logic or manual checking
- **After**: Background agent completion is handled cleanly with proper result delivery
- **2.1.47**: Background agents now return the **final answer directly** instead of raw transcript data (#26012). Previously, collecting results from background agents required parsing through transcript artifacts to extract the actual answer — this workaround is no longer needed. The `collect_results()` pattern in the coordination examples below now receives clean, usable output.

#### Subagent Skill Compaction Fix (2.1.45+)

Skills invoked by subagents no longer leak into the main session's context after compaction.

- **Before**: If a subagent invoked a skill, the skill content could appear in the main session after compaction, consuming context tokens and potentially causing confusion
- **After**: Subagent skill invocations are properly scoped — they stay within the subagent's context and are discarded when the subagent completes
- **Impact**: Long-running sessions with many subagent dispatches will maintain cleaner context

## Best Practices

1. **Minimize handoff context**: Pass only essential information
2. **Define clear boundaries**: Each subagent has specific scope
3. **Plan for failures**: Handle subagent errors gracefully
4. **Summarize aggressively**: Keep only key results
5. **Parallelize when possible**: Use concurrent execution for speed

## Integration

- **Principles**: Follows MECW limits from `mecw-principles`
- **Assessment**: Triggered by risk detection in `mecw-assessment`
- **MCP**: Works with `mcp-code-execution` for code-heavy tasks
