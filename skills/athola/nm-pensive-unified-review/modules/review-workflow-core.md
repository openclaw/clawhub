---
name: review-workflow-core
description: Core workflow patterns for all pensive review skills
parent_skill: pensive:shared
category: review-infrastructure
tags: [workflow, core, review, patterns]
reusable_by: [pensive:bug-review, pensive:api-review, pensive:architecture-review, pensive:test-review, pensive:rust-review, pensive:makefile-review, pensive:math-review, pensive:unified-review]
estimated_tokens: 400
---

# Review Workflow Core

Standard 5-step workflow pattern for all pensive review skills.

## Workflow Structure

### Step 1: Context Establishment
**TodoWrite Item**: "Establishing review context"

Actions:
1. Identify review scope and boundaries
2. Gather relevant files and documentation
3. Establish success criteria
4. Load domain-specific patterns (if applicable)

**Output**: Context summary with scope definition

### Step 2: Scope Inventory
**TodoWrite Item**: "Creating scope inventory"

Actions:
1. Catalog all items to review (files, components, endpoints, etc.)
2. Categorize by type, complexity, or domain area
3. Prioritize based on risk, complexity, or impact
4. Create initial structure for findings

**Output**: Structured inventory with categories

### Step 3: Deep Analysis
**TodoWrite Item**: "Performing deep analysis"

Actions:
1. Apply domain-specific review criteria
2. Identify patterns, anti-patterns, violations
3. Assess severity (Critical, High, Medium, Low)
4. Cross-reference with best practices
5. Capture evidence for each finding

**Output**: Detailed findings with evidence

### Step 4: Evidence Capture
**TodoWrite Item**: "Capturing evidence"

Integration with `imbue:proof-of-work`:
1. Document code snippets with file paths and line numbers
2. Record reasoning chains for conclusions
3. Link findings to specific violations or patterns
4. Preserve context for future reference

**Output**: Evidence appendix linked to findings

### Step 5: Deliverable Assembly
**TodoWrite Item**: "Assembling final deliverable"

Actions:
1. Structure findings by severity and category
2. Format recommendations with actionable steps
3. Create prioritized action items
4. Validate completeness against exit criteria
5. Generate final output using templates

**Output**: Complete review deliverable

## TodoWrite Integration

Create tasks at workflow start:

```python
TodoWrite({
    "todos": [
        {"content": "Establish review context", "status": "pending", "activeForm": "Establishing review context"},
        {"content": "Create scope inventory", "status": "pending", "activeForm": "Creating scope inventory"},
        {"content": "Perform deep analysis", "status": "pending", "activeForm": "Performing deep analysis"},
        {"content": "Capture evidence", "status": "pending", "activeForm": "Capturing evidence"},
        {"content": "Assemble final deliverable", "status": "pending", "activeForm": "Assembling final deliverable"}
    ]
})
```

Mark each as `in_progress` when starting, `completed` when finished.

## Exit Criteria

Before marking workflow complete:
- [ ] All scope items analyzed
- [ ] Evidence captured for each finding
- [ ] Recommendations are actionable
- [ ] Output follows format templates
- [ ] Quality checklist satisfied
