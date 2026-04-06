---
name: decisions
description: Autonomous decision-making framework
category: orchestration
---

# Decisions Module

Defines how the egregore orchestrator makes autonomous
decisions, logs them for auditability, and avoids blocking
on ambiguity.

## Decision Principles

The orchestrator follows three core principles when facing
a choice:

### 1. Prefer the simpler option

When two approaches could work, choose the one with fewer
moving parts, fewer dependencies, and less surface area for
failure.
Simpler solutions are easier to review, easier to revert,
and faster to ship.

### 2. Log the rationale

Every decision must be recorded in the manifest with enough
context for a human reviewer to understand why the choice
was made.
The log is the audit trail that makes autonomous operation
trustworthy.

### 3. Never block

The orchestrator must never pause and wait for human input.
If requirements are ambiguous, make the conservative choice
and document the assumption.
A shipped PR with a documented assumption is more useful
than a stalled pipeline waiting for clarification.

## Decision Log Format

Decisions are recorded on the work item via
`manifest.record_decision()`:

```json
{
  "step": "intake/validate",
  "chose": "interpret-as-bug-fix",
  "why": "Issue title says 'fix' and label is 'bug'. Body is ambiguous about scope but the referenced file path narrows it to a single module."
}
```

**Fields:**

- **step**: the pipeline stage/step where the decision was
  made, in `"stage/step"` format.
- **chose**: a short identifier for the chosen option.
  Use kebab-case. Keep it under 40 characters.
- **why**: a one-to-three sentence explanation of the
  reasoning. Reference concrete evidence (labels, file
  paths, word counts, config values).

## When to Record a Decision

Record a decision whenever the orchestrator:

- Skips a step (e.g., brainstorm skip, prioritize skip,
  merge skip).
- Chooses between two valid approaches during a skill
  invocation.
- Interprets ambiguous requirements in a specific way.
- Falls back to a simpler strategy on a retry attempt.
- Ignores a non-blocking warning or lint issue.

Do not record trivial operational facts (e.g., "loaded
manifest successfully").
The decision log is for choices, not events.

## Examples

### Skipping brainstorm for a well-defined issue

```json
{
  "step": "build/brainstorm",
  "chose": "skip-brainstorm",
  "why": "Source is github-issue #42, body has 250 words, labels include 'bug'. Config skip_brainstorm_for_issues is true."
}
```

### Choosing a simpler implementation approach

```json
{
  "step": "build/execute",
  "chose": "inline-helper-over-new-module",
  "why": "The helper function is 15 lines. Creating a separate module would add import overhead and a new test file for minimal reuse benefit."
}
```

### Interpreting ambiguous scope

```json
{
  "step": "intake/validate",
  "chose": "narrow-scope-to-api-layer",
  "why": "Issue mentions both API and CLI but only the API endpoint is referenced in the reproduction steps. Narrowing to API only to avoid unbounded scope."
}
```

### Falling back on retry

```json
{
  "step": "quality/code-review",
  "chose": "skip-lint-warning-on-retry",
  "why": "Attempt 2 of 3. Previous attempt failed on a style lint warning in generated code. Skipping the warning since the generated file is not hand-maintained."
}
```

## Decision Review

Decisions are visible in two places:

1. **Manifest**: each work item's `decisions` array contains
   the full log. Inspect with:
   ```bash
   cat .egregore/manifest.json | jq '.work_items[0].decisions'
   ```
2. **PR body**: the `prepare-pr` step includes a summary of
   key decisions in the PR description so reviewers
   understand the autonomous choices that were made.
