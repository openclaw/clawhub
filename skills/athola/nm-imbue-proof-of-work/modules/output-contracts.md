---
name: output-contracts
description: |
  Schema for output contracts that define what an agent
  must produce. Embedded in dispatch prompts to set
  evidence requirements before the agent starts work.
category: evidence-gating
---

# Output Contracts

An output contract specifies what an agent MUST produce
before its work is accepted.
Every contract is a YAML block embedded in the agent's
dispatch prompt.
The contract validator (FR-006) checks compliance on
the agent's findings file.

## Schema

```yaml
output_contract:
  # Sections the findings file MUST contain
  required_sections:
    - summary           # Brief overview of findings
    - detailed_findings # Full analysis with evidence
    - evidence          # Evidence log with [E1] tags

  # Minimum number of [EN] evidence citations
  min_evidence_count: 3

  # Files the agent MUST create (relative to workspace)
  expected_artifacts:
    - .coordination/agents/{agent-name}.findings.md

  # Maximum retries before escalating failure
  retry_budget: 2

  # Severity: how strictly the validator enforces
  # strict = reject any missing element
  # normal = reject missing sections + zero evidence
  # lenient = warn but accept (for exploratory work)
  strictness: normal
```

## Field Reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| required_sections | list[str] | yes | - | Section headings that must appear in findings |
| min_evidence_count | int | yes | - | Minimum `[EN]` tags in findings |
| expected_artifacts | list[str] | no | [] | Files that must exist after completion |
| retry_budget | int | no | 2 | Max retries on validation failure |
| strictness | enum | no | normal | strict / normal / lenient |

## Contract Templates

### Code Review Contract

```yaml
output_contract:
  required_sections:
    - summary
    - critical_issues
    - warnings
    - suggestions
    - evidence
  min_evidence_count: 5
  expected_artifacts:
    - .coordination/agents/reviewer.findings.md
  retry_budget: 2
  strictness: normal
```

### Audit Contract

```yaml
output_contract:
  required_sections:
    - summary
    - scope_analyzed
    - findings_by_severity
    - recommendations
    - evidence
  min_evidence_count: 8
  expected_artifacts:
    - .coordination/agents/auditor.findings.md
  retry_budget: 1
  strictness: strict
```

### Research Contract

```yaml
output_contract:
  required_sections:
    - summary
    - sources_consulted
    - key_findings
    - recommendations
  min_evidence_count: 3
  expected_artifacts: []
  retry_budget: 2
  strictness: lenient
```

## Embedding in Dispatch Prompts

Include the contract block at the END of the agent's
dispatch prompt, after the task description:

```markdown
## Your Task

[task description here]

## Output Contract

Your findings MUST follow this contract.
The validator will reject non-compliant output.

required_sections: summary, detailed_findings, evidence
min_evidence_count: 5
strictness: normal

Write your findings to:
  .coordination/agents/{your-name}.findings.md

Format each evidence citation as:
  [E1] Command: <command run>
       Output: <relevant output snippet>

If the validator rejects your output, you will receive
specific feedback about what is missing and get
{retry_budget} retry attempts.
```

## Validation Rules

The contract validator checks these rules in order:

1. **Section check**: Each `required_sections` entry
   must appear as a Markdown heading (## or ###) in the
   findings file.
   Case-insensitive, underscores treated as spaces.

2. **Evidence count**: Count occurrences of the pattern
   `\[E\d+\]` in the findings file.
   Must be >= `min_evidence_count`.

3. **Artifact check**: Each path in `expected_artifacts`
   must exist on disk.

4. **Zero-evidence gate**: If evidence count is 0,
   the output is ALWAYS rejected regardless of
   strictness level.

## Retry Protocol

When validation fails:

1. Validator produces a specific failure message listing
   every missing element.
2. Failure message is prepended to a retry prompt that
   includes the original task.
3. Agent retries with the specific feedback.
4. Retry count is tracked against `retry_budget`.
5. If budget exhausted, failure is escalated to the
   parent with the validation detail.

## Integration Points

- **imbue:proof-of-work**: Contracts extend the
  existing `[E1]`/`[E2]` evidence tag convention.
- **imbue:structured-output**: Findings file format
  aligns with structured deliverable templates.
- **plan-before-large-dispatch**: The dispatch plan
  table includes an "Output Contract" column.
