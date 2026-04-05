---
name: project-execution
description: |
  Execute implementation plans with progress tracking, checkpoint validation, and quality gates
version: 1.8.1
triggers:
  - execution
  - implementation
  - progress-tracking
  - quality-gates
  - tdd
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/attune", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: attune
---

> **Night Market Skill** — ported from [claude-night-market/attune](https://github.com/athola/claude-night-market/tree/master/plugins/attune). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [When to Use](#when-to-use)
- [Integration](#integration)
- [Execution Framework](#execution-framework)
- [Pre-Execution Phase](#pre-execution-phase)
- [Task Execution Loop](#task-execution-loop)
- [Post-Execution Phase](#post-execution-phase)
- [Task Execution Pattern](#task-execution-pattern)
- [TDD Workflow](#tdd-workflow)
- [Checkpoint Validation](#checkpoint-validation)
- [Progress Tracking](#progress-tracking)
- [Execution State](#execution-state)
- [Progress Reports](#progress-reports)
- [Yesterday](#yesterday)
- [Today](#today)
- [Blockers](#blockers)
- [Metrics](#metrics)
- [Completed ([X] tasks)](#completed-([x]-tasks))
- [In Progress ([Y] tasks)](#in-progress-([y]-tasks))
- [Blocked ([Z] tasks)](#blocked-([z]-tasks))
- [Burndown](#burndown)
- [Risks](#risks)
- [Blocker Management](#blocker-management)
- [Blocker Detection](#blocker-detection)
- [Systematic Debugging](#systematic-debugging)
- [Escalation](#escalation)
- [Blocker: [TASK-XXX] - [Issue]](#blocker:-[task-xxx]---[issue])
- [Quality Assurance](#quality-assurance)
- [Definition of Done](#definition-of-done)
- [Testing Strategy](#testing-strategy)
- [Velocity Tracking](#velocity-tracking)
- [Burndown Metrics](#burndown-metrics)
- [Velocity Adjustments](#velocity-adjustments)
- [Related Skills](#related-skills)
- [Related Agents](#related-agents)
- [Related Commands](#related-commands)
- [Examples](#examples)


# Project Execution Skill

Execute implementation plan systematically with checkpoints, validation, and progress tracking.

## When To Use

- After planning phase completes
- Ready to implement tasks
- Need systematic execution with tracking
- Want checkpoint-based validation
- Executing task lists with dependencies
- Monitoring progress and velocity

## When NOT To Use

- No implementation plan exists (use `Skill(attune:project-planning)` first)
- Still planning or designing (complete planning phase before execution)
- Single isolated task (execute directly without framework overhead)
- Exploratory coding or prototyping (use focused development instead)

## Integration

**With superpowers**:
- Uses `Skill(superpowers:executing-plans)` for systematic execution
- Uses `Skill(superpowers:systematic-debugging)` for issue resolution
- Uses `Skill(superpowers:verification-before-completion)` for validation
- Uses `Skill(superpowers:test-driven-development)` for TDD workflow

**Without superpowers**:
- Standalone execution framework
- Built-in checkpoint validation
- Progress tracking patterns

## Execution Framework

### Pre-Execution Phase

**Actions**:
1. Load implementation plan
2. Validate project initialized
3. Check dependencies installed
4. Review task dependency graph
5. Identify starting tasks (no dependencies)

**Validation**:
- ✅ Plan file exists and is valid
- ✅ Project structure initialized
- ✅ Git repository configured
- ✅ Development environment ready

### Task Execution Loop

**For each task in dependency order**:

```markdown
1. PRE-TASK
   - Verify dependencies complete
   - Review acceptance criteria
   - Create feature branch (optional)
   - Set up task context

2. IMPLEMENT (TDD Cycle)
   - Write failing test (RED)
   - Implement minimal code (GREEN)
   - Refactor for quality (REFACTOR)
   - Repeat until all criteria met

3. VALIDATE
   - All tests passing?
   - All acceptance criteria met?
   - Code quality checks pass?
   - Documentation updated?

4. CHECKPOINT
   - Mark task complete IMMEDIATELY (do NOT batch)
   - Update execution state
   - Report progress
   - Identify blockers
```

**Task Completion Discipline**: Always call `TaskUpdate(taskId: "X", status: "completed")` right after finishing each task—never defer completions to end of session.

**Verification:** Run `pytest -v` to verify tests pass.

### Post-Execution Phase

**Actions**:
1. Verify all tasks complete
2. Run full test suite
3. Check code quality metrics
4. Generate completion report
5. Prepare for deployment/release

### Terminal Phase Notice

This is the **final phase** of the attune workflow. No auto-continuation occurs after execution completes. The workflow terminates here. Unlike brainstorming, specification, and planning phases, execution does NOT auto-invoke any subsequent phase.

## Task Execution Pattern

### TDD Workflow

**RED Phase**:
```python
# Write test that fails
def test_user_authentication():
    user = authenticate("user@example.com", "password")
    assert user.is_authenticated
# Run test → FAILS (feature not implemented)
```
**Verification:** Run `pytest -v` to verify tests pass.

**GREEN Phase**:
```python
# Implement minimal code to pass
def authenticate(email, password):
    # Simplest implementation
    user = User.find_by_email(email)
    if user and user.check_password(password):
        user.is_authenticated = True
        return user
    return None
# Run test → PASSES
```
**Verification:** Run `pytest -v` to verify tests pass.

**REFACTOR Phase**:
```python
# Improve code quality
def authenticate(email: str, password: str) -> Optional[User]:
    """Authenticate user with email and password."""
    user = User.find_by_email(email)
    if user is None:
        return None

    if not user.check_password(password):
        return None

    user.mark_authenticated()
    return user
# Run test → STILL PASSES
```
**Verification:** Run `pytest -v` to verify tests pass.

### Checkpoint Validation

**Quality Gates**:
```markdown
- [ ] All acceptance criteria met
- [ ] All tests passing (unit + integration)
- [ ] Code linted (no warnings)
- [ ] Type checking passes (if applicable)
- [ ] Documentation updated
- [ ] No regression in other components
```
**Verification:** Run `pytest -v` to verify tests pass.

**Automated Checks**:
```bash
# Run quality gates
make lint          # Linting passes
make typecheck     # Type checking passes
make test          # All tests pass
make coverage      # Coverage threshold met
```
**Verification:** Run `pytest -v` to verify tests pass.

## Progress Tracking

### Execution State

Save to `.attune/execution-state.json`:

```json
{
  "plan_file": "docs/implementation-plan.md",
  "started_at": "2026-01-02T10:00:00Z",
  "last_checkpoint": "2026-01-02T14:30:22Z",
  "current_sprint": "Sprint 1",
  "current_phase": "Phase 1",
  "tasks": {
    "TASK-001": {
      "status": "complete",
      "started_at": "2026-01-02T10:05:00Z",
      "completed_at": "2026-01-02T10:50:00Z",
      "duration_minutes": 45,
      "acceptance_criteria_met": true,
      "tests_passing": true
    },
    "TASK-002": {
      "status": "in_progress",
      "started_at": "2026-01-02T14:00:00Z",
      "progress_percent": 60,
      "blocker": null
    }
  },
  "metrics": {
    "tasks_complete": 15,
    "tasks_total": 40,
    "completion_percent": 37.5,
    "velocity_tasks_per_day": 3.2,
    "estimated_completion_date": "2026-02-15"
  },
  "blockers": []
}
```
**Verification:** Run `pytest -v` to verify tests pass.

### Progress Reports

**Daily Standup**:
```markdown
# Daily Standup - [Date]

## Yesterday
- ✅ [Task] ([duration])
- ✅ [Task] ([duration])

## Today
- 🔄 [Task] ([progress]%)
- 📋 [Task] (planned)

## Blockers
- [Blocker] or None

## Metrics
- Sprint progress: [X/Y] tasks ([%]%)
- [Status message]
```
**Verification:** Run the command with `--help` flag to verify availability.

**Sprint Report**:
```markdown
# Sprint [N] Progress Report

**Dates**: [Start] - [End]
**Goal**: [Sprint objective]

## Completed ([X] tasks)
- [Task list]

## In Progress ([Y] tasks)
- [Task] ([progress]%)

## Blocked ([Z] tasks)
- [Task]: [Blocker description]

## Burndown
- Day 1: [N] tasks remaining
- Day 5: [M] tasks remaining ([status])
- Estimated completion: [Date] ([delta])

## Risks
- [Risk] or None identified
```
**Verification:** Run the command with `--help` flag to verify availability.

## Blocker Management

### Blocker Detection

**Common Blockers**:
- Failing tests that can't be fixed quickly
- Missing dependencies or APIs
- Technical unknowns requiring research
- Resource unavailability
- Scope ambiguity

### Systematic Debugging

When blocked, apply debugging framework:

1. **Reproduce**: Create minimal reproduction case
2. **Hypothesize**: Generate possible causes
3. **Test**: Validate hypotheses one by one
4. **Resolve**: Implement fix or workaround
5. **Document**: Record solution for future

### Escalation

**When to escalate**:
- Blocker persists > 2 hours
- Requires architecture change
- Impacts critical path
- Needs stakeholder decision

**Escalation format**:
```markdown
## Blocker: [TASK-XXX] - [Issue]

**Symptom**: [What's happening]

**Impact**: [Which tasks/timeline affected]

**Attempted Solutions**:
1. [Solution 1] - [Result]
2. [Solution 2] - [Result]

**Recommendation**: [Proposed path forward]

**Decision Needed**: [What needs to be decided]
```
**Verification:** Run the command with `--help` flag to verify availability.

## Quality Assurance

### Definition of Done

**Task is complete when**:
- ✅ All acceptance criteria met
- ✅ All tests written and passing
- ✅ Code reviewed (self or peer)
- ✅ Linting passes with no warnings
- ✅ Type checking passes (if applicable)
- ✅ Documentation updated
- ✅ No known regressions
- ✅ Deployed to staging (if applicable)

### Testing Strategy

**Test Pyramid**:
```
**Verification:** Run `pytest -v` to verify tests pass.
     /\
    /E2E\      Few, slow, expensive
   /------\
  /  INT  \    Some, moderate speed
 /----------\
/   UNIT    \  Many, fast, cheap
```
**Verification:** Run the command with `--help` flag to verify availability.

**Per Task**:
- Unit tests: Test individual functions/classes
- Integration tests: Test component interactions
- E2E tests: Test complete user flows (for user-facing features)

## Velocity Tracking

### Burndown Metrics

**Track daily**:
- Tasks remaining
- Story points remaining
- Days left in sprint
- Velocity (tasks or points per day)

**Formulas**:
```
**Verification:** Run `pytest -v` to verify tests pass.
Velocity = Tasks completed / Days elapsed
Estimated completion = Tasks remaining / Velocity
On track? = Estimated completion <= Sprint end date
```
**Verification:** Run the command with `--help` flag to verify availability.

### Velocity Adjustments

**If ahead of schedule**:
- Pull in stretch tasks
- Add technical debt reduction
- Improve test coverage
- Enhance documentation

**If behind schedule**:
- Identify causes (blockers, underestimation)
- Reduce scope (drop low-priority tasks)
- Increase focus (reduce distractions)
- Request help or extend timeline

## Related Skills

- `Skill(superpowers:executing-plans)` - Execution framework (if available)
- `Skill(superpowers:systematic-debugging)` - Debugging (if available)
- `Skill(superpowers:test-driven-development)` - TDD (if available)
- `Skill(superpowers:verification-before-completion)` - Validation (if available)
- `Skill(attune:mission-orchestrator)` - Full lifecycle orchestration

## Related Agents

- `Agent(attune:project-implementer)` - Task execution agent

## Related Commands

- `/attune:execute` - Invoke this skill
- `/attune:execute --task [ID]` - Execute specific task
- `/attune:execute --resume` - Resume from checkpoint

## Mission Report

At mission completion, produce a Mission Report using the
template from `references/mission-report.md`. The report documents:

- **Mission identification**: Links to brief, spec, plan
- **Duration**: Start, end, total time
- **Outcome**: success | partial | failed
- **Delivered artifacts**: Files created/modified/deleted
- **Decisions**: Key choices with rationale
- **Validation evidence**: Tests, reviews, demos
- **Follow-ups**: Recommended next steps

See `references/mission-report.md` for the full template and
example reports for successful, partial, and failed missions.

## Examples

See `/attune:execute` command documentation for complete examples.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
