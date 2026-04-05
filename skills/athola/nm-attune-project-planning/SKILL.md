---
name: project-planning
description: |
  Transform specifications into dependency-ordered implementation plans with phased tasks and parallel work identification
version: 1.8.1
triggers:
  - planning
  - architecture
  - task-breakdown
  - dependencies
  - estimation
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/attune", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: attune
---

> **Night Market Skill** — ported from [claude-night-market/attune](https://github.com/athola/claude-night-market/tree/master/plugins/attune). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [When to Use](#when-to-use)
- [Integration](#integration)
- [Planning Phases](#planning-phases)
- [Phase 1: Architecture Design](#phase-1:-architecture-design)
- [Phase 2: Task Breakdown](#phase-2:-task-breakdown)
- [Phase 3: Dependency Analysis](#phase-3:-dependency-analysis)
- [Phase 4: Sprint Planning](#phase-4:-sprint-planning)
- [Architecture Design Patterns](#architecture-design-patterns)
- [Component Identification](#component-identification)
- [Component Template](#component-template)
- [Component: [Name]](#component:-[name])
- [Task Breakdown Template](#task-breakdown-template)
- [TASK-[XXX]: [Task Name]](#task-[xxx]:-[task-name])
- [Task Estimation Guidelines](#task-estimation-guidelines)
- [Dependency Graph](#dependency-graph)
- [Sprint Structure](#sprint-structure)
- [Sprint [N]: [Focus Area]](#sprint-[n]:-[focus-area])
- [Planned Tasks ([X] story points)](#planned-tasks-([x]-story-points))
- [Deliverable](#deliverable)
- [Risks](#risks)
- [Dependencies](#dependencies)
- [Risk Assessment](#risk-assessment)
- [Output Format](#output-format)
- [Architecture](#architecture)
- [System Overview](#system-overview)
- [Component Diagram](#component-diagram)
- [Components](#components)
- [Data Flow](#data-flow)
- [Task Breakdown](#task-breakdown)
- [Phase 1: [Name] (Sprint [N]) - TASK-001 through TASK-010](#phase-1:-[name]-(sprint-[n])---task-001-through-task-010)
- [Phase 2: [Name] (Sprint [M]) - TASK-011 through TASK-020](#phase-2:-[name]-(sprint-[m])---task-011-through-task-020)
- [Dependency Graph](#dependency-graph)
- [Sprint Schedule](#sprint-schedule)
- [Risk Assessment](#risk-assessment)
- [Success Metrics](#success-metrics)
- [Timeline](#timeline)
- [Next Steps](#next-steps)
- [Quality Checks](#quality-checks)
- [Related Skills](#related-skills)
- [Related Commands](#related-commands)
- [Examples](#examples)


# Project Planning Skill

Transform specification into implementation plan with architecture design and dependency-ordered tasks.

## Delegation

For detailed task planning workflows, this skill delegates to `spec-kit:task-planning` as the canonical implementation. Use this skill for quick planning needs; use spec-kit for comprehensive project plans.

## When To Use

- After specification phase completes
- Need to design system architecture
- Need task breakdown for implementation
- Planning sprints and resource allocation
- Converting requirements into actionable tasks
- Defining component interfaces and dependencies

## When NOT To Use

- No specification exists yet (use `Skill(attune:project-specification)` first)
- Still exploring problem space (use `Skill(attune:project-brainstorming)` instead)
- Ready to execute existing plan (use `Skill(attune:project-execution)` instead)
- Need to adjust running project (update plan incrementally, don't restart)

## Integration

**With superpowers**:
- Uses `Skill(superpowers:writing-plans)` for structured planning
- Applies checkpoint-based execution patterns
- Uses dependency analysis framework

**Without superpowers**:
- Standalone planning methodology
- Task breakdown templates
- Dependency tracking patterns

## Planning Phases

### Phase 1: Architecture Design

**Activities**:
1. Identify system components
2. Define component responsibilities
3. Design interfaces between components
4. Map data flows
5. Select technologies

**Output**: Architecture documentation with diagrams

### Phase 1.5: File Structure (REQUIRED)

**Activities**:
1. Map which files will be created or modified
2. Assign one-line purpose to each file
3. Verify each file has a single clear responsibility
4. Lock in decomposition decisions before task breakdown

**This phase MUST complete before Phase 2 begins.**
Tasks reference files declared here; undeclared files
require revisiting this phase.

**Output**: File structure table

**Template**:

| File | Action | Purpose |
|------|--------|---------|
| `path/to/file.py` | Create | One-line purpose |
| `path/to/existing.py` | Modify | What changes |
| `path/to/obsolete.py` | Delete | Why removed |

**Validation**:
- Every file in the plan appears in this table
- Every file has exactly one Action (Create/Modify/Delete)
- No file appears twice with different actions
- Purpose describes WHAT, not HOW

### Phase 2: Task Breakdown

**Activities**:
1. Decompose FRs into implementation tasks
2. Add testing tasks for each FR
3. Add infrastructure tasks
4. Add documentation tasks
5. Estimate each task

**Output**: Task list with estimates

### Phase 3: Dependency Analysis

**Activities**:
1. Identify task dependencies
2. Create dependency graph
3. Identify critical path
4. Detect circular dependencies
5. Optimize for parallelization

**Output**: Dependency-ordered task execution plan

### Phase 4: Sprint Planning

**Activities**:
1. Group tasks into sprints
2. Balance sprint workload
3. Identify milestones
4. Plan releases
5. Allocate resources

**Output**: Sprint schedule with milestones

## Architecture Design Patterns

### Component Identification

**Questions**:
- What are the major functional areas?
- What concerns should be separated?
- What components can be developed independently?
- What components can be reused?

**Common Patterns**:
- **Frontend/Backend**: Separate UI from business logic
- **API Layer**: Separate interface from implementation
- **Data Layer**: Separate data access from business logic
- **Integration Layer**: Isolate external dependencies

### Component Template

```markdown
### Component: [Name]

**Responsibility**: [What this component does]

**Technology**: [Stack and tools]

**Interfaces**:
- [Interface 1]: [Description]
- [Interface 2]: [Description]

**Dependencies**:
- [Component 1]: [What's needed]
- [Component 2]: [What's needed]

**Data**:
- [Data structure 1]
- [Data structure 2]

**Configuration**:
- [Config param 1]
- [Config param 2]
```

## Task Breakdown Template

```markdown
### TASK-[XXX]: [Task Name]

**Description**: [What needs to be done]

**Type**: Implementation | Testing | Documentation | Infrastructure | Deployment
**Priority**: P0 (Critical) | P1 (High) | P2 (Medium) | P3 (Low)
**Estimate**: [Story points or hours]
**Dependencies**: TASK-XXX, TASK-YYY
**Sprint**: Sprint N
**Assignee**: [Name or TBD]

**Linked Requirements**: FR-XXX, NFR-YYY

**Acceptance Criteria**:
- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] Tests passing
- [ ] Documentation updated

**Technical Notes**:
- [Implementation detail 1]
- [Implementation detail 2]

**Testing Requirements**:
- Unit tests: [What to test]
- Integration tests: [What to test]
- E2E tests: [What to test]

**Definition of Done**:
- [ ] Code complete
- [ ] Tests passing
- [ ] Code reviewed
- [ ] Documentation updated
- [ ] Deployed to staging
```

## Task Estimation Guidelines

**Story Points (Fibonacci)**:
- **1 point**: < 2 hours, trivial, well-understood
- **2 points**: 2-4 hours, straightforward
- **3 points**: 4-8 hours, some complexity
- **5 points**: 1-2 days, moderate complexity
- **8 points**: 2-3 days, significant complexity
- **13 points**: 3-5 days, high complexity (consider breaking down)
- **21 points**: > 5 days, very complex (MUST break down)

**Factors to consider**:
- Technical complexity
- Uncertainty/unknowns
- Dependencies on other work
- Testing requirements
- Documentation needs

## Dependency Graph

**Notation**:
```
TASK-001 (Foundation)
    ├─▶ TASK-002 (Database schema)
    │       ├─▶ TASK-003 (Models)
    │       └─▶ TASK-011 (Data import)
    └─▶ TASK-004 (Authentication)
            └─▶ TASK-005 (Auth middleware)
                    └─▶ TASK-010 (Protected endpoints)
```

**Validation**:
- No circular dependencies (A depends on B, B depends on A)
- Critical path identified
- Parallel work opportunities identified
- Blocking tasks highlighted

## Sprint Structure

**Sprint Template**:
```markdown
## Sprint [N]: [Focus Area]

**Dates**: [Start] - [End]
**Goal**: [Sprint objective]
**Capacity**: [Team capacity in story points]

### Planned Tasks ([X] story points)
- TASK-XXX ([N] points)
- TASK-YYY ([M] points)
- ...

### Deliverable
[What will be demonstrable at sprint end]

### Risks
- [Risk 1 with mitigation]
- [Risk 2 with mitigation]

### Dependencies
- [External dependency 1]
- [External dependency 2]
```

## Risk Assessment

**Risk Template**:
```markdown
| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| [Risk description] | High/Med/Low | High/Med/Low | [How to address] |
```

**Common Risks**:
- Technology unknowns
- Third-party API dependencies
- Resource availability
- Scope creep
- Performance issues
- Security vulnerabilities

## Output Format

Save to `docs/implementation-plan.md`:

```markdown
# [Project Name] - Implementation Plan v[version]

**Author**: [Name]
**Date**: [YYYY-MM-DD]
**Sprint Length**: [Duration]
**Team Size**: [Number]
**Target Completion**: [Date]

## Architecture

### System Overview
[High-level architecture description]

### Component Diagram
[ASCII or markdown diagram]

### Components
[Component details using template above]

### Data Flow
[How data moves through system]

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| [path] | Create/Modify/Delete | [purpose] |

## Task Breakdown

### Phase 1: [Name] (Sprint [N]) - TASK-001 through TASK-010

[Tasks using template above]

### Phase 2: [Name] (Sprint [M]) - TASK-011 through TASK-020

[Tasks using template above]

## Dependency Graph

[Dependency visualization]

## Sprint Schedule

[Sprint details using template above]

## Risk Assessment

[Risk table]

## Success Metrics

- [ ] [Metric 1]
- [ ] [Metric 2]

## Timeline

| Sprint | Dates | Focus | Deliverable |
|--------|-------|-------|-------------|
| 1 | Jan 3-16 | Foundation | Dev environment |
| 2 | Jan 17-30 | Core | Feature X working |

## Next Steps

1. Review plan with team
2. Initialize project with `/attune:project-init`
3. Start execution with `/attune:execute`
```

## Quality Checks

Before completing plan:

- ✅ All architecture components documented
- ✅ File Structure section present before tasks
- ✅ All task files appear in File Structure table
- ✅ All FRs mapped to tasks
- ✅ All tasks have acceptance criteria
- ✅ Dependencies are acyclic
- ✅ Effort estimates provided
- ✅ Critical path identified
- ✅ Risks assessed with mitigations
- ✅ Sprints balanced by capacity

## Post-Completion: Workflow Continuation (REQUIRED)

**Automatic Trigger**: After Quality Checks pass and `docs/implementation-plan.md` is saved, MUST auto-invoke the next phase.

**When continuation is invoked**:
1. Verify `docs/implementation-plan.md` exists and is non-empty
2. Display checkpoint message to user:
   ```
   Implementation plan complete. Saved to docs/implementation-plan.md.
   Proceeding to execution phase...
   ```
3. Invoke next phase:
   ```
   Skill(attune:project-execution)
   ```

**Bypass Conditions** (ONLY skip continuation if ANY true):
- `--standalone` flag was provided by the user
- `docs/implementation-plan.md` does not exist or is empty (phase failed)
- User explicitly requests to stop after planning

**Do NOT prompt the user for confirmation** — this is a lightweight checkpoint, not an interactive gate. The user can always interrupt if needed.

## Related Skills

- `Skill(superpowers:writing-plans)` - Planning methodology (if available)
- `Skill(spec-kit:task-planning)` - Task breakdown (if available)
- `Skill(attune:project-specification)` - Previous phase
- `Skill(attune:project-execution)` - **AUTO-INVOKED** next phase after planning
- `Skill(attune:mission-orchestrator)` - Full lifecycle orchestration

## Related Commands

- `/attune:blueprint` - Invoke this skill
- `/attune:execute` - Next step in workflow

## Examples

See `/attune:blueprint` command documentation for complete examples.
## Troubleshooting

### Common Issues

If you find circular dependencies in your task graph, break one of the tasks into smaller sub-tasks. If sprint capacity is consistently exceeded, re-estimate tasks using the Fibonacci scale or reduce sprint scope.
