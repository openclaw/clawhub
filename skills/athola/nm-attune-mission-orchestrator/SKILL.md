---
name: mission-orchestrator
description: |
  Lifecycle orchestrator that auto-detects project state and routes to the correct development phase
version: 1.8.1
triggers:
  - mission
  - orchestrator
  - lifecycle
  - full-cycle
  - automation
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/attune", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.attune:project-brainstorming", "night-market.attune:project-specification", "night-market.attune:project-planning", "night-market.attune:project-execution", "night-market.attune:war-room-checkpoint", "night-market.leyline:risk-classification", "night-market.leyline:damage-control"]}}}
source: claude-night-market
source_plugin: attune
---

> **Night Market Skill** — ported from [claude-night-market/attune](https://github.com/athola/claude-night-market/tree/master/plugins/attune). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Mission Lifecycle](#mission-lifecycle)
- [Mission Types](#mission-types)
- [Phase-to-Skill Mapping](#phase-to-skill-mapping)
- [Session Recovery](#session-recovery)
- [Module Reference](#module-reference)
- [Related Skills](#related-skills)
- [Related Commands](#related-commands)
- [Exit Criteria](#exit-criteria)


# Mission Orchestrator

## Overview

Wraps the entire attune development lifecycle (brainstorm → specify → plan → execute) into a single mission with automatic state detection, type selection, and phase routing. Follows the "persistent presence lens" pattern from `spec-kit:speckit-orchestrator` — delegates entirely to existing skills via `Skill()` calls, never re-implements phase logic.

## When To Use

- Starting a new project from scratch (full lifecycle)
- Resuming an interrupted project workflow
- Running a focused tactical implementation from existing specs
- Quick-fixing from an existing implementation plan

## When NOT To Use

- Running a single phase directly (use `/attune:brainstorm`, `/attune:specify`, etc.)
- Non-project work (code review, debugging, research)
- When you need fine-grained control over phase transitions

## Mission Lifecycle

```
1. State Detection
   Scan for existing artifacts (project-brief.md, specification.md, etc.)
       |
2. Mission Type Selection
   Auto-detect type based on artifacts, or accept user override
       |
3. Phase Routing Loop
   For each phase in the mission type:
       a. Pre-phase validation (check prerequisites)
       b. Invoke Skill(attune:{phase-skill})
       c. Post-phase artifact check (verify output exists)
       d. Post-phase backlog triage (create GitHub issues
          for out-of-scope items after brainstorm/specify)
       e. Update mission state
       f. User checkpoint (skippable with --auto)
       g. Error handling via leyline:damage-control
       |
4. Completion
   All phases complete, final state saved
```

## Mission Types

| Type | Phases | Auto-detected When |
|------|--------|--------------------|
| `full` | brainstorm → specify → plan → execute | No artifacts exist |
| `standard` | specify → plan → execute | `docs/project-brief.md` exists |
| `tactical` | plan → execute | `docs/specification.md` exists |
| `quickfix` | execute | `docs/implementation-plan.md` exists |

See `modules/mission-types.md` for full type definitions and custom type support.

## Phase-to-Skill Mapping

| Phase | Skill Invoked | Artifact Produced |
|-------|--------------|-------------------|
| brainstorm | `Skill(attune:project-brainstorming)` | `docs/project-brief.md` |
| specify | `Skill(attune:project-specification)` | `docs/specification.md` |
| plan | `Skill(attune:project-planning)` | `docs/implementation-plan.md` |
| execute | `Skill(attune:project-execution)` | Implemented code + tests |

The orchestrator **never** re-implements phase logic. Each phase is a complete `Skill()` invocation that handles its own workflow.

## Session Recovery

Missions persist state to `.attune/mission-state.json`. On resume:

1. Load mission state file
2. Validate referenced artifacts still exist on disk
3. Identify last completed phase
4. Continue from next phase in sequence

See `modules/mission-state.md` for the state schema and recovery protocol.

## Mission Charter

Define mission boundaries using the structured template from
`references/mission-charter.md`. A Mission Charter specifies:

- **Outcome**: What success looks like
- **Success metric**: Measurable completion criteria
- **Deadline**: Time boundary (session, date, or duration)
- **Constraints**: Token/time budgets, forbidden actions
- **Scope**: In-scope and out-of-scope areas
- **Stop criteria**: Conditions that halt the mission

See `references/mission-charter.md` for the full template and
examples.

## Progress Reports

Track progress with structured checkpoints using
`references/progress-report.md`. Generate reports at:

- Phase boundaries (between brainstorm→specify→plan→execute)
- Blocker identification
- Risk escalation
- Budget thresholds (50%, 75%, 90%)

See `references/progress-report.md` for the template and
checkpoint rhythm guidance.

## Module Reference

- **mission-types.md**: Type definitions, auto-detection logic, custom types
- **state-detection.md**: Artifact existence checks, quality validation, staleness
- **phase-routing.md**: Phase execution protocol, transition hooks, error handling
- **mission-state.md**: State schema, persistence, recovery protocol

## Reference Modules

- **mission-charter.md**: Structured mission definition template
- **progress-report.md**: Checkpoint status report template

## Related Skills

- `Skill(attune:project-brainstorming)` - Brainstorm phase
- `Skill(attune:project-specification)` - Specify phase
- `Skill(attune:project-planning)` - Plan phase
- `Skill(attune:project-execution)` - Execute phase
- `Skill(attune:war-room-checkpoint)` - Risk assessment for RED/CRITICAL tasks
- `Skill(leyline:risk-classification)` - Task risk classification
- `Skill(leyline:damage-control)` - Error recovery during phases

## Related Commands

- `/attune:mission` - Invoke this skill
- `/attune:mission --resume` - Resume from saved state
- `/attune:mission --type tactical` - Override mission type

## Exit Criteria

- All phases in mission type completed successfully
- Artifacts exist for each completed phase
- Mission state saved to `.attune/mission-state.json`
- Risk summary generated (tier counts across all tasks)
- No unresolved errors or blockers
