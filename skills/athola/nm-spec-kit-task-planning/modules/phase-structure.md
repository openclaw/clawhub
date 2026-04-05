# Task Phase Structure

## Overview

Tasks are organized into five phases that follow natural implementation flow. Each phase builds on previous phases, creating a dependency foundation that validates components exist before they're used.

## Phase Definitions

### Phase 0: Setup

**Purpose**: Establish project foundation and development environment

**Typical Tasks**:
- Project initialization (package.json, pyproject.toml, etc.)
- Dependency installation and lock files
- Configuration files (linting, formatting, build tools)
- Development environment setup
- Git repository initialization
- CI/CD pipeline scaffolding

**When to Use**:
- Starting new projects from scratch
- Adding new build tools or development dependencies
- Setting up infrastructure before code implementation

**Example**:
```markdown
### TASK-001 - Initialize Python project with uv
**Dependencies**: None
**Files**: pyproject.toml, uv.lock
**Criteria**: `uv sync` runs successfully
```

### Phase 1: Foundation

**Purpose**: Create core data structures and testing infrastructure

**Typical Tasks**:
- Data models and type definitions
- Core interfaces and protocols
- Database schemas and migrations
- Test infrastructure and fixtures
- Base classes and abstract components
- Shared utilities

**When to Use**:
- Defining data contracts that other code depends on
- Creating type systems for type-safe implementations
- Establishing testing patterns before feature work

**Example**:
```markdown
### TASK-002 - Define Task data model
**Dependencies**: TASK-001
**Files**: src/models/task.py, tests/test_models.py
**Criteria**: All model tests pass, types validate with mypy
```

### Phase 2: Core Implementation

**Purpose**: Implement primary business logic and features

**Typical Tasks**:
- Service layer implementation
- Business logic and algorithms
- API endpoint implementations
- Core feature functionality
- Domain-specific operations
- State management

**When to Use**:
- Building main application features
- Implementing business requirements
- Creating user-facing functionality

**Example**:
```markdown
### TASK-007 - Implement task dependency resolver [P]
**Dependencies**: TASK-002, TASK-003
**Files**: src/services/resolver.py, tests/test_resolver.py
**Criteria**: Resolves complex dependency graphs, handles cycles
```

### Phase 3: Integration

**Purpose**: Connect components and integrate external systems

**Typical Tasks**:
- External API integrations
- Middleware implementation
- Error handling and recovery
- Logging and monitoring
- Database connection pooling
- Message queue integrations
- Authentication/authorization hooks

**When to Use**:
- Connecting to external services
- Adding cross-cutting concerns
- Implementing system-wide error handling

**Example**:
```markdown
### TASK-012 - Add structured logging with context
**Dependencies**: TASK-007, TASK-009
**Files**: src/middleware/logging.py, src/utils/logger.py
**Criteria**: All operations logged with correlation IDs
```

### Phase 4: Polish

**Purpose**: Optimize, document, and finalize for production

**Typical Tasks**:
- Performance optimization and profiling
- detailed documentation
- End-to-end testing
- Security hardening
- Code cleanup and refactoring
- Production readiness checks

**When to Use**:
- After core functionality is complete
- Preparing for production deployment
- Addressing technical debt before release

**Example**:
```markdown
### TASK-015 - Add API documentation with examples
**Dependencies**: TASK-007, TASK-010
**Files**: docs/api.md, examples/quickstart.py
**Criteria**: All endpoints documented, examples run successfully
```

## Phase Selection Guidelines

### Moving Between Phases

- **Complete phase foundations before advancing**: Don't jump to Phase 3 if Phase 1 models are incomplete
- **Parallel work within phases**: Multiple Phase 2 tasks can run concurrently if dependencies allow
- **Return to earlier phases sparingly**: Indicates incomplete planning or new requirements

### Common Patterns

**Small Features** (5-10 tasks):
- Phase 0: Usually skipped (project exists)
- Phase 1: 1-2 tasks (data models)
- Phase 2: 3-5 tasks (core logic)
- Phase 3: 1-2 tasks (integration)
- Phase 4: 1-2 tasks (docs, tests)

**Medium Features** (10-20 tasks):
- Phase 0: 1-2 tasks (new dependencies)
- Phase 1: 3-4 tasks (multiple models, test infrastructure)
- Phase 2: 6-10 tasks (multiple services)
- Phase 3: 2-4 tasks (several integrations)
- Phase 4: 2-3 tasks (optimization, detailed docs)

**Large Features** (20+ tasks):
- Consider breaking into multiple features
- Each phase may have 5+ tasks
- Requires careful dependency management
- May benefit from sub-phases

## Anti-Patterns to Avoid

- **Phase jumping**: Implementing Phase 2 features before Phase 1 models exist
- **Phase mixing**: Putting setup tasks in Phase 2 or implementation tasks in Phase 1
- **Skipping phases**: Every feature needs at least Phase 1 (models) and Phase 2 (logic)
- **Over-granular phases**: Creating sub-phases or custom phase numbers
