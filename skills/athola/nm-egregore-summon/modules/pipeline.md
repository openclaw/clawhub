---
name: pipeline
description: Pipeline stage and step definitions with transition rules
category: orchestration
---

# Pipeline Module

Defines the four stages of the egregore pipeline, their
steps, transition rules, and idempotency guarantees.

## Stages and Steps

The pipeline has four stages, executed in fixed order.
Each stage contains ordered steps that run sequentially.

### 1. Intake

Parse the input, validate it, and prioritize across
multiple items.

| Step | Purpose |
|------|---------|
| parse | Extract requirements from prompt text or GitHub issue |
| validate | Confirm requirements are specific enough to act on |
| prioritize | Order items by complexity (single item = skip this step) |

### 2. Build

Transform requirements into working code through the
attune project lifecycle.

| Step | Purpose |
|------|---------|
| brainstorm | Explore approaches and constraints |
| specify | Produce a formal specification document |
| blueprint | Create an implementation plan with task breakdown |
| execute | Implement the plan, writing code and tests |

### 3. Quality

Review, refine, and verify the implementation.

| Step | Purpose |
|------|---------|
| code-review | First-pass review for correctness and style |
| unbloat | Detect and remove unnecessary code or files |
| code-refinement | Apply review feedback and polish |
| update-tests | Add or fix tests to match implementation |
| update-docs | Update documentation to reflect changes |

### 4. Ship

Prepare, review, and merge the pull request.

| Step | Purpose |
|------|---------|
| prepare-pr | Create the PR with title, body, and labels |
| pr-review | Run automated PR review checks |
| fix-pr | Apply fixes from the PR review |
| merge | Merge the PR (requires `auto_merge: true` in config) |

## Parallel Execution (Quality Stage)

Within the quality stage, some steps are independent and can
run concurrently. The `stage_parallel` module groups steps
into waves based on a dependency graph.

### Dependency Graph

```
code-review  ──┐
               ├──>  code-refinement
               └──>  update-tests
unbloat       (independent)
update-docs   (independent)
```

### Wave Execution

`plan_stage_execution("quality", steps)` produces waves:

- **Wave 1** (parallel): `code-review`, `unbloat`,
  `update-docs` -- no interdependencies.
- **Wave 2** (parallel): `code-refinement`, `update-tests`
  -- both depend on `code-review` completing first.

All steps in a wave can be dispatched simultaneously via
`build_parallel_dispatch(wave, item_id)`. The orchestrator
waits for every step in wave N to finish before starting
wave N+1.

### Failure Handling

`WaveResult` tracks per-step pass/fail outcomes within a
wave. If any step in a wave fails, the orchestrator can
inspect `wave_result.failed_steps` and decide whether to
retry individual steps or fail the entire stage.

### Extending the Graph

To add a new quality step:

1. Add the step name to `PIPELINE["quality"]` in
   `manifest.py`.
2. Add an entry in `STEP_DEPENDENCIES` in
   `stage_parallel.py` with its dependency list (empty
   list if independent).
3. The planner will automatically place it in the correct
   wave.

## Transition Rules

A work item advances through the pipeline via
`manifest.advance(item_id)`.
The transition logic follows these rules:

1. **Within a stage**: move to the next step in the list.
   Reset `attempts` to 0.
2. **Across stages**: when the last step of a stage
   completes, move to the first step of the next stage.
   Reset `attempts` to 0.
3. **Pipeline complete**: when the last step of the last
   stage (ship/merge) completes, set `item.status` to
   `"completed"`.
4. **No backward movement**: the pipeline only moves
   forward. If a step needs rework, it retries in place
   up to `max_attempts`.

## Step Skipping

Certain steps can be skipped based on configuration or
context:

- **brainstorm**: skipped when `config.pipeline
  .skip_brainstorm_for_issues` is `true` and the source is
  a GitHub issue (the issue body serves as the brainstorm
  output).
- **prioritize**: skipped when there is only one work item.
- **merge**: skipped when `config.pipeline.auto_merge` is
  `false`. The PR remains open for human review.

When a step is skipped, `advance()` is called immediately
without invoking any skill.

## Idempotency Guarantees

Every step must be safe to retry without side effects.
The pipeline enforces idempotency through these mechanisms:

1. **State on disk**: the manifest is saved after every
   transition. If the process crashes mid-step, the same
   step will be retried on relaunch.
2. **Branch isolation**: each work item operates on its own
   git branch (`egregore/wrk-NNN-slug`). Partial work from
   a failed attempt remains on the branch and is visible
   to the retry.
3. **Attempt counter**: `item.attempts` tracks how many
   times the current step has been tried. Skills can read
   this value to adjust behavior on retries (e.g., using a
   simpler approach on attempt 2).
4. **No destructive resets**: retrying a step never reverts
   work from previous steps. The retry operates on whatever
   state the branch is in.
5. **PR deduplication**: the prepare-pr step checks for an
   existing open PR on the work item branch before creating
   a new one. If a PR exists, it updates the existing PR
   instead.

## Parallel Execution

When multiple active work items are independent (no shared
files or dependencies), the orchestrator can process them
concurrently using git worktrees.
The `parallel` module (`scripts/parallel.py`) provides the
detection, dispatch, and merge primitives.

### Independence Detection

`detect_independent_items()` groups active work items by
their `source_ref` values.
Items with different source refs are assumed independent
and placed in the same parallel group.
Items sharing a source ref are kept in separate groups so
they execute sequentially.

### Worktree Lifecycle

Each parallel work item gets its own git worktree via
`WorktreeAssignment`.
The assignment tracks the item ID, worktree filesystem
path, branch name, and a status that progresses through:
`pending`, `active`, `completed`, `failed`, `merged`.

The manifest's `max_concurrent_worktrees` field (default 3)
controls how many worktrees run at once.
`build_agent_dispatch()` splits item IDs into batches that
respect this limit.

### Merge Strategy

After a worktree completes its pipeline,
`merge_worktree_result()` generates the git commands to
merge the feature branch back into the target branch using
`--no-ff` for a clear merge commit.
If the merge encounters conflicts, the conflict strategy
marks the work item as failed so the orchestrator can
handle it.
