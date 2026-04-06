---
name: escalation-criteria
description: |
  Defines when and why to escalate between audit tiers.
  Tier 1 (git history) -> Tier 2 (targeted area) ->
  Tier 3 (full codebase).
category: audit-scoping
---

# Escalation Criteria

Audit tiers escalate based on evidence from the
previous tier, not by default.
Each escalation requires documented justification.

## Tier 1 -> Tier 2 Escalation

Tier 1 (git-history analysis) flags areas for Tier 2
when ANY of these criteria are met:

### Churn Hotspots

- **3+ files** in the same module changed in the
  analyzed commit range
- **AND** at least one file changed more than twice
- Indicates active development area worth deeper review

### Fix-on-Fix Patterns

- A commit that fixes a previous fix within the same
  module (commit messages containing "fix", "revert",
  "patch", "hotfix" targeting the same files)
- Indicates instability or insufficient testing

### Large Diffs

- Any single commit touching **200+ lines** in one
  module
- Large changes are statistically more likely to
  contain defects

### Suspicious Patterns

- Reverted commits (indicates something went wrong)
- Commits with no tests added alongside implementation
  changes
- Force-pushed branches affecting the module

### New File Clusters

- **5+ new files** added to a single module in the
  analyzed range
- Indicates new feature work that may lack review
  coverage

## Tier 2 -> Tier 3 Escalation

Tier 2 (targeted area audit) recommends Tier 3 when
ANY of these criteria are met:

### Cross-Cutting Concerns

- Findings in one area reveal issues that likely
  affect other areas (e.g., a shared utility function
  with a bug, a pattern used across modules)

### Architectural Issues

- Tier 2 findings indicate structural problems
  (circular dependencies, layering violations,
  inconsistent patterns across modules)

### Coverage Gaps

- Tier 2 reveals that the flagged area is
  representative of a broader pattern (e.g., all
  plugins share the same anti-pattern)

### Severity Threshold

- Tier 2 finds **3+ critical-severity issues** in
  a single area, suggesting systemic quality problems

## Tier 3 Gate

Tier 3 (full codebase audit) requires:

1. **Documented justification** from Tier 2 findings
2. **Explicit user approval** before proceeding
3. **Recommended execution mode**: dedicated sessions
   (not subagents), one area at a time, sequential

The system MUST present the justification and wait for
confirmation.
It MUST NOT auto-escalate to Tier 3.

## Escalation Log Format

Every escalation records:

```markdown
## Escalation: Tier {N} -> Tier {N+1}

**Date**: {timestamp}
**From tier**: {N}
**To tier**: {N+1}
**Target areas**: {list of modules/directories}

### Triggering Evidence

{specific findings from the previous tier that
triggered this escalation, with evidence tags}

### Justification

{why this escalation is warranted, referencing
the criteria above}
```

## No-Escalation Path

When Tier 1 finds NO flags:

- Audit completes at Tier 1
- Summary reports "no areas flagged for deeper review"
- No Tier 2 is triggered
- This is the expected happy path for stable codebases
