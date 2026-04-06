---
name: tier2-targeted
description: |
  Tier 2 targeted area audit. Deep-dives into areas
  flagged by Tier 1, one area at a time, sequential.
category: audit
---

# Tier 2: Targeted Area Audit

Runs ONLY for areas flagged by Tier 1 escalation.
Each area is audited sequentially, never in parallel.

## Execution Protocol

For each flagged area in the escalation list:

1. Load the area context from plugin CLAUDE.md and
   skill descriptions
2. Read source files in the area
3. Analyze for:
   - Code quality patterns and anti-patterns
   - Test coverage (do tests exist for this code?)
   - Documentation currency (do docs match the code?)
   - Architectural fit (does this follow project
     conventions?)
4. Write findings to
   `.coordination/agents/tier2-{area-slug}.findings.md`
5. Validate findings against the Tier 2 output contract
6. Move to next area

## Output Contract (Tier 2)

```yaml
output_contract:
  required_sections:
    - summary
    - scope_analyzed
    - findings_by_severity
    - recommendations
    - evidence
  min_evidence_count: 8
  expected_artifacts: []
  retry_budget: 1
  strictness: strict
```

Tier 2 uses strict mode because it reads source files
and should produce thorough, evidence-backed analysis.

## Sequential Execution

Areas are processed one at a time because:

- Each area analysis fills a significant portion of
  the agent's context
- Sequential processing prevents context cross-
  contamination between areas
- The coordinator can review each area's findings
  before proceeding to the next
- If early areas reveal the issue is resolved, later
  areas can be skipped

## Escalation to Tier 3

After all Tier 2 areas are audited, check whether
Tier 3 is warranted per `escalation-criteria.md`.
If so, present justification to the user and wait
for explicit approval.
