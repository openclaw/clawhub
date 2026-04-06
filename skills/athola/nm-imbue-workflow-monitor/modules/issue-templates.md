# Issue Templates

Templates for creating GitHub issues from workflow monitoring findings.

## Template Selection

Select template based on issue type:

| Issue Type | Template | Labels |
|------------|----------|--------|
| Command failure | error-report | bug, workflow |
| Timeout | performance-issue | performance, workflow |
| Retry loop | flaky-workflow | bug, flaky |
| Efficiency issue | enhancement | enhancement, optimization |

## Error Report Template

```markdown
## Background

Detected during workflow execution on {{DATE}}.

**Source:** {{WORKFLOW_NAME}} session {{SESSION_ID}}
**Severity:** {{SEVERITY}}

## Problem

{{ERROR_DESCRIPTION}}

**Command:**
```
{{COMMAND}}
```

**Output:**
```
{{OUTPUT_EXCERPT}}
```

**Exit code:** {{EXIT_CODE}}

## Context

- Previous operation: {{PREVIOUS_OP}}
- Working directory: {{WORKING_DIR}}
- Environment factors: {{ENV_NOTES}}

## Suggested Fix

{{SUGGESTED_FIX}}

## Acceptance Criteria

- [ ] Error no longer occurs in similar conditions
- [ ] Tests added to catch regression
- [ ] Documentation updated if behavior changed

---
*Created by workflow-monitor*
```

## Performance Issue Template

```markdown
## Background

Performance issue detected on {{DATE}}.

**Source:** {{WORKFLOW_NAME}} session {{SESSION_ID}}
**Type:** {{ISSUE_TYPE}} (timeout / slow response / resource exhaustion)

## Problem

{{PERFORMANCE_DESCRIPTION}}

**Evidence:**
- Duration: {{DURATION}}
- Expected: {{EXPECTED_DURATION}}
- Resource usage: {{RESOURCE_NOTES}}

## Impact

{{IMPACT_DESCRIPTION}}

## Suggested Fix

{{SUGGESTED_FIX}}

## Acceptance Criteria

- [ ] Operation completes within expected time
- [ ] No resource exhaustion under normal conditions
- [ ] Performance test added

---
*Created by workflow-monitor*
```

## Flaky Workflow Template

```markdown
## Background

Flaky behavior detected on {{DATE}}.

**Source:** {{WORKFLOW_NAME}} session {{SESSION_ID}}
**Retry count:** {{RETRY_COUNT}}

## Problem

{{FLAKY_DESCRIPTION}}

**Retry pattern:**
```
{{RETRY_HISTORY}}
```

## Root Cause Analysis

{{ROOT_CAUSE_ANALYSIS}}

## Suggested Fix

{{SUGGESTED_FIX}}

## Acceptance Criteria

- [ ] Workflow succeeds reliably (>95% success rate)
- [ ] Flaky test quarantined or fixed
- [ ] Retry logic added if appropriate

---
*Created by workflow-monitor*
```

## Enhancement Template

```markdown
## Background

Efficiency improvement opportunity detected on {{DATE}}.

**Source:** {{WORKFLOW_NAME}} session {{SESSION_ID}}
**Efficiency score:** {{EFFICIENCY_SCORE}}

## Opportunity

{{ENHANCEMENT_DESCRIPTION}}

**Current behavior:**
{{CURRENT_BEHAVIOR}}

**Suggested improvement:**
{{SUGGESTED_IMPROVEMENT}}

## Impact

- Time saved: {{TIME_ESTIMATE}}
- Context saved: {{CONTEXT_ESTIMATE}}
- Complexity reduction: {{COMPLEXITY_NOTES}}

## Acceptance Criteria

- [ ] Improved behavior implemented
- [ ] No regression in functionality
- [ ] Documentation updated

---
*Created by workflow-monitor*
```

## Template Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `{{DATE}}` | System | ISO date of detection |
| `{{SESSION_ID}}` | Session | Claude session identifier |
| `{{WORKFLOW_NAME}}` | Context | Name of workflow being executed |
| `{{SEVERITY}}` | Analysis | Classified severity (high/medium/low) |
| `{{COMMAND}}` | Evidence | The command that was executed |
| `{{OUTPUT_EXCERPT}}` | Evidence | Relevant portion of output |
| `{{EXIT_CODE}}` | Evidence | Command exit code |
| `{{SUGGESTED_FIX}}` | Analysis | AI-generated fix suggestion |

## Usage

```python
def render_template(template: str, variables: dict) -> str:
    """Replace template variables with values."""
    result = template
    for key, value in variables.items():
        placeholder = f"{{{{{key}}}}}"
        result = result.replace(placeholder, str(value))
    return result
```

## Duplicate Detection

Before creating an issue, check for duplicates:

```bash
# Search for similar issues
gh issue list --state all --search "{{COMMAND}} OR {{ERROR_EXCERPT}}" --json title,number,state

# Check if recent issue exists
gh issue list --state open --label workflow --json title,createdAt | \
  jq '[.[] | select(.createdAt > "'"$(date -d '7 days ago' -Iseconds)"'")]'
```

## Rate Limiting

- Maximum 5 issues per session
- Minimum 10 minutes between issue creation
- Require user confirmation unless `auto_create_issues: true`
