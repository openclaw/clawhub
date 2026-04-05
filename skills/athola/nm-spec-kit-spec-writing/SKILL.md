---
name: spec-writing
description: |
  Create clear, testable specifications from feature descriptions with user stories, acceptance criteria, and success metrics
version: 1.8.1
triggers:
  - speckit
  - specification
  - requirements
  - user-stories
  - acceptance-criteria
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/spec-kit", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.superpowers:brainstorming"]}}}
source: claude-night-market
source_plugin: spec-kit
---

> **Night Market Skill** — ported from [claude-night-market/spec-kit](https://github.com/athola/claude-night-market/tree/master/plugins/spec-kit). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Spec Writing

## Overview

Create clear, complete, and testable specifications from natural language feature descriptions. Specifications focus on user value and business needs, avoiding implementation details.

## When To Use

- Creating new feature specifications
- Refining existing specifications
- Writing user stories and acceptance criteria
- Defining success criteria

## When NOT To Use

- Generating implementation tasks - use task-planning

## Core Principles

Focus on user value and business needs rather than implementation details. Avoid specifying technology choices in requirement definitions unless strictly necessary. Ensure every requirement is testable and verifiable with measurable criteria. Limit clarification markers; make informed assumptions based on industry standards and document them explicitly.

## Specification Structure

### Mandatory Sections
1. **Overview/Context**: What problem does this solve?
2. **User Scenarios**: Who uses it and how?
3. **Functional Requirements**: What must it do?
4. **Success Criteria**: How do we know it works?

### Optional Sections
- Success Criteria (when performance/security critical)
- Edge Cases (when special handling needed)
- Dependencies (when external systems involved)
- Assumptions (when decisions made with incomplete info)

**See**: `modules/specification-structure.md` for detailed templates and guidelines

## Quality Checklist

- [ ] No implementation details present
- [ ] Requirements are testable and unambiguous
- [ ] Success criteria are measurable
- [ ] User scenarios cover primary flows
- [ ] Edge cases identified
- [ ] Scope clearly bounded

## Success Criteria Quick Reference

### Good (User-focused, Measurable, Technology-agnostic)
- "Users complete checkout in under 3 minutes"
- "System supports 10,000 concurrent users"
- "95% of searches return results in under 1 second"

### Bad (Implementation-focused, Internal metrics)
- "API response time under 200ms" -> Use: "Pages load in under 2 seconds"
- "Redis cache hit rate above 80%" -> Use: "Frequently accessed data loads with no noticeable delay"
- "React components render efficiently" -> Use: "UI updates appear with no visible frame drops"

**See**: `modules/success-criteria-patterns.md` for detailed examples and conversion process

## Related Skills

- `speckit-orchestrator`: Workflow coordination
- `task-planning`: Converting specs to tasks
## Troubleshooting

### Common Issues

If specifications are too vague, use the `success-criteria-patterns` module to enforce measurable outcomes. If implementation details leak into specs, review against the "Core Principles" and refactor to focus on user behavior.
