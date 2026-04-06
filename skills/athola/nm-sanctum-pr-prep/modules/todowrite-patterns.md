---
parent_skill: sanctum:shared
name: todowrite-patterns
description: TodoWrite naming conventions and patterns for sanctum skills
category: patterns
tags: [todowrite, naming, conventions]
estimated_tokens: 150
---

# TodoWrite Patterns for Sanctum

## Naming Convention
All sanctum skills follow a consistent pattern for TodoWrite items:
```
<skill-name>:<step-name>
```

The skill name matches the frontmatter `name` field, and the step name describes the specific workflow phase.

## Examples from Sanctum Skills

### git-workspace-review
```
git-review:repo-confirmed
git-review:status-overview
git-review:diff-stat
git-review:diff-details
```

### commit-messages
Commit messages skill does not use TodoWrite as it's a single-step artifact generation workflow.

### pr-prep
```
pr-prep:workspace-reviewed
pr-prep:quality-gates
pr-prep:self-reviewed
pr-prep:changes-summarized
pr-prep:testing-documented
pr-prep:pr-drafted
pr-prep:content-verified
```

### doc-updates
```
doc-updates:context-collected
doc-updates:targets-identified
doc-updates:consolidation-checked
doc-updates:edits-applied
doc-updates:guidelines-verified
doc-updates:accuracy-verified
doc-updates:preview
```

### version-updates
```
version-update:context-collected
version-update:target-files
version-update:version-set
version-update:docs-updated
version-update:verification
```

## Task Deletion (Claude Code 2.1.20+)

TaskUpdate now supports deleting tasks. Use deletion to clean up completed workflow items and reduce clutter in the `/tasks` view.

> **2.1.21 fix**: Task IDs are no longer reused after deletion. On 2.1.20, deleting a task and creating a new one could silently reuse the same ID, leaking old state into new tasks. Upgrade to 2.1.21+ if using task deletion.

### When to Delete
- After a workflow completes successfully and all items are marked done
- Stale items from interrupted or abandoned workflows
- Temporary tracking items that served their purpose

### When NOT to Delete
- Items that serve as audit trails (proof-of-work items)
- Items referenced by other active workflows
- Items the user may want to review later

### Deletion Pattern
```
# After workflow completion, clean up tracking items:
TaskUpdate(id: "pr-prep:workspace-reviewed", delete: true)
TaskUpdate(id: "pr-prep:quality-gates", delete: true)
```

### Recommended Approach
Create → Complete → (optionally) Delete stale items after workflow success. Keep proof-of-work and audit items intact.

## Best Practices

### Step Naming
- Use present tense verbs (collected, identified, applied, verified)
- Keep names concise (2-3 words max)
- Make the outcome clear from the name
- Order steps sequentially in the workflow

### When to Skip TodoWrite
- Single-step workflows (like commit-messages)
- Quick utilities that complete in one operation
- Read-only analysis with no discrete phases

### Integration
- Create all TodoWrite items at workflow start
- Mark items complete immediately after finishing each step
- Use TodoWrite as workflow documentation for users
