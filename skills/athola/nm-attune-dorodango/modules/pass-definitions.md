---
name: pass-definitions
description: Definitions and scope for each quality
  pass type in the dorodango polishing workflow.
parent_skill: attune:dorodango
category: workflow
estimated_tokens: 250
---

# Pass Type Definitions

## Pass 1: Correctness

**Goal**: Code works as intended.

**Scope**:
- Run test suite, identify failures
- Fix failing tests
- Check for runtime errors
- Verify edge cases specified in requirements

**Agent prompt focus**: "Run all tests. For each
failure, identify the root cause and fix it. Do not
refactor; focus only on making tests pass."

**Tools**: Bash (pytest/test runner), Edit

**Convergence**: 0 test failures

## Pass 2: Clarity

**Goal**: Code is readable and well-structured.

**Scope**:
- Variable and function naming
- Function length and complexity
- Comment quality (helpful vs. noise)
- Dead code removal
- Single-responsibility adherence

**Agent prompt focus**: "Review for readability.
Rename unclear variables, break up long functions,
remove dead code. Do not change behavior."

**Tools**: Read, Edit, pensive:code-refinement

**Convergence**: 0 clarity issues found by reviewer

## Pass 3: Consistency

**Goal**: Code follows project conventions.

**Scope**:
- Naming conventions (snake_case, camelCase, etc.)
- Import ordering
- Error handling patterns
- Logging patterns
- File organization

**Agent prompt focus**: "Compare against codebase
conventions. Flag deviations from established patterns.
Use style-gene-transfer if exemplar available."

**Tools**: Read, Grep, Edit

**Convergence**: 0 convention deviations found

## Pass 4: Polish

**Goal**: Code is production-ready.

**Scope**:
- Error messages are user-friendly
- Documentation is accurate and complete
- Edge cases have graceful handling
- Configuration is well-documented

**Agent prompt focus**: "Review error messages, docs,
and edge cases. Ensure each error message helps the
user understand what went wrong and how to fix it."

**Tools**: Read, Edit

**Convergence**: 0 polish issues found

## Pass Ordering

Passes run in order: correctness, clarity, consistency,
polish. This ordering is intentional:

1. Fix bugs before cleaning up code
2. Clean up code before checking conventions
3. Check conventions before polishing edges

If a pass in a later dimension discovers a bug
(correctness regression), surface to human rather
than re-running the converged correctness pass.
