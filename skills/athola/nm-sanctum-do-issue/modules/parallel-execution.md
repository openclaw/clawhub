# Phase 3: Parallel Execution

Dispatch subagents for independent tasks concurrently.

## Important: Plan Before Large Dispatch

**When dispatching 4+ agents**, enter plan mode first:

| Agent Count | Requirement |
|-------------|-------------|
| 1-3 agents | Dispatch directly (standard parallel) |
| 4+ agents | **Enter plan mode, write strategy, get user approval, execute** |

### Why This Threshold Exists

Large agent dispatches (4+ agents) create:
- **Observability loss**: Too many concurrent outputs to track
- **Context overflow**: Research agents produce large results, triggering continuation agents that lose state
- **Recovery difficulty**: If 2 of 7 agents fail, there's no plan to resume from
- **Wasted compute**: Without user alignment, agents may research the wrong things

### Plan-Before-Dispatch Checklist

Before launching 4+ agents, your plan should specify:

1. **Agent roster**: Name, type (`general-purpose`/`Explore`/specialized), and model (`sonnet`/`haiku`/`opus`) for each
2. **Scope per agent**: Exactly what each agent investigates (files, topics, questions)
3. **Output contract**: What each agent should return (format, length, key questions to answer)
4. **Result integration**: How you'll combine agent outputs into a coherent response
5. **Failure strategy**: What happens if an agent hits context limits or returns incomplete results

### Example Plan Structure

```markdown
## Agent Dispatch Plan: [Goal]

### Agents (N total)

| # | Agent Type | Model | Scope | Output Contract |
|---|-----------|-------|-------|-----------------|
| 1 | Explore | haiku | Search plugins/ for X | File paths + summaries |
| 2 | general-purpose | sonnet | Research Y via web | Key findings, 500 words max |
| 3 | general-purpose | sonnet | Analyze Z files | Structured assessment |

### Integration Strategy
[How results combine into final answer]

### Failure Handling
- Agent timeout/overflow: [strategy]
- Incomplete results: [strategy]
```

### Enforcement

This rule applies to ALL multi-agent dispatches, including:
- Research/audit missions (web + codebase analysis)
- Large refactoring across many files
- Comprehensive review tasks
- Any task requiring continuation agents

## WARNING: Remote Control / Headless Limitations

**Avoid running parallel subagent dispatches via
`/remote-control` or headless SDK sessions.**

The Task tool blocks the main thread while awaiting
subagent completion. If any subagent hangs (a known
upstream bug), the parent session becomes unrecoverable
because remote-control has no programmatic equivalent
of the `Esc` interrupt.

**Safe alternatives for remote-control use:**
- Use `run_in_background: true` on Agent calls
- Run with `--scope minor` (inline execution, no
  subagent dispatch)
- Use a local terminal with remote-control as a
  monitoring-only window

See [troubleshooting.md](troubleshooting.md) for recovery
steps if a subagent hangs.

## Execute Nonconflicting Tasks in Parallel

**When you have multiple nonconflicting tasks, invoke all Task tools in a single response.**

Parallel execution is the default for nonconflicting tasks.

## Identify Nonconflicting Tasks

Tasks can run in parallel only when all conditions are met:

✅ **Safe for parallel execution:**
- Tasks modify **different files** (no overlap)
- Tasks have **no shared state** (independent data)
- Tasks don't modify **same code paths** (no merge conflicts)
- Tasks have **satisfied dependencies** (no blocking)
- Tasks don't depend on **each other's outputs**

❌ **Not safe for parallel execution:**
- Tasks modify the **same file** or related files
- Tasks share **configuration** or **global state**
- Tasks have **sequential dependencies**
- Tasks touch **overlapping code paths** that could conflict
- Tasks need results from **each other**
- Both tasks are `[R:RED]` (compounding risk prohibited)
- Either task is `[R:CRITICAL]` (always executes solo)

## Analyze Task Conflicts BEFORE Dispatching

**Required**: Perform conflict analysis before parallel execution:

```markdown
Analyzing tasks for parallel execution:

Task 1 (Issue #42): Create auth middleware in src/auth/middleware.py
Task 2 (Issue #43): Fix validation bug in src/validators/schema.py
Task 3 (Issue #44): Add logging to src/utils/logger.py

Conflict Check:
- Files: ✅ No overlap (middleware.py, schema.py, logger.py are different)
- Dependencies: ✅ No sequential dependencies between tasks
- State: ✅ No shared configuration or database schema
- Code paths: ✅ Independent modules, no import conflicts

Decision: Execute Tasks 1, 2, 3 in PARALLEL (3 Task tool invocations in single response)
```

**COUNTER-EXAMPLE** - Sequential execution required:

```markdown
Task A (Issue #50): Refactor User model in models/user.py
Task B (Issue #51): Add authentication using User model

Conflict Check:
- Files: ❌ Task B depends on Task A's User model changes
- Dependencies: ❌ Task B needs Task A's output
- Code paths: ❌ Both touch authentication flow

Decision: Execute SEQUENTIALLY (Task A first, then Task B)
```

## Risk-Tier Parallel Safety

When tasks have `[R:TIER]` markers (from `leyline:risk-classification`), apply these additional constraints:

| Task A Tier | Task B Tier | Parallel? | Reason |
|-------------|-------------|-----------|--------|
| GREEN | Any | Yes | Low risk, independent |
| YELLOW | YELLOW | Yes | Standard caution |
| YELLOW | RED | Yes | With conflict monitoring |
| RED | RED | **No** | Compounding risk too high |
| Any | CRITICAL | **No** | CRITICAL always solo |

Tasks without `[R:TIER]` markers are treated as GREEN (backward compatible).

## Dispatch Parallel Subagents

**All subagents commit to the SAME branch.** The parent
creates one shared branch before dispatch (Step 4.1) and
all work lands there. Do not create per-issue branches.
This produces one PR at completion.

**CORRECT PATTERN** - Multiple Task tool invocations in ONE response:

```text
I'll execute these 3 nonconflicting tasks in parallel:

Task(description: "Issue #42 - Create auth middleware")
Task(description: "Issue #43 - Fix validation bug")
Task(description: "Issue #44 - Add logging feature")

Each task will:
1. Work on the current branch (fix/issues-42-43-44)
2. Implement in its designated file (no conflicts)
3. Follow TDD - write failing test first
4. Verify no regressions
5. Commit with conventional format
```

**WRONG PATTERN** - Sequential invocations:

```text
❌ Task(description: "Issue #42")
   [wait for result]
   Task(description: "Issue #43")
   [wait for result]

This wastes time when tasks are nonconflicting!
```

## Await Parallel Results

Collect results from all parallel subagents before proceeding:

```
Parallel Batch 1: Issues #42, #43, #44 (3 tasks)
  [3 subagents running in parallel...]

  ✅ #42: Complete (auth middleware in src/auth/middleware.py)
  ✅ #43: Complete (validation fix in src/validators/schema.py)
  ✅ #44: Complete (logging in src/utils/logger.py)

All tasks completed without conflicts.
```

## Key Principles

| Principle | Description |
|-----------|-------------|
| **One Branch** | All subagents commit to the shared branch (one PR at the end) |
| **Fresh Context** | Each subagent starts clean, avoiding context pollution |
| **TDD by Default** | Subagents write failing tests first |
| **Conventional Commits** | Each task commits with proper format |
| **Isolation** | Tasks don't share state between subagents |

## Agent Teams (Default Execution Backend)

Agent teams is the **default** for parallel execution in do-issue. Teammates coordinate via filesystem-based messaging, which prevents merge conflicts and duplicate work that Task tool batches would only catch at the review gate.

Use `--no-agent-teams` to fall back to Task tool dispatch when coordination overhead isn't justified.

### Automatic Downgrade

Agent teams is skipped (Task tool or inline used instead) when:
- Single issue with `--scope minor` (no parallelism needed)
- tmux is not installed or `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is unset
- `--no-agent-teams` flag is explicitly passed

### When Task Tool Is Better

| Scenario | Recommendation |
|----------|---------------|
| Single issue, minor scope | Inline execution (no dispatch at all) |
| 2-3 fully independent issues, no shared files | Task tool is simpler, `--no-agent-teams` |
| 3+ issues with shared files or dependencies | Agent teams (default) |
| 5+ issues, complex dependency graph | Agent teams (default) |

### Agent Teams Execution Pattern

```text
Lead agent creates team: do-issue-{timestamp}
  Spawns: worker-1 (Sonnet), worker-2 (Sonnet), worker-3 (Sonnet)

Lead assigns tasks via inbox:
  worker-1: "Implement #42 (auth middleware) in src/auth/"
  worker-2: "Fix #43 (validation bug) in src/validators/"
  worker-3: "Add #44 (logging) in src/utils/"

Mid-execution coordination:
  worker-1 → worker-3: "I added auth logging to src/auth/log.py —
    don't duplicate in your logging task"
  worker-3 → worker-1: "Acknowledged, will import from your module"

Lead collects completion messages, runs quality gates, shuts down team.
```

### Key Difference from Task Tool

Task tool subagents are **fire-and-forget** — they can't communicate mid-execution. Agent teams teammates can **send messages to each other** when they discover shared concerns. This prevents merge conflicts and duplicate work that Task tool batches would catch only at the review gate.

### Fallback

If tmux is unavailable or `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is not set, `--agent-teams` silently falls back to standard Task tool dispatch.

## Worktree Isolation for Parallel Safety (Claude Code 2.1.49+)

Subagents with `isolation: "worktree"` run in a temporary
git worktree, providing filesystem-level isolation.

### When to Use Worktree Isolation

| Scenario | Use Worktree? | Reason |
|----------|--------------|--------|
| Agents touch different files | No | No conflict possible |
| Agents touch overlapping files | **Yes** | Prevents race conditions |
| Agent does destructive ops (delete + recreate) | **Yes** | Failed agent won't corrupt main |
| Research/read-only agents | No | No writes to conflict |

### Worktree Behavior

- Agents with worktree isolation get a separate checkout
- Empty worktrees are auto-cleaned; worktrees with
  changes return `worktreePath` and `worktreeBranch`
- If `worktreePath` is NOT in the agent result, changes
  either landed in the main workdir or were lost

### Post-Dispatch Verification (MANDATORY)

After ALL parallel agents complete, verify before
proceeding:

```markdown
## Post-Dispatch Checklist

1. [ ] Check `git worktree list` for remaining worktrees
2. [ ] Check `git diff --stat` in main workdir for changes
3. [ ] For each agent with worktree output:
   - Verify worktree changes via `git diff` in worktree
   - Merge or cherry-pick into main branch
   - Remove worktree: `git worktree remove <path>`
4. [ ] For agents that deleted + recreated files:
   - Verify new files exist: `ls <expected-paths>`
   - Verify imports work: `python -c "from X import Y"`
   - If directory exists but is empty, restore original:
     `git checkout HEAD -- <original-path>`
5. [ ] Run affected tests before committing
```

### Never Mix Worktree and Direct Agents on Same Files

When agents A (worktree) and B (direct) both modify
`foo.py`, only one set of changes survives. Either:

- Use worktree isolation for ALL agents in the batch, or
- Use direct (no isolation) for ALL agents in the batch

Mixing isolation modes on overlapping files causes
silent data loss.

### Agent Path Confusion

Agents in worktrees or with `cd` in their prompts can
write files to wrong paths. Common failure modes:

- Creates `./foo/` instead of `./plugins/bar/foo/`
- Deletes original but new directory is empty (agent
  hit context limit mid-operation)

Mitigation: include absolute paths in agent prompts
and verify file existence after completion.

## Next Phase

After parallel execution completes, proceed to [quality-gates.md](quality-gates.md) for batch review.
