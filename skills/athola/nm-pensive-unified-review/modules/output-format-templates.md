---
name: output-format-templates
description: Standard output format templates for pensive review deliverables
parent_skill: pensive:shared
category: review-infrastructure
tags: [templates, output, formatting, structure]
reusable_by: [pensive:bug-review, pensive:api-review, pensive:architecture-review, pensive:test-review, pensive:rust-review, pensive:makefile-review, pensive:math-review, pensive:unified-review]
estimated_tokens: 350
---

# Output Format Templates

Standard templates for consistent review deliverables.

## Top-Level Structure

```markdown
# [Review Type] Review: [Subject]

## Executive Summary
[High-level overview, key findings count, overall assessment]

## Findings Summary
[Count by severity: Critical, High, Medium, Low]

## Detailed Findings
[Organized by category or severity]

## Action Items
[Prioritized, actionable recommendations]

## Evidence Appendix
[Supporting code snippets, references, measurements]
```

## Finding Entry Template

```markdown
### [Category]: [Short Title]

**Severity**: [Critical|High|Medium|Low]
**Location**: [File path:line numbers or component name]
**Category**: [Specific category from domain]

**Issue**:
[Clear description of what's wrong]

**Evidence**:
[Code snippet, measurement, or observation]

**Why This Matters**:
[The underlying principle or rule being violated.
Explain the concept, not just the symptom.]

**Proof**:
[Link to authoritative best-practice documentation.
Prefer: language docs, OWASP, PEPs, style guides,
RFCs. Summarize what the link teaches.]

**Teachable Moment**:
[How this lesson generalizes beyond this specific
finding. When else would this principle apply?]

**Recommendation**:
[Specific, actionable steps to resolve]

**References**: [Evidence appendix section or external docs]
```

### Educational Depth by Severity

| Severity | Why | Proof Link | Teachable Moment |
|----------|-----|------------|------------------|
| Critical | Required | Required | Required |
| High | Required | Required | Required |
| Medium | Required | If available | Optional |
| Low | Brief | Optional | Optional |

## Severity Definitions

**Critical**: Security vulnerability, data loss risk, system failure potential
**High**: Significant functionality issues, major violations, substantial technical debt
**Medium**: Moderate violations, code quality issues, maintainability concerns
**Low**: Minor style issues, optimization opportunities, documentation gaps

## Action Items Template

```markdown
## Action Items

### Immediate (Critical/High Severity)
1. [Action] - [Rationale] - [Reference to finding]
2. ...

### Short-term (Medium Severity)
1. [Action] - [Rationale] - [Reference to finding]
2. ...

### Long-term (Low Severity / Improvements)
1. [Action] - [Rationale] - [Reference to finding]
2. ...
```

## Evidence Appendix Template

```markdown
## Evidence Appendix

### E1: [Short Reference Name]
**Related to**: Finding [X]
**File**: `/path/to/file.ext:lines`

```[language]
[code snippet or measurement]
```

**Context**: [Why this evidence matters]

---

### E2: [Next Reference]
...
```

## Summary Statistics Template

```markdown
## Review Statistics

- **Total Items Reviewed**: [count]
- **Findings by Severity**:
  - Critical: [count]
  - High: [count]
  - Medium: [count]
  - Low: [count]
- **Categories Analyzed**: [list]
- **Recommendations**: [count]
```

## Usage Notes

1. Adapt section headings to domain (e.g., "Endpoints" for API, "Components" for architecture)
2. Always link findings to evidence
3. Keep Executive Summary under 5 sentences
4. validate every finding has actionable recommendation
5. Use consistent severity assessment across entire review
