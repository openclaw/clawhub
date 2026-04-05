# Phase 2: Task Planning

Analyze issue dependencies and create structured task breakdown.

## Dependency Analysis

Identify which issues can be worked in parallel:

```python
def analyze_dependencies(issues):
    """
    Identify which issues can be worked in parallel.
    """
    independent = []
    dependent = []

    for issue in issues:
        if issue.has_no_blockers(issues):
            independent.append(issue)
        else:
            dependent.append({
                'issue': issue,
                'blocked_by': issue.get_blockers(issues)
            })

    return independent, dependent
```

## Task Breakdown

For each issue, generate tasks following `superpowers:writing-plans` structure:

```markdown
## Issue #42: Add user authentication

### Task 1: Create auth middleware
- [ ] Implement JWT validation
- [ ] Add route protection decorator
- [ ] Write unit tests

### Task 2: Add login endpoint
- [ ] Create POST /auth/login
- [ ] Implement password verification
- [ ] Return JWT on success
- [ ] Write integration tests
```

## Initialize TodoWrite

Create todos for all tasks across all issues:

```
- [ ] Issue #42 - Task 1: Create auth middleware
- [ ] Issue #42 - Task 2: Add login endpoint
- [ ] Issue #43 - Task 1: Fix validation bug
```

## Dependency Graph Example

```
Dependency Graph:
  #42: Independent
  #43: Independent
  #44: Depends on #42

Parallel Batch 1: Issues #42, #43
Sequential Phase: Issue #44
```

## Risk Classification

After task breakdown, classify each task's risk tier using `leyline:risk-classification` heuristics. Run the heuristic classifier against each task's affected files and append a `[R:TIER]` marker.

### Classification Process

1. For each task, identify the files it will modify
2. Apply `leyline:risk-classification/modules/heuristic-classifier.md` pattern matching
3. Append `[R:TIER]` marker to the task line

### Task Format with Risk Markers

```markdown
- [ ] T001 Create project structure per implementation plan
- [ ] T005 [P] [R:YELLOW] Implement authentication middleware in src/middleware/auth.py
- [ ] T012 [P] [US1] [R:YELLOW] Create LoginForm component in src/components/LoginForm.tsx
- [ ] T015 [US2] [R:RED] Add user migration in migrations/002_add_users.py
```

Tasks without `[R:TIER]` markers default to GREEN. Markers are additive — existing task formats remain valid without them.

## Next Phase

After planning, proceed to [parallel-execution.md](parallel-execution.md) to dispatch subagents.
