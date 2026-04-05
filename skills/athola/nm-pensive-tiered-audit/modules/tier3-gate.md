---
name: tier3-gate
description: |
  Gate for Tier 3 full-codebase audit. Requires explicit
  user approval and recommends dedicated sessions.
category: audit
---

# Tier 3: Full Codebase Audit Gate

Tier 3 is the most expensive audit tier.
It MUST NOT run without explicit user approval.

## Gate Protocol

When Tier 2 findings indicate Tier 3 is warranted:

1. Present the justification to the user:

```markdown
## Tier 3 Escalation Recommended

Tier 2 findings suggest a full codebase audit is
warranted.

### Justification

{specific Tier 2 findings that triggered this}

### Areas Already Reviewed (Tier 2)

{list of areas already audited}

### Estimated Scope

{number of remaining areas / files}

### Recommended Approach

- Use dedicated sessions (one per area)
- Process areas sequentially
- Coordinate via .coordination/ files
- Do NOT use parallel subagents

Proceed with Tier 3? [requires explicit yes]
```

2. Wait for user confirmation
3. If approved, execute with dedicated sessions
4. If declined, finalize with Tier 2 findings

## Execution Mode

Tier 3 MUST use dedicated sessions because:

- Full codebase analysis fills context windows quickly
- Parallel subagents would degrade quality
  (the exact problem this system solves)
- Dedicated sessions get full context windows with
  no completion pressure
- File-based coordination preserves all findings

## Output

Each area produces findings in the standard format:
`.coordination/agents/tier3-{area-slug}.findings.md`

Final synthesis reads all findings files and produces
a comprehensive report.
