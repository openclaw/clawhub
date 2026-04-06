---
name: merge-conflict-resolution
description: >
  Classification and resolution strategies for git merge,
  rebase, and cherry-pick conflicts. Covers auto-resolvable
  patterns, agent-resolvable patterns, and escalation to
  human review for conflicts that require judgment.
parent_skill: leyline:damage-control
category: infrastructure
estimated_tokens: 300
---

# Merge Conflict Resolution

## When This Module Applies

Use this module when a `git merge`, `git rebase`, or
`git cherry-pick` produces conflicts (conflict markers appear
in files, `git status` shows `UU` or `AA` entries). Also use
it when an agent detects that two in-progress tasks have
modified the same file and their changes cannot be trivially
combined.

## Conflict Classification

Before attempting resolution, classify the conflict:

### Class A: Formatting or whitespace only

Both sides changed the same lines for non-semantic reasons
(whitespace, import sort order, trailing comma). The
conflict is safe to resolve by applying the later change.

**Resolution**: Take the current branch version or apply a
formatter and accept all.

### Class B: Independent additions to the same region

Both sides added new content to the same location (e.g., two
agents added separate functions to the same file, or two
migrations added separate fields). The changes do not
overlap semantically.

**Resolution**: Manually interleave both additions, preserving
both sets of content. Verify no naming collisions.

### Class C: Competing modifications to the same logic

Both sides changed the same lines with different semantics.
One or both changes must be partially discarded or combined
by someone who understands the intent of each.

**Resolution**: Escalate to human review. Do not guess at
intent. See the Escalation Protocol below.

### Class D: Deleted vs. modified

One side deleted a file or function; the other modified it.

**Resolution**: Escalate to human review. The delete may be
intentional (the other branch's modification is stale) or
erroneous (the file should not have been deleted).

## Resolution Procedure

### Step 1: List all conflicted files

```
git status | grep -E "^(UU|AA|DD|DU|UD|AU|UA)"
```

Or use the short form:

```
git diff --name-only --diff-filter=U
```

### Step 2: Classify each conflict

For each conflicted file, identify which class applies.
Record the classification before touching the file.

### Step 3: Resolve Class A and Class B conflicts

Class A:

```
# Accept current branch (ours)
git restore --ours <file> && git add <file>

# Or accept incoming (theirs)
git restore --theirs <file> && git add <file>

# Or run formatter and accept
<formatter> <file> && git add <file>
```

Use `git restore` instead of `git checkout` for file-level
operations. The `restore` command is scoped to working tree
changes and cannot accidentally switch branches.

Class B: Edit the file manually to include both additions,
then:

```
git add <file>
```

After resolving, run the test suite for the affected file
before marking complete.

### Step 4: Escalate Class C and Class D conflicts

Do not attempt to resolve Class C or D conflicts
autonomously. Instead:

1. Before aborting, verify no uncommitted work will be lost:

```
# Check for changes outside the conflict that should be saved
git stash list
git diff --stat

# If there are non-conflict changes worth keeping, stash them
git stash push -m "pre-abort-save: work outside conflict scope"
```

2. Abort the merge or rebase to restore clean state:

```
git merge --abort
# or
git rebase --abort
```

After aborting, verify the branch is in the expected state
with `git log --oneline -5` and `git status`. If a stash
was created above, verify it appears in `git stash list`.

3. Record the conflict details in the task list:

```
## Conflict Escalation — [timestamp]

Files with Class C/D conflicts: [list]
Current branch intent: [what this branch was trying to do]
Incoming branch intent: [what the other branch was trying to do]
Specific conflict: [line numbers, function names, what each side did]
Recommended action: [your best read on the safest path]
```

4. Mark the affected task as blocked and assign to human.

### Step 5: Verify after resolution

After all Class A and Class B conflicts are resolved:

```
git diff --check          # no leftover conflict markers
<test runner>             # affected tests pass
```

If tests fail after resolution, do not proceed. The
resolution introduced a regression. Revert to the pre-merge
state and escalate.

## Parallel Agent Conflict Prevention

The best conflict resolution is avoidance. When multiple
agents are running:

- Each agent should own disjoint files where possible
- Agents modifying the same module should coordinate via
  task dependencies (block/unblock) rather than merging
- Lead agent monitors for file overlap and serializes
  conflicting tasks rather than letting them merge

See `Skill(leyline:risk-classification)` verification gates
for the parallel execution safety matrix.

## Exit Criteria

- `git status` shows no files with conflict markers
  (`UU`, `AA`, `DD`, `DU`, `UD`, `AU`, `UA` states)
- `git diff --check` exits clean
- Tests pass for all files that had conflicts
- Class C and Class D conflicts have escalation records
  in the task list before the session closes
- The merge or rebase is either completed and committed, or
  aborted cleanly with no partial state on disk
