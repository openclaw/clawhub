# Phase 4: Quality Gates

Code review between task batches to catch issues early.

## Batch Code Review

After parallel batch completes, review all changes:

```
Task tool (superpowers:code-reviewer):
  description: "Review parallel batch: Issues #42, #43"
  prompt: |
    Review changes from parallel implementation batch.

    Issues addressed:
    - #42 Task 1: Auth middleware
    - #43 Task 1: Validation fix

    BASE_SHA: [sha before batch]
    HEAD_SHA: [current sha]

    Focus on:
    - Correct implementation per issue requirements
    - No conflicts between parallel changes
    - Test coverage adequate
    - No security vulnerabilities introduced
```

## Review Feedback Categories

| Category | Action |
|----------|--------|
| **Critical Issues** | Fix immediately via follow-up subagent |
| **Important Issues** | Fix before next batch |
| **Minor Issues** | Note for later |

## Example Review Output

```
Batch Review...
  All changes valid, no conflicts

Strengths:
  - Good test coverage
  - Follows existing patterns

Issues: None

Proceeding to sequential phase...
```

## Handling Critical Feedback

When critical issues are found:

```
Task tool (general-purpose):
  description: "Fix critical issue in auth middleware"
  prompt: |
    The code review found a critical issue:
    [Issue description]

    Fix this before proceeding.
```

## Next Phase

After review passes, proceed to [completion.md](completion.md) for sequential tasks and finalization.
