---
name: speckit-orchestrator
description: |
  'Workflow orchestrator for Spec Driven Development. Coordinates skills and tracks progress. speckit workflow, spec driven development, speckit commands.'
version: 1.8.1
triggers:
  - speckit
  - workflow
  - orchestration
  - planning
  - specification
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/spec-kit", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.sanctum:git-workspace-review", "night-market.imbue:proof-of-work", "night-market.superpowers:brainstorming", "night-market.superpowers:writing-plans", "night-market.superpowers:executing-plans"]}}}
source: claude-night-market
source_plugin: spec-kit
---

> **Night Market Skill** — ported from [claude-night-market/spec-kit](https://github.com/athola/claude-night-market/tree/master/plugins/spec-kit). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [Persistent Presence Lens](#persistent-presence-lens)
- [When to Use](#when-to-use)
- [Core Workflow](#core-workflow)
- [Session Initialization](#session-initialization)
- [Command-Skill Matrix](#command-skill-matrix)
- [Progress Tracking Items](#progress-tracking-items)
- [Exit Criteria](#exit-criteria)
- [Related Skills](#related-skills)


# Speckit Orchestrator

## Overview

Coordinates the Spec Driven Development workflow, skill loading, and progress tracking throughout the command lifecycle.

## Persistent Presence Lens

Treat SDD as a minimal, testable “self-modeling” loop:

- **World model**: repo + speckit artifacts (`spec.md`, `plan.md`, `tasks.md`)
- **Agent model**: loaded skills/plugins + constraints (especially `.specify/memory/constitution.md`) + progress state

This mirrors patterns from open-ended embodied agents (e.g., Voyager/MineDojo) that compound capability via a curriculum (`tasks.md`) and a skill library (reusable plugin skills + superpowers methodology skills).

## When To Use

- Starting any `/speckit-*` command.
- Coordinating multi-phase development workflows.
- Tracking progress across specification, planning, and implementation.
- Ensuring skill dependencies are loaded.

## When NOT To Use

- Single-phase work (just specify, or just plan)
- Non-spec-driven projects

## Core Workflow

### Session Initialization

1. **Verify Repository Context**
   - Confirm working directory is a speckit-enabled project.
   - Check for `.specify/` directory structure.
   - Validate required scripts exist.

2. **Load Persistent State ("presence")**
   - Read `.specify/memory/constitution.md` for constraints/principles.
   - Load current `spec.md` / `plan.md` / `tasks.md` context if present.

3. **Load Command Dependencies**
   - Match current command to required skills.
   - Load complementary superpowers skills.

4. **Initialize Progress Tracking**
   - Create TodoWrite items for workflow phases.
   - Track completion status.

### Command-Skill Matrix

Quick reference for command-to-skill mappings:

| Command | Primary Skill | Complementary Skills |
|---------|--------------|---------------------|
| `/speckit-specify` | spec-writing | brainstorming |
| `/speckit-clarify` | spec-writing | brainstorming |
| `/speckit-plan` | task-planning | writing-plans |
| `/speckit-tasks` | task-planning | executing-plans |
| `/speckit-implement` | - | executing-plans, systematic-debugging |
| `/speckit-analyze` | - | systematic-debugging, verification |
| `/speckit-checklist` | - | verification-before-completion |

**For detailed patterns**: See `modules/command-skill-matrix.md` for complete mappings and loading rules.

See `modules/writing-plans-extensions.md` for plan authoring patterns.

### Progress Tracking Items

For each workflow session, track:
- [ ] Repository context verified.
- [ ] Prerequisites validated.
- [ ] Command-specific skills loaded.
- [ ] Artifacts created/updated.
- [ ] Verification completed.

**For detailed patterns**: See `modules/progress-tracking.md` for TodoWrite patterns and metrics.

## Exit Criteria

- Active command completed successfully.
- All required artifacts exist and are valid.
- Progress tracking reflects current state.
- No unresolved blockers.

## Related Skills

- `spec-writing`: Specification creation and refinement.
- `task-planning`: Task generation and planning.
- `superpowers:brainstorming`: Idea refinement.
- `superpowers:writing-plans`: Implementation planning.
- `superpowers:executing-plans`: Task execution.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
