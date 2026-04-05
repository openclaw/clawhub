---
name: task-planning
description: |
  Generate phased, dependency-ordered tasks from specifications with parallelization opportunities and tech-stack patterns
version: 1.8.1
triggers:
  - speckit
  - tasks
  - planning
  - implementation
  - dependencies
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/spec-kit", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.superpowers:writing-plans", "night-market.superpowers:executing-plans"]}}}
source: claude-night-market
source_plugin: spec-kit
---

> **Night Market Skill** — ported from [claude-night-market/spec-kit](https://github.com/athola/claude-night-market/tree/master/plugins/spec-kit). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Task Planning

## Overview

Transforms specifications and implementation plans into actionable, dependency-ordered tasks. Creates phased breakdowns that guide systematic implementation.

## When To Use

- Converting specifications to implementation tasks
- Planning feature implementation order
- Identifying parallel execution opportunities
- Breaking down complex features into phases

## When NOT To Use

- Writing specifications - use spec-writing

## Task Phases

Tasks follow a 5-phase structure from setup through polish:

- **Phase 0: Setup** - Project initialization, dependencies, configuration
- **Phase 1: Foundation** - Data models, interfaces, test infrastructure
- **Phase 2: Core Implementation** - Business logic, APIs, services
- **Phase 3: Integration** - External services, middleware, logging
- **Phase 4: Polish** - Optimization, documentation, final testing

For detailed phase definitions, selection guidelines, and anti-patterns, see `modules/phase-structure.md`.

## Task Format

Each task includes:
- **ID**: Unique identifier (TASK-001)
- **Description**: Clear action statement
- **Phase**: Which phase it belongs to
- **Dependencies**: Tasks that must complete first
- **Parallel Marker**: [P] if can run concurrently
- **Files**: Affected file paths
- **Criteria**: How to verify completion

## Dependency Rules

Dependencies define execution order and identify parallelization opportunities:

- **Sequential Tasks**: Execute in strict order when dependencies exist
- **Parallel Tasks [P]**: Can run concurrently when ALL nonconflicting conditions are met
- **File Coordination**: Tasks affecting same files MUST run sequentially

**Nonconflicting Criteria for Parallel Execution**:
- ✅ Files: No file overlap between tasks
- ✅ State: No shared configuration or global state
- ✅ Dependencies: All prerequisites satisfied
- ✅ Code paths: No merge conflicts possible
- ✅ Outputs: Tasks don't need each other's results

**Mark tasks with [P] ONLY if they pass ALL criteria above.**

For fan-out/fan-in patterns, task ID conventions, and validation rules, see `modules/dependency-patterns.md`.

## Example Task Entry

```markdown
## Phase 2: Core Implementation

### TASK-007 - Implement user authentication service [P]
**Dependencies**: TASK-003, TASK-004
**Files**: src/services/auth.ts, src/types/user.ts
**Criteria**: All auth tests pass, tokens are valid JWT
```
**Verification:** Run `pytest -v` to verify tests pass.

## Quality Checklist

- [ ] All requirements mapped to tasks
- [ ] Dependencies are explicit
- [ ] Parallel opportunities identified
- [ ] Tasks are right-sized (not too large/small)
- [ ] Each task has clear completion criteria

## Related Skills

- `spec-writing`: Creating source specifications
- `speckit-orchestrator`: Workflow coordination
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
