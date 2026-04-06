---
name: checklist-dimensions
description: Quality validation dimensions for requirements - how to write "unit tests for English"
category: quality
tags: [quality, validation, requirements, checklist]
dependencies: [spec-writing]
complexity: beginner
estimated_tokens: 600
---

# Checklist Quality Dimensions

## Overview

Checklists are **unit tests for requirements writing** - they validate the quality, clarity, and completeness of requirements in a given domain, NOT implementation correctness.

## Core Principle

**Test the Requirements, Not the Implementation**

Every checklist item MUST evaluate the REQUIREMENTS THEMSELVES, not whether code works correctly.

### What Checklists Are NOT

- NOT "Verify the button clicks correctly"
- NOT "Test error handling works"
- NOT "Confirm the API returns 200"
- NOT checking if code/implementation matches the spec

### What Checklists ARE

- "Are visual hierarchy requirements defined for all card types?" (completeness)
- "Is 'prominent display' quantified with specific sizing/positioning?" (clarity)
- "Are hover state requirements consistent across all interactive elements?" (consistency)
- "Are accessibility requirements defined for keyboard navigation?" (coverage)
- "Does the spec define what happens when logo image fails to load?" (edge cases)

## Quality Dimensions

### 1. Completeness
**Question**: Are all necessary requirements present?

Pattern: "Are [requirement type] defined/documented for [scenario]?"

Examples:
- "Are error handling requirements defined for all API failure modes? [Gap]"
- "Are accessibility requirements specified for all interactive elements? [Completeness]"
- "Are mobile breakpoint requirements defined for responsive layouts? [Gap]"

### 2. Clarity
**Question**: Are requirements unambiguous and specific?

Pattern: "Is [vague term] quantified/clarified with specific criteria?"

Examples:
- "Is 'fast loading' quantified with specific timing thresholds? [Clarity, Spec §NFR-2]"
- "Are 'related episodes' selection criteria explicitly defined? [Clarity, Spec §FR-5]"
- "Is 'prominent' defined with measurable visual properties? [Ambiguity, Spec §FR-4]"

### 3. Consistency
**Question**: Do requirements align without conflicts?

Pattern: "Are requirements consistent between [section A] and [section B]?"

Examples:
- "Do navigation requirements align across all pages? [Consistency, Spec §FR-10]"
- "Are card component requirements consistent between landing and detail pages? [Consistency]"

### 4. Measurability
**Question**: Can requirements be objectively verified?

Pattern: "Can [requirement] be objectively measured/verified?"

Examples:
- "Are visual hierarchy requirements measurable/testable? [Acceptance Criteria, Spec §FR-1]"
- "Can 'balanced visual weight' be objectively verified? [Measurability, Spec §FR-2]"

### 5. Coverage
**Question**: Are all scenarios/edge cases addressed?

Pattern: "Are requirements defined for [scenario class]?"

Examples:
- "Are requirements defined for zero-state scenarios (no episodes)? [Coverage, Edge Case]"
- "Are concurrent user interaction scenarios addressed? [Coverage, Gap]"
- "Are requirements specified for partial data loading failures? [Coverage, Exception Flow]"

### 6. Edge Cases
**Question**: Are boundary conditions and error scenarios defined?

Pattern: "Is default behavior specified when [edge condition]?"

Examples:
- "Is default behavior defined when images fail to load? [Edge Case, Gap]"
- "Are rollback requirements defined for migration failures? [Gap]"
- "Are requirements specified for partial data loading? [Coverage, Exception Flow]"

### 7. Success Criteria
**Question**: Are quality attributes specified (performance, security, accessibility)?

Pattern: "Are [success criteria type] requirements quantified/specified?"

Examples:
- "Are performance requirements quantified with specific metrics? [Clarity]"
- "Are security requirements defined for sensitive data? [Completeness]"
- "Are accessibility requirements specified for keyboard navigation? [Gap]"

## Item Structure

Each checklist item should follow this pattern:

```
- [ ] CHK### Question format asking about requirement quality [Dimension, Reference]
```

Components:
- **Question format**: Asks about what's WRITTEN (or not written) in requirements
- **Quality dimension**: [Completeness/Clarity/Consistency/Coverage/Measurability/Edge Case/Success Criteria]
- **Reference**: [Spec §X.Y] for existing requirements, [Gap] for missing ones

## Traceability Requirements

- MINIMUM: ≥80% of items MUST include at least one traceability reference
- References: `[Spec §X.Y]`, `[Gap]`, `[Ambiguity]`, `[Conflict]`, `[Assumption]`
- If no ID system exists: "Is a requirement & acceptance criteria ID scheme established? [Traceability]"

## Prohibited Patterns

These patterns test implementation, not requirements:

- Any item starting with "Verify", "Test", "Confirm", "Check" + implementation behavior
- References to code execution, user actions, system behavior
- "Displays correctly", "works properly", "functions as expected"
- "Click", "navigate", "render", "load", "execute"
- Test cases, test plans, QA procedures
- Implementation details (frameworks, APIs, algorithms)

## Required Patterns

These patterns test requirements quality:

- "Are [requirement type] defined/specified/documented for [scenario]?"
- "Is [vague term] quantified/clarified with specific criteria?"
- "Are requirements consistent between [section A] and [section B]?"
- "Can [requirement] be objectively measured/verified?"
- "Are [edge cases/scenarios] addressed in requirements?"
- "Does the spec define [missing aspect]?"
