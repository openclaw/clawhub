---
name: project-specification
description: |
  Transform project briefs into testable specifications with user stories, acceptance criteria, and measurable outcomes
version: 1.8.1
triggers:
  - specification
  - requirements
  - acceptance-criteria
  - spec-driven-development
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/attune", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: attune
---

> **Night Market Skill** — ported from [claude-night-market/attune](https://github.com/athola/claude-night-market/tree/master/plugins/attune). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [When to Use](#when-to-use)
- [Integration](#integration)
- [Specification Structure](#specification-structure)
- [1. Overview Section](#1-overview-section)
- [2. Functional Requirements (FR-XXX)](#2-functional-requirements-(fr-xxx))
- [FR-001: [Requirement Name]](#fr-001:-[requirement-name])
- [3. Non-Functional Requirements (NFR-XXX)](#3-non-functional-requirements-(nfr-xxx))
- [NFR-001: [Category] - [Requirement]](#nfr-001:-[category]---[requirement])
- [4. Technical Constraints](#4-technical-constraints)
- [5. Out of Scope](#5-out-of-scope)
- [Out of Scope (v1.0)](#out-of-scope-(v10))
- [Clarification Workflow](#clarification-workflow)
- [Ambiguity Detection](#ambiguity-detection)
- [Question Generation](#question-generation)
- [Clarification Session](#clarification-session)
- [Quality Checks](#quality-checks)
- [Output Format](#output-format)
- [Change History](#change-history)
- [Overview](#overview)
- [Functional Requirements](#functional-requirements)
- [Non-Functional Requirements](#non-functional-requirements)
- [Technical Constraints](#technical-constraints)
- [Out of Scope](#out-of-scope)
- [Dependencies](#dependencies)
- [Acceptance Testing Strategy](#acceptance-testing-strategy)
- [Success Criteria](#success-criteria)
- [Glossary](#glossary)
- [References](#references)
- [Acceptance Criteria Patterns](#acceptance-criteria-patterns)
- [Given-When-Then](#given-when-then)
- [Error Cases](#error-cases)
- [Performance Criteria](#performance-criteria)
- [Security Criteria](#security-criteria)
- [Related Skills](#related-skills)
- [Related Commands](#related-commands)
- [Examples](#examples)


# Project Specification Skill

Transform project briefs into structured, testable specifications with acceptance criteria.

## Delegation

For detailed specification writing workflows, this skill delegates to `spec-kit:spec-writing` as the canonical implementation. Use this skill for quick specification needs; use spec-kit for comprehensive specification documents.

## When To Use

- After brainstorming phase completes
- Have project brief but need detailed requirements
- Need testable acceptance criteria for implementation
- Planning validation and testing strategy
- Translating business requirements into technical specs
- Defining scope boundaries and out-of-scope items

## When NOT To Use

- Still exploring problem space (use `Skill(attune:project-brainstorming)` instead)
- Already have detailed specification (use `Skill(attune:project-planning)` instead)
- Refining existing implementation (use code review skills)
- Making strategic decisions (use `Skill(attune:war-room)` for complex choices)

## Integration

**With spec-kit**:
- Delegates to `Skill(spec-kit:spec-writing)` for methodology
- Uses spec-kit templates and validation
- Enables clarification workflow

**Without spec-kit**:
- Standalone specification framework
- Requirement templates
- Acceptance criteria patterns

## Specification Structure

### 1. Overview Section

- **Purpose**: What the project achieves (1-2 sentences)
- **Scope**: IN/OUT boundaries
- **Stakeholders**: Who cares and why

### 2. Functional Requirements (FR-XXX)

**Format per requirement**:
```markdown
### FR-001: [Requirement Name]

**Description**: Clear, unambiguous description

**Acceptance Criteria**:
- [ ] Given [context], when [action], then [expected result]
- [ ] Given [context], when [action], then [expected result]

**Priority**: High | Medium | Low
**Dependencies**: FR-002, FR-005
**Estimated Effort**: S | M | L | XL
```
**Verification:** Run the command with `--help` flag to verify availability.

**Validation Rules**:
- Description has no ambiguous words (might, could, maybe, probably)
- At least 2 acceptance criteria (happy path + error case)
- Criteria use Given-When-Then format
- Criteria are testable (observable outcomes)
- Dependencies are explicit

### 3. Non-Functional Requirements (NFR-XXX)

**Categories**:
- **Performance**: Response times, throughput, resource limits
- **Security**: Authentication, authorization, data protection, compliance
- **Reliability**: Uptime, error handling, recovery, fault tolerance
- **Usability**: UX requirements, accessibility, documentation
- **Maintainability**: Code quality, testing, observability

**Format**:
```markdown
### NFR-001: [Category] - [Requirement]

**Requirement**: [Specific, measurable requirement]

**Measurement**: [How to verify]
- Metric: [What to measure]
- Target: [Specific threshold]
- Tool: [How to measure]

**Priority**: Critical | High | Medium | Low
```
**Verification:** Run the command with `--help` flag to verify availability.

### 4. Technical Constraints

- Technology stack selections with rationale
- Integration requirements
- Data requirements (schema, migrations)
- Deployment constraints
- Regulatory/compliance requirements

### 5. Out of Scope

**Explicit exclusions** to prevent scope creep:
```markdown
## Out of Scope (v1.0)

- [Feature explicitly NOT included]
- [Capability deferred to later version]
- [Integration not planned]

**Rationale**: [Why these are excluded]
```

### 5.1. Backlog Issue Creation (MANDATORY)

After writing the Out of Scope section, create a GitHub
issue for each deferred item so it is tracked in the
backlog. This prevents good ideas from being lost in
spec documents nobody re-reads.

```bash
# For each out-of-scope item:
gh issue create \
  --title "[Backlog] <feature>: <brief description>" \
  --body "## Context
Identified during specification of <project>.
Spec: <path-to-spec>

## Description
<what the item is and why it was deferred>

## References
<links to spec section, related issues>" \
  --label "feature,low-priority"
```

Report created issues in the spec under Out of Scope:

```markdown
## Out of Scope (v1.0)

- Codex session format (#332)
- SVG/MP4/WebM output (#333)
- Interactive session picker (#334)
```

**Skip conditions:**
- `--no-auto-issues` flag passed
- Item is trivially small (one-line change)
- Item already exists as a GitHub issue

## Clarification Workflow

### Ambiguity Detection

Scan specification for:
- Vague quantifiers (many, few, several, most)
- Ambiguous terms (user-friendly, fast, scalable)
- Missing dependencies
- Untestable criteria
- Conflicting requirements

### Question Generation

For each ambiguity:
```markdown
**Question [N]**: [Reference to FR/NFR]

**Ambiguity**: [What is unclear]

**Impact**: [Why this matters]

**Options**:
- Option A: [Interpretation 1]
- Option B: [Interpretation 2]

**Recommendation**: [Preferred option with rationale]
```
**Verification:** Run the command with `--help` flag to verify availability.

### Clarification Session

Run interactive Q&A:
1. Present all questions
2. Gather stakeholder responses
3. Update specification
4. Re-validate for new ambiguities
5. Iterate until clear

## Quality Checks

Before completing specification:

- ✅ All requirements have unique IDs (FR-XXX, NFR-XXX)
- ✅ All functional requirements have ≥2 acceptance criteria
- ✅ All criteria use Given-When-Then format
- ✅ No ambiguous language detected
- ✅ Dependencies documented
- ✅ Effort estimates provided
- ✅ Out of scope explicitly stated
- ✅ Success criteria defined

## Output Format

Save to `docs/specification.md`:

```markdown
# [Project Name] - Specification v[version]

**Author**: [Name]
**Date**: [YYYY-MM-DD]
**Status**: Draft | Review | Approved | Implemented

## Change History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | 2026-01-02 | Alex | Initial draft |

## Overview

**Purpose**: [1-2 sentence purpose]

**Scope**:
- **IN**: [What's included]
- **OUT**: [What's excluded]

**Stakeholders**:
- [Stakeholder 1]: [Their interest]
- [Stakeholder 2]: [Their interest]

## Functional Requirements

[FR-XXX sections]

## Non-Functional Requirements

[NFR-XXX sections]

## Technical Constraints

[Technology, integration, data, deployment]

## Out of Scope

[Explicit exclusions with rationale]

## Dependencies

[External dependencies, third-party services]

## Acceptance Testing Strategy

[How requirements will be validated]

## Success Criteria

- [ ] [Measurable success indicator 1]
- [ ] [Measurable success indicator 2]

## Glossary

[Domain terms and definitions]

## References

[Related documents, research, prior art]
```
**Verification:** Run `pytest -v` to verify tests pass.

## Acceptance Criteria Patterns

### Given-When-Then

```markdown
Given [initial context/state]
When [action occurs]
Then [expected outcome]
```
**Verification:** Run the command with `--help` flag to verify availability.

**Examples**:
- Given unauthenticated user, when accessing dashboard, then redirect to login
- Given valid credentials, when logging in, then create session and redirect to dashboard
- Given expired session, when making API request, then return 401 Unauthorized

### Error Cases

Always include error scenarios:
- Invalid input handling
- Authentication/authorization failures
- Network/service failures
- Resource exhaustion
- Edge cases and boundaries

### Performance Criteria

Make performance requirements testable:
- "Dashboard loads in < 2 seconds" (measurable)
- NOT "Dashboard is fast" (vague)

### Security Criteria

Make security requirements verifiable:
- "All API endpoints require authentication" (testable)
- NOT "System is secure" (vague)

## Post-Completion: Workflow Continuation (REQUIRED)

**Automatic Trigger**: After Quality Checks pass and `docs/specification.md` is saved, MUST auto-invoke the next phase.

**When continuation is invoked**:
1. Verify `docs/specification.md` exists and is non-empty
2. Display checkpoint message to user:
   ```
   Specification complete. Saved to docs/specification.md.
   Proceeding to planning phase...
   ```
3. Invoke next phase:
   ```
   Skill(attune:project-planning)
   ```

**Bypass Conditions** (ONLY skip continuation if ANY true):
- `--standalone` flag was provided by the user
- `docs/specification.md` does not exist or is empty (phase failed)
- User explicitly requests to stop after specification

**Do NOT prompt the user for confirmation** — this is a lightweight checkpoint, not an interactive gate. The user can always interrupt if needed.

## Related Skills

- `Skill(spec-kit:spec-writing)` - Spec-kit methodology (if available)
- `Skill(attune:project-brainstorming)` - Previous phase
- `Skill(attune:project-planning)` - **AUTO-INVOKED** next phase after specification
- `Skill(attune:mission-orchestrator)` - Full lifecycle orchestration

## Related Commands

- `/attune:specify` - Invoke this skill
- `/attune:specify --clarify` - Run clarification workflow
- `/attune:blueprint` - Next step in workflow

## Examples

See `/attune:specify` command documentation for complete examples.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
