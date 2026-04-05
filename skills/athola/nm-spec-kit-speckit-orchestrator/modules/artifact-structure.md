---
name: artifact-structure
description: Documentation of spec-kit artifact structure, purposes, and organization
category: reference
tags: [artifacts, structure, organization, documentation]
dependencies: [speckit-orchestrator]
complexity: beginner
estimated_tokens: 800
---

# Spec-Kit Artifact Structure

## Overview

Spec-kit uses a structured approach to organizing specification, planning, and implementation artifacts. This document defines the purpose and structure of each artifact type.

## Directory Structure

```
project-root/
├── .specify/                    # Spec-kit infrastructure
│   ├── scripts/                 # Workflow automation scripts
│   ├── templates/               # Artifact templates
│   └── memory/                  # Project context and constitution
│
└── specs/                       # Feature specifications
    └── {N}-{short-name}/        # Feature directory
        ├── spec.md              # What & Why (user-focused)
        ├── plan.md              # How (technical design)
        ├── tasks.md             # Implementation tasks
        ├── checklists/          # Quality validation checklists
        │   ├── requirements.md  # Spec quality validation
        │   ├── ux.md           # UX requirements validation
        │   ├── api.md          # API requirements validation
        │   └── security.md     # Security requirements validation
        ├── research.md          # Technical research & decisions
        ├── data-model.md        # Entity definitions
        ├── quickstart.md        # Test scenarios
        └── contracts/           # API contracts
            ├── openapi.yaml
            └── graphql/
```

> **Note: Claude Code Plan Mode Namespace**
>
> Claude Code's native Plan Mode (v2.0.51+) creates a `plan.md` file at the
> **project root** when users enter plan mode via `Shift+Tab` or `--permission-mode plan`.
> Spec-kit plans are intentionally stored in `specs/{feature}/plan.md` to avoid
> collision. When searching for scope artifacts:
> 1. Always check `specs/*/plan.md` first (spec-kit feature plans)
> 2. Then check root `plan.md` (may be Claude Plan Mode artifact)
>
> The two systems are complementary: Claude Plan Mode is for exploratory planning,
> while spec-kit plans are structured implementation blueprints.

## Core Artifacts

### spec.md - Feature Specification

**Purpose**: Define WHAT users need and WHY, without implementation details.

**Audience**: Business stakeholders, product managers, non-technical reviewers.

**Structure**:
```markdown
# Feature Name

## Overview
- Problem statement
- User value proposition

## User Scenarios
- Who uses it
- Primary flows
- User goals

## Functional Requirements
- What must it do (testable)
- Acceptance criteria

## Success Criteria
- Measurable outcomes
- Technology-agnostic metrics
- User-facing goals

## Success Criteria (Optional)
- Performance expectations
- Security considerations
- Accessibility needs

## Edge Cases (Optional)
- Boundary conditions
- Error scenarios
- Fallback behaviors

## Dependencies & Assumptions (Optional)
- External dependencies
- Documented assumptions
```

**Key Principles**:
- No technology choices (no "React", "PostgreSQL", "REST API")
- Focus on user value, not system internals
- Measurable, testable requirements
- Maximum 3 [NEEDS CLARIFICATION] markers

### plan.md - Implementation Plan

**Purpose**: Define HOW to build the feature technically.

**Audience**: Developers, technical leads, architects.

**Structure**:
```markdown
# Implementation Plan: Feature Name

## Technical Context
- Tech stack decisions
- Architecture choices
- Libraries and frameworks

## Constitution Check
- Alignment with project principles
- Gate evaluation

## Phase 0: Research
- Technical unknowns
- Best practices research
- Decision rationale

## Phase 1: Design
- Data model
- API contracts
- Integration points

## Phase 2: Implementation
- Component structure
- Service layer
- Infrastructure needs
```

**Key Principles**:
- Technology-specific
- Includes research and decisions
- Maps to project constitution
- Generates tasks.md

### tasks.md - Implementation Tasks

**Purpose**: Actionable, dependency-ordered tasks for implementation.

**Audience**: Developers executing the feature.

**Structure**:
```markdown
# Implementation Tasks: Feature Name

## Overview
- Total tasks
- Parallelization opportunities
- MVP scope

## Dependencies
- User story completion order
- Blocking prerequisites

## Phase 1: Setup
- [ ] T001 Project initialization
- [ ] T002 [P] Configure tooling

## Phase 2: Foundational
- [ ] T010 Shared infrastructure

## Phase 3: User Story 1 (P1)
- [ ] T020 [US1] Model creation
- [ ] T021 [P] [US1] Service implementation
- [ ] T022 [US1] Endpoint implementation

## Phase 4: User Story 2 (P2)
- [ ] T030 [US2] Feature implementation

## Final Phase: Polish
- [ ] T090 Cross-cutting concerns
- [ ] T091 Documentation
```

**Task Format**:
```
- [ ] [TaskID] [P?] [Story?] Description with file path
```

**Key Principles**:
- Organized by user story
- Sequential task IDs
- Clear parallelization markers [P]
- Story labels [US1], [US2], etc.
- Explicit file paths

### checklists/ - Quality Validation

**Purpose**: "Unit tests for requirements" - validate requirement quality.

**Audience**: Spec authors, reviewers, QA.

**Structure**: Multiple domain-specific checklists:
- `requirements.md` - Overall spec quality
- `ux.md` - UX requirements validation
- `api.md` - API requirements validation
- `security.md` - Security requirements validation
- `performance.md` - Performance requirements validation

**Checklist Item Format**:
```markdown
- [ ] CHK001 Are [requirements] defined for [scenario]? [Dimension, Reference]
```

**Key Principles**:
- Test requirements quality, NOT implementation
- Focus on completeness, clarity, consistency
- ≥80% traceability to spec sections
- Question format, not verification statements

## Supporting Artifacts

### research.md
Documents technical research, decisions, and alternatives considered during Phase 0.

### data-model.md
Defines entities, fields, relationships, validation rules, and state transitions.

### quickstart.md
Test scenarios and acceptance testing guides for the feature.

### contracts/
API contracts (OpenAPI, GraphQL schemas) generated from functional requirements.

## Workflow Progression

1. **Specify**: Create spec.md (user-focused, no tech)
2. **Clarify**: Resolve [NEEDS CLARIFICATION] markers
3. **Checklist**: Validate spec quality with requirements.md checklist
4. **Plan**: Create plan.md (technical design)
5. **Tasks**: Generate tasks.md (actionable implementation)
6. **Implement**: Execute tasks, mark complete
7. **Validate**: Domain-specific checklists (ux.md, api.md, etc.)

## Artifact Relationships

```
spec.md (WHAT/WHY)
    ↓
checklists/requirements.md (validate spec)
    ↓
plan.md (HOW)
    ↓
tasks.md (DO)
    ↓
checklists/[domain].md (validate implementation requirements)
```

## Usage in Commands

- `/speckit-specify` → Creates spec.md, checklists/requirements.md
- `/speckit-clarify` → Resolves [NEEDS CLARIFICATION] in spec.md
- `/speckit-plan` → Creates plan.md, research.md, data-model.md, contracts/
- `/speckit-tasks` → Generates tasks.md from plan.md + spec.md
- `/speckit-checklist` → Creates domain-specific checklists (ux.md, api.md, etc.)
- `/speckit-implement` → Executes tasks.md
- `/speckit-analyze` → Cross-artifact consistency validation
