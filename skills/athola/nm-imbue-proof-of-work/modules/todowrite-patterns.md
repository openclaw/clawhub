---
name: todowrite-patterns
description: Naming conventions for TodoWrite items across imbue skills
parent_skill: imbue:shared
category: infrastructure
estimated_tokens: 150
reusable_by: [all imbue skills, pensive skills]
---

# TodoWrite Patterns

## Naming Convention

Pattern: `skill-name:step-name`

## Evidence Logging Steps

```
evidence-logging:log-initialized
evidence-logging:commands-captured
evidence-logging:citations-recorded
evidence-logging:artifacts-indexed
```

## Diff Analysis Steps

```
diff-analysis:context-established
diff-analysis:changes-categorized
diff-analysis:risks-assessed
diff-analysis:recommendations-formed
```

## Catchup Steps

```
catchup:scope-identified
catchup:changes-analyzed
catchup:summary-generated
```

## Review Core Steps

```
review-core:context-gathered
review-core:analysis-performed
review-core:findings-documented
review-core:report-assembled
```

## Task Deletion (Claude Code 2.1.20+)

TaskUpdate now supports deleting tasks. For imbue skills, **keep proof-of-work items** as audit trails — only delete transient tracking items from completed workflows.

> **2.1.21 fix**: Task IDs are no longer reused after deletion. On 2.1.20, deleting a task and creating a new one could silently reuse the same ID, leaking old state into new tasks. Upgrade to 2.1.21+ if using task deletion.

### Safe to Delete
- Transient workflow items after successful completion (e.g., `catchup:scope-identified` after catchup finishes)

### Never Delete
- `proof:*` items — these are audit evidence
- `evidence-logging:*` items — these document captured evidence
- Any items that serve as compliance records

## Best Practices

1. **Use lowercase** for both skill name and step name
2. **Use hyphens** to separate words
3. **Keep step names short** but descriptive
4. **Progress sequentially** through steps
5. **Mark complete immediately** after finishing step
