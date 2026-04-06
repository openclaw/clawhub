# Task Dependency Patterns

## Overview

Dependencies define task execution order and identify parallelization opportunities. Proper dependency modeling prevents race conditions and validates components exist before they're used.

## Dependency Types

### Sequential Dependencies

**Definition**: Task B cannot start until Task A completes

**When to Use**:
- Task B modifies output from Task A
- Task B requires interfaces/types defined in Task A
- Task B tests functionality implemented in Task A
- Tasks affect the same file(s)

**Example**:
```markdown
### TASK-002 - Define Task data model
**Dependencies**: TASK-001
**Files**: src/models/task.py

### TASK-003 - Implement task validation
**Dependencies**: TASK-002
**Files**: src/models/task.py, src/validators/task.py
```

**Reasoning**: Task validation requires the Task model to exist first. Both affect task.py, requiring sequential execution.

### Parallel Dependencies [P]

**Definition**: Tasks can execute concurrently with no conflicts

**When to Use**:
- No shared dependencies beyond a common foundation
- Operate on different files
- Independent feature implementations
- Separate test suites

**Marker**: Suffix task with `[P]`

**Example**:
```markdown
### TASK-004 - Implement user authentication [P]
**Dependencies**: TASK-001
**Files**: src/services/auth.py, tests/test_auth.py

### TASK-005 - Implement task storage [P]
**Dependencies**: TASK-001
**Files**: src/services/storage.py, tests/test_storage.py
```

**Reasoning**: Both depend on TASK-001 setup but operate on different files and can run concurrently.

### Fan-Out Pattern

**Definition**: Multiple tasks depend on single foundation task

**Pattern**:
```
TASK-001 (Foundation)
    ├─> TASK-002 [P]
    ├─> TASK-003 [P]
    └─> TASK-004 [P]
```

**Use Case**: After creating data models, implement multiple independent services

**Example**:
```markdown
### TASK-001 - Define API schemas
**Dependencies**: None
**Files**: src/types/api.ts

### TASK-002 - Implement user endpoints [P]
**Dependencies**: TASK-001
**Files**: src/routes/users.ts

### TASK-003 - Implement task endpoints [P]
**Dependencies**: TASK-001
**Files**: src/routes/tasks.ts

### TASK-004 - Implement project endpoints [P]
**Dependencies**: TASK-001
**Files**: src/routes/projects.ts
```

### Fan-In Pattern

**Definition**: Single task depends on multiple prerequisites

**Pattern**:
```
TASK-002 [P] ─┐
TASK-003 [P] ─┼─> TASK-005
TASK-004 [P] ─┘
```

**Use Case**: Integration task requiring multiple components

**Example**:
```markdown
### TASK-002 - Implement auth service [P]
**Dependencies**: TASK-001
**Files**: src/services/auth.py

### TASK-003 - Implement storage service [P]
**Dependencies**: TASK-001
**Files**: src/services/storage.py

### TASK-004 - Implement notification service [P]
**Dependencies**: TASK-001
**Files**: src/services/notifications.py

### TASK-005 - Integrate services in workflow
**Dependencies**: TASK-002, TASK-003, TASK-004
**Files**: src/workflow/coordinator.py
```

## File Coordination Rules

### Same-File Modification

**Rule**: Tasks modifying the same file must execute sequentially

**Example**:
```markdown
### TASK-006 - Add base Task class
**Files**: src/models/task.py

### TASK-007 - Add Task validation methods
**Dependencies**: TASK-006
**Files**: src/models/task.py
```

**Reasoning**: Prevents merge conflicts and validates clean incremental changes.

### Same-Directory Independence

**Rule**: Tasks creating different files in same directory can run in parallel

**Example**:
```markdown
### TASK-008 - Create user model [P]
**Files**: src/models/user.py

### TASK-009 - Create task model [P]
**Files**: src/models/task.py
```

**Reasoning**: No file conflicts, different models, independent implementations.

### Test-Implementation Pairing

**Rule**: Implementation and its tests are typically sequential

**Example**:
```markdown
### TASK-010 - Implement resolver logic
**Files**: src/services/resolver.py

### TASK-011 - Add resolver integration tests
**Dependencies**: TASK-010
**Files**: tests/integration/test_resolver.py
```

**Reasoning**: Can't test what doesn't exist yet.

**Exception**: TDD approach might reverse this (write test first).

## Task ID Conventions

### Numbering Format

**Pattern**: `TASK-NNN` where NNN is zero-padded number

**Examples**:
- `TASK-001` - First task
- `TASK-023` - Twenty-third task
- `TASK-100` - Hundredth task

**Rules**:
- Always zero-pad to 3 digits minimum
- Sequential numbering across phases
- No gaps in sequence
- Don't reuse IDs

### Ordering Strategy

**By Phase First**:
```markdown
TASK-001 through TASK-003: Phase 0
TASK-004 through TASK-010: Phase 1
TASK-011 through TASK-025: Phase 2
TASK-026 through TASK-030: Phase 3
TASK-031 through TASK-035: Phase 4
```

**Benefit**: Clear phase boundaries, easy to identify task phase

## Dependency Declaration Format

### Single Dependency
```markdown
**Dependencies**: TASK-001
```

### Multiple Dependencies
```markdown
**Dependencies**: TASK-001, TASK-003, TASK-007
```

### No Dependencies
```markdown
**Dependencies**: None
```

## Common Dependency Patterns

### Linear Chain
```
TASK-001 -> TASK-002 -> TASK-003 -> TASK-004
```
Use when each task builds directly on previous task.

### Independent Parallel
```
TASK-001
    ├─> TASK-002 [P]
    ├─> TASK-003 [P]
    └─> TASK-004 [P]
```
Use when multiple features share only initial setup.

### Diamond Pattern
```
        TASK-001
       /          \
TASK-002 [P]    TASK-003 [P]
       \          /
        TASK-004
```
Use when parallel work converges for integration.

### Layered Dependencies
```
Phase 1: TASK-001, TASK-002, TASK-003
           ↓         ↓         ↓
Phase 2: TASK-004 depends on all Phase 1
```
Use when foundation must be complete before next phase.

## Validation Rules

- [ ] Every task has explicit dependency field
- [ ] No circular dependencies
- [ ] Parallel tasks [P] have no file conflicts
- [ ] Sequential tasks on same file are ordered
- [ ] All referenced task IDs exist
- [ ] Tasks reference dependencies from earlier phases
