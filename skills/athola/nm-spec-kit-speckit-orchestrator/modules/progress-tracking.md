# Progress Tracking

## Overview

Defines TodoWrite item patterns and progress tracking strategies for speckit workflows. validates consistent status reporting and verification throughout all workflow phases.

## TodoWrite Item Patterns

### Universal Workflow Items

For every speckit command session:

```
- [ ] Verify repository context and .specify/ structure
- [ ] Validate prerequisites (scripts, dependencies, templates)
- [ ] Load command-specific skills
- [ ] Execute command workflow
- [ ] Verify artifacts created/updated
- [ ] Complete progress tracking
```

### Specification Phase Items

**`/speckit-specify`**
```
- [ ] Load spec-writing and brainstorming skills
- [ ] Analyze feature description and requirements
- [ ] Generate/update spec.md with template
- [ ] Verify spec.md contains all required sections
- [ ] Validate frontmatter metadata
```

**`/speckit-clarify`**
```
- [ ] Read existing spec.md
- [ ] Identify underspecified areas
- [ ] Ask targeted clarification questions (max 5)
- [ ] Encode answers back into spec.md
- [ ] Verify improved specification completeness
```

**`/speckit-constitution`**
```
- [ ] Gather project principles (interactive or provided)
- [ ] Create/update constitution.md
- [ ] Sync dependent templates with constitution
- [ ] Verify template consistency
```

### Planning Phase Items

**`/speckit-plan`**
```
- [ ] Load task-planning and writing-plans skills
- [ ] Read spec.md and constitution.md
- [ ] Execute planning template workflow
- [ ] Generate plan.md with design artifacts
- [ ] Verify plan completeness and consistency
```

**`/speckit-tasks`**
```
- [ ] Read all available design artifacts (spec, plan, constitution)
- [ ] Analyze dependencies and ordering constraints
- [ ] Generate tasks.md with actionable items
- [ ] Verify task ordering and completeness
- [ ] Mark tasks ready for implementation
```

### Implementation Phase Items

**`/speckit-implement`**
```
- [ ] Load executing-plans skill
- [ ] Read and parse tasks.md
- [ ] Execute tasks in dependency order
- [ ] Track completion status per task
- [ ] Handle errors with systematic-debugging
- [ ] Verify all tasks completed successfully
```

### Verification Phase Items

**`/speckit-analyze`**
```
- [ ] Read spec.md, plan.md, tasks.md
- [ ] Check cross-artifact consistency
- [ ] Identify quality issues
- [ ] Generate analysis report
- [ ] Provide actionable recommendations
```

**`/speckit-checklist`**
```
- [ ] Read feature requirements from spec.md
- [ ] Generate custom verification checklist
- [ ] Output checklist in markdown format
- [ ] Verify checklist completeness
```

## Workflow Phase Tracking

### Phase States

1. **Not Started**: Prerequisites not yet validated
2. **In Progress**: Command executing, artifacts being created
3. **Blocked**: Waiting for user input or error resolution
4. **Completed**: Artifacts created, verification passed
5. **Failed**: Unrecoverable error, manual intervention needed

### Phase Transitions

```
Not Started → In Progress: When prerequisites validated
In Progress → Blocked: When user input or clarification needed
In Progress → Failed: When unrecoverable error occurs
In Progress → Completed: When all exit criteria met
Blocked → In Progress: When blocker resolved
```

### Status Reporting

After each phase transition, report:
- Current phase and status
- Artifacts created/modified
- Outstanding blockers (if any)
- Next steps

## Completion Verification Patterns

### Specification Phase Verification

- [ ] spec.md exists and is valid markdown
- [ ] All required frontmatter fields present
- [ ] All template sections completed
- [ ] No placeholder text remains
- [ ] Acceptance criteria are testable

### Planning Phase Verification

- [ ] plan.md exists and follows template
- [ ] Design decisions documented with rationale
- [ ] Architecture diagrams/descriptions present
- [ ] Technical approach is clear
- [ ] Risks and mitigations identified

### Task Generation Verification

- [ ] tasks.md exists with actionable items
- [ ] Tasks are dependency-ordered
- [ ] Each task has clear completion criteria
- [ ] File paths and locations specified
- [ ] Verification steps included

### Implementation Phase Verification

- [ ] All tasks in tasks.md completed
- [ ] Code compiles/runs successfully
- [ ] Tests pass (if applicable)
- [ ] No unresolved TODOs or FIXMEs
- [ ] Documentation updated

### Cross-Artifact Verification

- [ ] spec.md requirements match plan.md design
- [ ] plan.md design matches tasks.md implementation
- [ ] tasks.md tasks align with spec.md acceptance criteria
- [ ] No conflicting information across artifacts
- [ ] Version/date metadata is consistent

## Progress Persistence

### Session Continuity

- Track progress in TodoWrite for current session
- Save state to artifacts (spec.md, plan.md, tasks.md)
- Use frontmatter metadata for phase tracking
- Enable `/catchup` recovery across sessions

### Recovery Patterns

**After Session Interruption**:
1. Read artifact frontmatter to determine last phase
2. Check artifact completeness vs. expected state
3. Resume from last verified checkpoint
4. Re-validate prerequisites if needed

**After Error**:
1. Mark current phase as blocked
2. Document error and attempted solutions
3. Load systematic-debugging if needed
4. Clear blocker, then resume progress

## Metrics and Reporting

### Track Per Session

- Total workflow duration
- Time per phase
- Number of iterations (clarify, refactor)
- Artifact sizes (lines, tokens)
- User interactions required

### Quality Metrics

- Specification completeness score
- Plan-spec alignment score
- Task-plan alignment score
- Cross-artifact consistency score
