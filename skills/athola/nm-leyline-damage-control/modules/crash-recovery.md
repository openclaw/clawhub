---
name: crash-recovery
description: >
  Triage, checkpoint inspection, and safe resume or rollback
  after an agent process crash. Covers partial writes, unknown
  git index state, and re-entry into an interrupted task.
parent_skill: leyline:damage-control
category: infrastructure
estimated_tokens: 280
---

# Crash Recovery

## When This Module Applies

Use this module when an agent process exited unexpectedly
mid-task: the shell died, a timeout fired, or an unhandled
exception terminated the agent before it could report status.
Signs of a crash:

- A task is marked `in_progress` but no agent is running
- Files on disk differ from the last known checkpoint
- The git index contains staged changes with no corresponding
  commit or stash

Do not use this module for context limit exhaustion (see
`context-overflow.md`) or for git conflicts introduced during a
merge (see `merge-conflict-resolution.md`).

## Triage Steps

### Step 1: Identify the scope

```
git status          # staged vs unstaged changes
git diff HEAD       # total delta from last commit
git stash list      # any stashes from prior sessions
```

Classify what you find:

| Observation | Action |
|---|---|
| Clean index, no changes | Task never started — restart normally |
| Only unstaged changes | Safe to inspect and resume |
| Staged + unstaged mix | Stash before any further work |
| Merge in progress | Switch to merge-conflict-resolution.md |

### Step 2: Inspect the task list

Check the task list for the crashed task:

- If `in_progress`: the task was running at crash time.
  Determine its last known completed step before deciding to
  resume or restart.
- If `pending`: the task had not yet started. No recovery
  needed; assign normally.
- If `completed`: the task completed before the crash. No
  action required.

### Step 3: Verify artifact integrity

For each file the task was supposed to produce or modify:

```
git diff HEAD -- <file>        # what changed since last commit
git show HEAD:<file>           # last committed version
```

If the current version of the file is internally consistent
(parses, tests pass for that file), the partial write is safe
to keep and the task can resume from the last completed step.

If the file is corrupt or partially written, recover from
git history rather than using destructive restore commands:

```
git show HEAD:<file> > <file>.recovered   # extract last committed version
git diff HEAD -- <file>                   # review what changed
# Compare <file> with <file>.recovered to salvage valid work
# Then replace <file> with the corrected version
rm <file>.recovered
```

Never use `git checkout -- <file>` as it discards work
irreversibly. Always inspect the diff first so partial
progress can be preserved.

### Step 4: Decide: resume or restart

Resume when:

- The crashed task has a clear last completed step
- All files the task touched are internally consistent
- No downstream tasks have already consumed the partial output

Restart when:

- The crashed step is not deterministic (e.g., it called an
  external API with side effects)
- Partial output was already read by a downstream agent
- The file integrity check failed for any touched file

### Step 5: Clean up and re-enter

If resuming:

```
git add <files>                # re-stage work that survived
# Update task list: record last completed step in description
```

If restarting:

```
# Review what changed before reverting anything
git diff HEAD -- <files>

# Extract committed versions for comparison
for f in <files>; do
  git show HEAD:"$f" > "$f.baseline"
done

# After confirming no salvageable work, restore from history
for f in <files>; do
  git show HEAD:"$f" > "$f"
  rm -f "$f.baseline"
done
git reset HEAD <files>         # unstage
# Update task list: reset task to pending
```

Never use `git checkout -- <files>` as it discards all
changes without review. Always diff first.

Mark the crashed task with a note in its description recording
the crash and the recovery action taken.

## Exit Criteria

- Git index is clean (nothing accidentally staged)
- All files touched by the crashed task are internally
  consistent or reverted to last-committed state
- The task list accurately reflects whether the task is
  pending (restart) or in-progress (resume)
- No partial artifacts remain readable by downstream agents
  unless they have been verified as correct
- The recovery action (resume or restart, and why) is noted
  on the task record
