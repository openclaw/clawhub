---
name: summon
description: |
  Autonomous orchestrator processing manifest work items through the development lifecycle with budget tracking
version: 1.8.1
triggers:
  - autonomous
  - pipeline
  - orchestrator
  - mission
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/egregore", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.attune:project-brainstorming", "night-market.attune:project-specification", "night-market.attune:project-planning", "night-market.attune:project-execution", "night-market.pensive:code-refinement", "night-market.conserve:bloat-detector", "night-market.sanctum:pr-prep", "night-market.sanctum:pr-review", "night-market.sanctum:commit-messages", "night-market.conserve:clear-context"]}}}
source: claude-night-market
source_plugin: egregore
---

> **Night Market Skill** — ported from [claude-night-market/egregore](https://github.com/athola/claude-night-market/tree/master/plugins/egregore). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When To Use](#when-to-use)
- [When NOT To Use](#when-not-to-use)
- [Orchestration Loop](#orchestration-loop)
- [Pipeline-to-Skill Mapping](#pipeline-to-skill-mapping)
- [Context Overflow Protocol](#context-overflow-protocol)
- [Token Budget Protocol](#token-budget-protocol)
- [Failure Handling](#failure-handling)
- [Module Reference](#module-reference)

# Summon

## Overview

Summon is the egregore orchestration loop.
It reads the manifest (`.egregore/manifest.json`), selects
the next active work item, maps the current pipeline step to
a specialist skill, and invokes that skill.
After each step it advances the pipeline, checks context and
token budgets, and repeats until all items are completed or
the budget is exhausted.

The orchestrator never re-implements phase logic.
Each pipeline step delegates to an existing skill via
`Skill()` calls.
Summon only manages state transitions, retries, and budget
guards.

## When To Use

- Processing one or more work items through the full
  intake-build-quality-ship pipeline.
- Resuming an interrupted egregore session (manifest already
  exists with active items).
- Running autonomously under a watchdog that relaunches on
  exit.

## When NOT To Use

- Running a single skill in isolation (call the skill
  directly instead).
- Exploratory work where the pipeline does not apply.
- When human review is needed before every step (use manual
  skill invocations).

## Launching the Orchestrator

**Always launch the orchestrator agent in the FOREGROUND.**
Do not use `run_in_background: true`. The main session
becomes the egregore -- it blocks on the orchestrator agent
until the egregore finishes or is dismissed.

```
Agent(
  subagent_type: "egregore:orchestrator",
  prompt: "<context about work items and current state>",
  run_in_background: false   // Required
)
```

If you launch the orchestrator in the background, the main
session will have nothing to do and will stop. This defeats
the entire purpose of the egregore. The stop hook cannot
prevent this because background agents are detached.

## Manifest Mode

Before launching the orchestrator, ensure the manifest has
the correct run mode:

- **Default (no `--bounded` flag)**: set `"indefinite": true`
  in the manifest. The egregore will scan for new work after
  completing all items and run until dismissed.
- **With `--bounded` flag**: set `"mode": "bounded"` in the
  manifest. The egregore stops after all items are completed
  or failed.

If the manifest already exists and has `"mode": "bounded"`
but the user did NOT pass `--bounded`, update the manifest
to `"indefinite": true` before launching.

After launching, do NOT produce any summary, status table,
or "what's happening" output. The orchestrator IS the
session now. Let it run.

## Orchestration Loop

Follow these steps exactly.
Each iteration processes one pipeline step for one work item.

### 1. Load state

```
manifest  = Read(".egregore/manifest.json")
config    = Read(".egregore/config.json")
budget    = Read(".egregore/budget.json")
```

If `manifest.json` does not exist, stop with an error:
"No manifest found. Run `egregore init` first."

### 2. Pick the next work item

```
item = manifest.next_active_item()
```

If `item` is `None`, all work is done.
Save the manifest, report completion, and exit.

### 3. Map current step to a skill

Look up `item.pipeline_stage` and `item.pipeline_step` in the
Pipeline-to-Skill Mapping table below.
Determine the skill name or action to invoke.

### 4. Invoke the skill

Call `Skill()` or execute the mapped action.
Pass any required context (branch name, issue ref, etc.)
from the work item.

### 5. Handle the result

**On success:**

- Call `manifest.advance(item.id)` to move to the next step.
- Reset `item.attempts` to 0.
- Save the manifest.

**On failure:**

- Call `manifest.fail_current_step(item.id, reason)`.
- If `item.attempts < item.max_attempts`, retry the same
  step on the next iteration.
- If `item.status` is now `"failed"`, log the failure and
  move to the next work item.
- Save the manifest.

### 6. Check context budget

Estimate context window usage.
If usage exceeds 80%:

1. Save the manifest to disk.
2. Write a continuation note to
   `.egregore/continuation.json` with the current item ID,
   stage, and step.
3. Invoke `Skill(conserve:clear-context)`.
4. The watchdog or caller will relaunch a fresh session that
   resumes from the saved state.

### 7. Check token budget

If the last skill call returned a rate limit error:

1. Record the rate limit in `budget.json` via
   `budget.record_rate_limit(cooldown_minutes)`.
2. Save `budget.json`.
3. Alert the overseer (see `notify.py`).
4. **Schedule in-session recovery** (2.1.71+): use
   `CronCreate` to schedule a one-shot resume prompt at
   the cooldown expiry time. The session stays alive and
   resumes automatically with context preserved.
5. **Fallback** (pre-2.1.71 or cooldown > 7 days): exit
   gracefully. The watchdog checks cooldown before
   relaunching.

### 8. Repeat

Go back to step 2.
Continue until all items are completed, all items are failed,
or a budget limit is reached.

## Pipeline-to-Skill Mapping

| Stage | Step | Skill/Action |
|-------|------|--------------|
| intake | parse | Parse prompt or fetch issue via `gh issue view` |
| intake | validate | Validate requirements are actionable |
| intake | prioritize | Order by complexity (single item = skip) |
| build | brainstorm | `Skill(attune:project-brainstorming)` |
| build | specify | `Skill(attune:project-specification)` |
| build | blueprint | `Skill(attune:project-planning)` |
| build | execute | `Skill(attune:project-execution)` |
| quality | code-review | `Skill(pensive:code-refinement)` |
| quality | unbloat | `Skill(conserve:bloat-detector)` |
| quality | code-refinement | `Skill(pensive:code-refinement)` |
| quality | update-tests | `Skill(sanctum:test-updates)` |
| quality | update-docs | `Skill(sanctum:doc-updates)` |
| ship | prepare-pr | `Skill(sanctum:pr-prep)` |
| ship | pr-review | `Skill(sanctum:pr-review)` |
| ship | fix-pr | Apply review fixes |
| ship | merge | `gh pr merge` (if auto_merge enabled) |

The intake stage steps (parse, validate, prioritize) are
handled inline by the orchestrator.
See `modules/intake.md` for details.

## Context Overflow Protocol

The orchestrator runs inside a finite context window.
To avoid losing state when the window fills:

1. **Monitor usage.** After each skill invocation, estimate
   how much of the context window has been consumed.
2. **At 80% capacity**, trigger a context save:
   - Persist the full manifest to disk.
   - Write `.egregore/continuation.json` with a snapshot of
     the current position.
   - Invoke `Skill(conserve:clear-context)`.
3. **On relaunch**, load `continuation.json` and resume from
   the saved position. The manifest on disk is the source of
   truth for pipeline progress.
4. **Increment** `manifest.continuation_count` each time a
   context-overflow handoff occurs.

This protocol ensures zero lost progress across context
boundaries.

## Progress Monitoring & Self-Healing (2.1.71+)

After loading state (step 1), schedule a recurring heartbeat
that both reports status and recovers stalled pipelines:

```
CronCreate(
  cron: "*/5 * * * *",
  prompt: "Check .egregore/manifest.json. If there are pending or active items that are not being processed, resume the orchestration loop by invoking Skill(egregore:summon). Otherwise, report status via /egregore:status.",
  recurring: true
)
```

This serves two purposes:

1. **Visibility**: emits a status summary every 5 minutes
   so autonomous runs are observable.
2. **Self-healing**: if a user prompt, context compaction,
   or unexpected error breaks the orchestration loop, the
   next heartbeat detects stalled items and re-enters the
   pipeline automatically.

The cron task auto-expires after 7 days by default. Use
`durable: true` to persist across restarts, or
`CronDelete` to cancel early.

## Token Budget Protocol

Egregore sessions consume API tokens across a budget window
(default: 5 hours).
The budget protocol prevents runaway spending:

1. **Before each skill call**, check `budget.json` for an
   active cooldown. If `is_in_cooldown(budget)` returns
   true, exit and let the watchdog retry later.
2. **On rate limit error**, record the event via
   `budget.record_rate_limit(cooldown_minutes)`.
   The cooldown duration equals the API retry-after header
   plus `config.budget.cooldown_padding_minutes`.
3. **Save and exit.** Write `budget.json`, alert the
   overseer, and exit with code 0.
4. **The watchdog** checks `budget.json` before relaunching.
   It will not start a new session until the cooldown
   expires.

See `modules/budget.md` for the full calculation and state
schema.

## Failure Handling

Each work item allows up to `max_attempts` retries per step
(default: 3, configurable in `config.json`).

- **Retry**: If a step fails and `attempts < max_attempts`,
  the orchestrator retries the same step on the next
  iteration. The manifest is saved between retries.
- **Mark failed**: If `attempts >= max_attempts`, the item
  status changes to `"failed"` and `failure_reason` is set.
  The orchestrator moves to the next active item.
- **Alert**: On failure, notify the overseer via the
  configured notification channel.
- **Never block**: The orchestrator must never wait for human
  input. If a step requires clarification, record a decision
  (see `modules/decisions.md`) and proceed with the best
  available option.

## Module Reference

- **pipeline.md**: Stage and step definitions, transition
  rules, idempotency guarantees.
- **budget.md**: Token window management, rate limit
  detection, cooldown calculation, graceful shutdown.
- **intake.md**: Work item parsing for prompts and GitHub
  issues, brainstorm skip logic.
- **decisions.md**: Autonomous decision-making framework,
  decision log format, examples.
