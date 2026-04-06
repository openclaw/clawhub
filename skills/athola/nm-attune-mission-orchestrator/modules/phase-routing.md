---
name: phase-routing
description: Phase execution protocol, transition hooks, user checkpoints, and error handling via damage-control
parent_skill: attune:mission-orchestrator
category: workflow-orchestration
estimated_tokens: 250
---

# Phase Routing

## Phase Execution Protocol

For each phase in the mission type's sequence, the orchestrator follows this protocol:

```
Phase: {phase_name}
  |
  1. Pre-Phase Validation
  |   Check prerequisites (prior phase artifacts exist and are valid)
  |   If invalid: STOP, report missing prerequisites
  |
  2. Invoke Skill
  |   Call Skill(attune:{phase-skill})
  |   The skill handles its own workflow entirely
  |
  3. Post-Phase Artifact Check
  |   Verify the expected output artifact was created
  |   If missing: Phase failed, enter error handling
  |
  4. Update Mission State
  |   Record phase completion in .attune/mission-state.json
  |   Include timestamps, artifact paths, any warnings
  |
  5. User Checkpoint (skippable with --auto)
  |   Present phase results and ask to proceed
  |   User can: continue, pause, abort, or re-run phase
  |
  6. Error Handling
      If phase failed: invoke leyline:damage-control
      Determine recovery action (retry, skip, escalate)
```

## Skill Invocation Table

| Phase | Skill Call | Expected Output |
|-------|-----------|-----------------|
| brainstorm | `Skill(attune:project-brainstorming)` | `docs/project-brief.md` |
| specify | `Skill(attune:project-specification)` | `docs/specification.md` |
| plan | `Skill(attune:project-planning)` | `docs/implementation-plan.md` |
| execute | `Skill(attune:project-execution)` | Code changes + `.attune/execution-state.json` |

## Pre-Phase Validation

Each phase has prerequisites that must be satisfied:

| Phase | Prerequisites |
|-------|--------------|
| brainstorm | None (starting point) |
| specify | `docs/project-brief.md` exists and is valid |
| plan | `docs/specification.md` exists and is valid |
| execute | `docs/implementation-plan.md` exists and is valid |

If a prerequisite is missing but a prior phase should have produced it, the orchestrator reports the gap rather than silently skipping.

## Transition Hooks

Between phases, the orchestrator performs lightweight transitions:

### brainstorm → specify

- Verify project brief is actionable (has goals and constraints)
- Pass brief path to specification skill
- **Backlog triage**: Scan spec/brief for "Out of Scope"
  section. Create a GitHub issue for each deferred item.
  See below.

### specify → plan

- Verify specification has testable requirements
- Check if war-room review was completed (recommended for RED+ projects)
- **Backlog triage**: If the specification skill did not
  already create issues (check for issue numbers in the
  Out of Scope section), create them now.

### plan → execute

- Verify plan has concrete tasks with file paths
- Classify tasks by risk tier (invoke `leyline:risk-classification`)
- Generate risk summary for the mission state

## Post-Phase Backlog Triage

After the **brainstorm** and **specify** phases, scan
the produced artifact for an "Out of Scope" section and
create GitHub issues for each deferred item.

**When to run**: After brainstorm and specify phases.
Skip after plan and execute (no new scope decisions).

**Algorithm**:
1. Read the phase artifact (brief or spec)
2. Find the "Out of Scope" heading
3. Extract each bullet point as a deferred item
4. For each item, check if it already has an issue
   reference (e.g., `(#123)`)
5. For items without references, create a GitHub issue:
   ```bash
   gh issue create \
     --title "[Backlog] <project>: <item summary>" \
     --body "## Context
   Identified during <phase> phase.
   Artifact: <artifact-path>

   ## Description
   <full item text from spec>" \
     --label "feature,low-priority"
   ```
6. Update the artifact's Out of Scope section with
   issue references: `- Item description (#NNN)`
7. Report created issues at the user checkpoint

**Skip conditions**:
- `--no-auto-issues` flag
- Item already has an issue reference
- Fewer than 1 item in Out of Scope section

## User Checkpoints

After each phase, the orchestrator presents a checkpoint:

```
Phase Complete: specify
  Output: docs/specification.md (2,450 words, 8 user stories)
  Duration: 15 minutes
  Status: Success

  Next phase: plan
  [C]ontinue | [P]ause | [A]bort | [R]e-run phase
```

### Checkpoint Behavior

| Choice | Action |
|--------|--------|
| Continue | Proceed to next phase |
| Pause | Save state, exit (resume with `--resume`) |
| Abort | Save state, mark mission as aborted |
| Re-run | Delete phase output, re-invoke the skill |

### Auto Mode

With `--auto` flag, checkpoints are skipped and phases proceed automatically. The orchestrator logs checkpoint data but does not pause.

## Error Handling

When a phase fails (skill errors, artifact not produced, validation failure):

1. **Classify error**: Map to `leyline:damage-control` categories
   - Timeout/context overflow → `context-overflow` module
   - Skill crash → `agent-crash-recovery` module
   - Partial output → `partial-failure-handling` module

2. **Attempt recovery**:
   - TRANSIENT: Retry phase (max 2 attempts)
   - PERMANENT: Present error to user with options
   - CRASH: Clear context, retry with fresh state

3. **Update mission state**: Record error, recovery attempt, and outcome

4. **User decision**: If recovery fails, present options:
   - Retry phase manually
   - Skip phase and continue (if safe)
   - Abort mission
