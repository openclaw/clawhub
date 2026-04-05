---
name: findings-format
description: |
  Standard format for agent findings files written to
  .coordination/agents/. Enables selective synthesis
  where the parent reads summaries first.
category: coordination
---

# Agent Findings File Format

Every agent in a coordinated workflow writes its
findings to `.coordination/agents/{name}.findings.md`
using this format.

## Structure

```markdown
---
agent: {agent-name}
area: {codebase-area}
tier: {1|2|3}
evidence_count: {N}
validation_status: {PASS|FAIL|PENDING}
---

## Summary

{1-3 sentences: what was found, overall assessment}

## Detailed Findings

{Full analysis, organized by topic or severity}

[E1] Command: {command run}
     Output: {relevant output}

[E2] Command: {another command}
     Output: {relevant output}

## Evidence

{Evidence log referencing all [EN] tags above}

## Recommendations

{Concrete next steps, ordered by priority}
```

## Selective Synthesis Protocol

When the parent synthesizes multiple findings files:

1. Read ONLY the `## Summary` section from each file
2. Identify high-severity findings across summaries
3. Deep-dive into `## Detailed Findings` only for
   high-severity items
4. Reference raw files for full detail in the report
5. Never copy full findings into parent context

This keeps parent context overhead below 20% while
preserving 100% access to raw findings.

## Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| agent | str | yes | Agent name that produced these findings |
| area | str | no | Codebase area analyzed |
| tier | int | no | Audit tier (1, 2, or 3) |
| evidence_count | int | no | Number of [EN] tags in the file |
| validation_status | str | no | PASS, FAIL, or PENDING |
