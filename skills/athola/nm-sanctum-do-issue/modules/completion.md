# Phases 5-6: Completion

Execute sequential tasks and finalize the workflow.

## Phase 5: Sequential Tasks

For tasks with dependencies, execute sequentially:

```
Task tool (general-purpose):
  description: "Issue #42 - Task 2: Add login endpoint"
  prompt: |
    You are implementing Task 2 from Issue #42.

    This task depends on completed Task 1 (auth middleware).

    [Task requirements]

    Verify Task 1's middleware works before building on it.
```

Review after each sequential task following the subagent-driven-development pattern.

## Phase 6: Final Review

Dispatch detailed review of all changes:

```
Task tool (superpowers:code-reviewer):
  description: "Final review: Issues #42, #43, #44"
  prompt: |
    Review complete implementation for issues: #42, #43, #44

    Verify:
    - All acceptance criteria met
    - Tests detailed and passing
    - No regressions introduced
    - Code quality meets standards
    - Documentation updated if needed
```

## Update Issue Status

For each completed issue:

```bash
# Add completion comment
gh issue comment 42 --body "Fixed in commit $(git rev-parse --short HEAD)

Changes:
- Implemented auth middleware
- Added login endpoint
- Added detailed tests

Ready for review."

# Optionally close issue
gh issue close 42 --comment "Completed via automated fix workflow"
```

## Pre-PR Consolidation Check

Before creating the PR, verify all work is on ONE branch:

```bash
# Confirm current branch contains all issue commits
git log --oneline --grep="Fixes #42" --grep="Fixes #43" \
  --all-match HEAD
# If commits are on separate branches, cherry-pick or
# rebase them onto the shared branch first.
```

## Finish Development

Use `superpowers:finishing-a-development-branch` to:

- Verify all tests pass
- Present merge options
- Execute chosen completion path

**One PR rule**: Always create exactly ONE pull request
that references all issues via `Fixes #N` lines in
the body. See Step 6.2 in the do-issue command for
the template. Never create separate PRs per issue.

## Tooling Reflection (Night-Market Feedback Loop)

After completing the workflow, reflect on the *tooling itself*
(skills, agents, commands, hooks) rather than the repo code:

- Did any skill behave unexpectedly or have unclear guidance?
- Was a subagent slow, redundant, or missing context?
- Did the do-issue command skip steps or require unnecessary
  manual intervention?
- Did a hook fire incorrectly or miss a case?

**If yes**, post to https://github.com/athola/claude-night-market/discussions
(Learnings category) using the pattern from `fix-pr`
Step 6.7. Always target the night-market repo, not the
current working repo.

**If no observations**, skip this step silently.

> Repo-specific learnings stay in the current repo. Tooling
> learnings always go to
> https://github.com/athola/claude-night-market/discussions
> so the framework can improve.

## Example Final Output

```
Final Review: All requirements met

Issues Summary:
  #42: 3 tasks completed, all tests passing
  #43: 2 tasks completed, all tests passing
  #44: 1 task completed, all tests passing

PR: fix(auth): add middleware and login endpoint (#42, #43, #44)
  - Fixes #42, Fixes #43, Fixes #44
  - All issues consolidated in single PR
```
