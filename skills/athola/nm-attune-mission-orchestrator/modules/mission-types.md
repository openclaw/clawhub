---
name: mission-types
description: Mission type definitions, phase sequences, auto-detection logic, and custom type support
parent_skill: attune:mission-orchestrator
category: workflow-orchestration
estimated_tokens: 200
---

# Mission Types

## Type Definitions

### full

**Phases**: brainstorm → specify → plan → execute

**Use when**: Starting from scratch with no existing artifacts. The complete development lifecycle from ideation to implementation.

**Auto-detected when**: None of the following exist:
- `docs/project-brief.md`
- `docs/specification.md`
- `docs/implementation-plan.md`

### standard

**Phases**: specify → plan → execute

**Use when**: A project brief exists but needs to be turned into a specification, planned, and executed.

**Auto-detected when**: `docs/project-brief.md` exists but `docs/specification.md` does not.

### tactical

**Phases**: plan → execute

**Use when**: Specification is complete and ready for planning and implementation.

**Auto-detected when**: `docs/specification.md` exists but `docs/implementation-plan.md` does not.

### quickfix

**Phases**: execute

**Use when**: Implementation plan exists and is ready for execution. Useful for resuming execution or running a quick fix with a pre-written plan.

**Auto-detected when**: `docs/implementation-plan.md` exists.

## Auto-Detection Logic

```
function detect_mission_type():
    if exists("docs/implementation-plan.md"):
        return "quickfix"
    elif exists("docs/specification.md"):
        return "tactical"
    elif exists("docs/project-brief.md"):
        return "standard"
    else:
        return "full"
```

**Priority**: Later artifacts take precedence. If both a brief and a spec exist, the type is `tactical` (because the spec is a more advanced artifact).

**Quality check**: Existence alone is not sufficient. The artifact must be non-empty and contain expected sections. See `state-detection.md` for validation rules.

## User Override

Users can override auto-detection:

```bash
# Force full lifecycle even if artifacts exist
/attune:mission --type full

# Skip brainstorming, go straight to spec
/attune:mission --type standard

# Just plan and execute
/attune:mission --type tactical

# Execute existing plan
/attune:mission --type quickfix
```

## Custom Phase Sequences

For non-standard workflows, users can specify exact phases:

```bash
# Brainstorm then execute (skip spec and plan)
/attune:mission --phases brainstorm,execute

# Specify and plan without execution
/attune:mission --phases specify,plan
```

**Validation**: Custom sequences must maintain phase order (brainstorm < specify < plan < execute). Out-of-order phases are rejected.

## Type Selection Display

When the orchestrator starts, it displays the detected type and asks for confirmation:

```
Mission Type: tactical (auto-detected)
  Reason: docs/specification.md exists, no implementation plan found
  Phases: plan → execute

Proceed with this mission type? [Y/n/override]
```

With `--auto` flag, this confirmation is skipped.
