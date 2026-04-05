---
name: quality-checklist-patterns
description: Reusable quality checklist patterns for review validation
parent_skill: pensive:shared
category: review-infrastructure
tags: [quality, checklist, validation, completeness]
reusable_by: [pensive:bug-review, pensive:api-review, pensive:architecture-review, pensive:test-review, pensive:rust-review, pensive:makefile-review, pensive:math-review, pensive:unified-review]
estimated_tokens: 300
---

# Quality Checklist Patterns

Standard quality assurance checklists for review deliverables.

## Pre-Review Checklist

Execute before starting analysis:

- [ ] Scope clearly defined and documented
- [ ] Review criteria identified (use domain-specific patterns)
- [ ] Success criteria established
- [ ] Evidence logging strategy prepared
- [ ] Output template selected and customized

## Analysis Quality Checklist

Execute during deep analysis phase:

- [ ] All scope items examined
- [ ] Domain-specific criteria applied consistently
- [ ] Severity assessed using standard definitions
- [ ] Patterns and anti-patterns identified
- [ ] Cross-references validated
- [ ] Edge cases considered

## Evidence Quality Checklist

Execute during evidence capture:

- [ ] Every finding has supporting evidence
- [ ] File paths and line numbers included
- [ ] Code snippets are minimal and focused
- [ ] Context preserved for each evidence item
- [ ] Evidence appendix organized and referenced
- [ ] Reasoning chains documented

## Deliverable Completeness Checklist

Execute before finalizing output:

- [ ] Executive summary present and concise
- [ ] All findings documented with required fields:
  - [ ] Severity assigned
  - [ ] Location specified
  - [ ] Category identified
  - [ ] Issue described
  - [ ] Evidence provided
  - [ ] Impact explained
  - [ ] Recommendation actionable
- [ ] Action items prioritized by severity
- [ ] Evidence appendix complete
- [ ] Summary statistics included
- [ ] Output follows template structure

## Recommendation Quality Checklist

Execute for each recommendation:

- [ ] Specific and actionable
- [ ] Addresses root cause, not just symptoms
- [ ] Feasible within project constraints
- [ ] Prioritized appropriately
- [ ] Linked to finding
- [ ] Includes rationale

## Review Consistency Checklist

Execute before final delivery:

- [ ] Severity levels applied consistently
- [ ] Terminology used consistently
- [ ] Categories align with domain standards
- [ ] Similar issues grouped appropriately
- [ ] No contradictory recommendations
- [ ] Style and tone professional throughout

## Exit Criteria Validation

Final check before completion:

- [ ] All TodoWrite items marked complete
- [ ] Workflow steps executed in sequence
- [ ] Quality checklists satisfied
- [ ] Output validated against template
- [ ] Evidence complete and linked
- [ ] Deliverable ready for stakeholder review

## Usage Pattern

Integrate into Step 5 (Deliverable Assembly) of review workflow:

```python
# Before marking final todo as complete
print("Validating deliverable quality...")
# Run through Deliverable Completeness Checklist
# Run through Review Consistency Checklist
# Run through Exit Criteria Validation
# Only then mark todo complete
```

## Customization

Domain-specific reviews may extend these checklists with:
- Additional domain criteria (e.g., security-specific checks)
- Tool-specific validation (e.g., linter results)
- Compliance requirements (e.g., regulatory standards)

Extend, don't replace, these baseline checklists.
