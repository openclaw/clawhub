# Phase 1: Issue Discovery

Parse input arguments and retrieve issue content from the detected git platform. Check session context for `git_platform:` to determine which CLI to use.

## Input Formats

The command accepts flexible input:

```bash
# Single issue number
/do-issue 42

# Platform URL (GitHub or GitLab)
/do-issue https://github.com/owner/repo/issues/42
/do-issue https://gitlab.com/owner/repo/-/issues/42

# Multiple issues (space-delimited)
/do-issue 42 43 44

# Mixed formats
/do-issue 42 https://github.com/owner/repo/issues/43
```

## Retrieve Issue Content

For each issue, fetch the full content using the platform-appropriate CLI:

```bash
# GitHub
gh issue view 42 --json title,body,labels,assignees,comments
gh issue view https://github.com/owner/repo/issues/42 --json title,body,labels,assignees,comments

# GitLab
glab issue view 42
```

## Extract Requirements

From each issue body, identify:

| Category | Look For |
|----------|----------|
| **Acceptance Criteria** | Checkboxes, "should", "must" statements |
| **Technical Requirements** | Code references, API specs, constraints |
| **Test Expectations** | Expected behavior, edge cases |
| **Dependencies** | Related issues, blocking items |

## Example Output

```
Fetching issue #42...
Title: Add user authentication
Requirements identified: 4
  - Acceptance Criteria: 2
  - Technical Requirements: 1
  - Test Expectations: 1
Tasks will be generated: 3
```

## Next Phase

After discovery, proceed to [task-planning.md](task-planning.md) for dependency analysis and task breakdown.
