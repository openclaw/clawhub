---
name: state-reconciliation
description: >
  Protocol for reconciling divergent state across the task
  list, git index, and on-disk artifacts. Establishes a
  verified baseline when observed state does not match
  expected state, before any further work begins.
parent_skill: leyline:damage-control
category: infrastructure
estimated_tokens: 270
---

# State Reconciliation

## When This Module Applies

Use this module when the three state sources disagree:

- **Task list** says task T is completed, but the expected
  output file does not exist on disk
- **Git index** has staged changes for a file the task list
  says was not yet touched
- **On-disk artifacts** exist that do not correspond to any
  task in the task list
- An agent reports that a prerequisite artifact is missing,
  but the task that should have produced it is marked done

This module is also the recommended first step when multiple
failure types overlap: establish a known baseline before
applying a more specific recovery protocol.

## The Three State Sources

| Source | Contains | Ground Truth For |
|---|---|---|
| Task list | Task status, dependencies, notes | Work intent and completion claims |
| Git history | Committed changes, authors, timestamps | What was actually persisted |
| On-disk state | Working tree + index | Current in-flight work |

When these three agree, state is consistent. When they
disagree, one or more sources is stale or incorrect.

## Reconciliation Protocol

### Step 1: Snapshot all three sources

Do not make any changes until the snapshot is complete.

```
# Task list snapshot
# (read task list: record all task IDs, statuses, owners)

# Git state snapshot
git log --oneline -20
git status
git diff HEAD

# Disk artifact check
# For each expected output, verify existence and basic integrity
```

### Step 2: Build the disagreement map

For each task marked `completed` in the task list, verify
that all expected outputs exist and are committed:

| Task | Expected Output | On Disk? | Committed? |
|---|---|---|---|
| T042 | src/auth/token.py | yes | yes |
| T051 | tests/test_token.py | yes | NO |
| T063 | docs/api.md | NO | — |

Any row with a "NO" is a disagreement requiring reconciliation.

### Step 3: Resolve each disagreement

#### Task marked done, output on disk but not committed

The task completed but the commit was missed:

```
git add <file>
git commit -m "fix: commit output for T<id> missed in prior session"
```

#### Task marked done, output not on disk

Two possibilities:

1. The file was committed under a different name or path.
   Check `git log --all --full-history -- <expected_path>`.

2. The task did not actually complete despite the status.
   Reset the task to `pending` and note the discrepancy
   in the task description.

#### File on disk not covered by any task

Determine origin:

```
git log --all --follow -- <file>
git blame <file>
```

If the file was produced by a known task that is now
missing from the task list, add a task record for it
retroactively and mark it `completed`.

If the origin is unknown, treat the file as an orphan.
Always use named stashes with descriptive messages so the
work can be located later:

```
git stash push -m "orphan: <file> from unknown task [$(date +%F)]" -- <file>
git stash list   # verify the stash was created and note its index
```

Record the stash index and message in the task list so it
is not lost. Then decide separately whether to adopt or
discard.

#### Staged changes with no corresponding in-progress task

```
git diff --cached       # inspect what is staged
git stash push -m "unowned-staged: $(date +%F)"   # named stash
git stash list          # verify creation
```

Record the stash index in the task list. Then reconcile:
find the task this work belongs to and reassign the stash
to it, or discard only after confirming the work is
superseded.

**Stash safety rules:**

- Always use `git stash push -m "<description>"` (never
  bare `git stash` which creates unnamed entries)
- Immediately verify with `git stash list` after pushing
- Record the stash ref (e.g., `stash@{0}`) in the task
  description so it can be found across sessions
- Apply with `git stash pop stash@{N}` using the explicit
  index, not bare `git stash pop` which always takes the
  most recent entry

### Step 4: Re-verify after reconciliation

After resolving all disagreements:

- Re-read the task list and rebuild the disagreement map
- The map should now show all "yes" in both columns
- Run `git status` (index should be clean)
- Run the test suite (all tests should pass)

If any new disagreements appear during re-verification, apply
the same protocol recursively until the map is clean.

### Step 5: Document the reconciliation

Add a note to each affected task describing the discrepancy
found and the action taken. This creates an audit trail if
the same disagreement recurs.

## Exit Criteria

- Every task marked `completed` has all expected outputs
  present on disk and committed to git
- No staged changes exist without a corresponding
  `in_progress` task owning them
- No on-disk artifacts exist that are unaccounted for by the
  task list
- `git status` shows a clean index (or only staged changes
  belonging to a known in-progress task)
- The disagreement map from Step 2, when rebuilt, shows no
  remaining "NO" entries
- Each reconciliation action is recorded in the relevant
  task description
