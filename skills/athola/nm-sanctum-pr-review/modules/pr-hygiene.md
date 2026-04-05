# PR Hygiene: Four Principles

Research-backed practices for PR quality that apply to
every review. These checks run during scope establishment
(Phase 1) and code quality analysis (Phase 2.5).

> **See Also**: [Main Skill](../SKILL.md) |
> [Review Framework](../../../commands/pr-review/modules/review-framework.md)

## Principle 1: Self-Review Before Sending

Open your own PR in the diff view and read it as if you
are a reviewer seeing it for the first time. This catches
scope creep, formatting commits, and unclear changes
before anyone else spends time on them.

### Detection (during `/pr-review`)

When reviewing a PR, check for signs the author skipped
self-review:

```bash
# Check for formatting-only commits mixed with feature work
gh pr view $PR_NUMBER --json commits \
  --jq '.commits[].messageHeadline' | \
  grep -iE '(fmt|format|lint|style|whitespace|cleanup)' \
  && echo "WARNING: Formatting commits mixed with feature work"

# Check for fixup/amend commits that should have been squashed
gh pr view $PR_NUMBER --json commits \
  --jq '.commits[].messageHeadline' | \
  grep -iE '(fixup|fix typo|oops|wip|forgot|actually)' \
  && echo "WARNING: Unsquashed fixup commits suggest no self-review"
```

### Classification

| Signal | Severity | Action |
|--------|----------|--------|
| Formatting-only commits mixed with feature work | SUGGESTION | Recommend squash or split |
| 3+ fixup/typo commits | SUGGESTION | Recommend self-review pass |
| Debug code left in (`console.log`, `print()`, `TODO`) | IN-SCOPE | Should remove before review |
| Commented-out code blocks | IN-SCOPE | Should clean up |

### Guidance for `/pr-prep` (Self-Review Checklist)

Before sending the PR, the author should verify:

- [ ] Read the diff as a reviewer would
- [ ] No debug statements left in
- [ ] No commented-out code
- [ ] No formatting-only commits mixed with logic changes
- [ ] No fixup commits that should be squashed
- [ ] Changes are limited to what the PR description promises

## Principle 2: One PR = One Logical Change

The Single Responsibility Principle for PRs. Small,
focused PRs get reviewed faster, get reviewed more
thoroughly (75%+ defect detection vs 30% for large PRs),
and are easier to revert if something goes wrong.

### Detection (during Phase 1: Scope Establishment)

Analyze commit messages and changed files for mixed
concerns:

```bash
# Count distinct conventional commit types
COMMIT_TYPES=$(gh pr view $PR_NUMBER --json commits \
  --jq '.commits[].messageHeadline' | \
  grep -oE '^(feat|fix|refactor|docs|test|chore|style|perf)' | \
  sort -u | wc -l)

if [[ "$COMMIT_TYPES" -gt 2 ]]; then
  echo "WARNING: $COMMIT_TYPES distinct commit types - possible mixed concerns"
fi

# Check for unrelated directory changes
CHANGED_DIRS=$(gh pr diff $PR_NUMBER --name-only | \
  awk -F/ '{print $1"/"$2}' | sort -u | wc -l)

# Large PRs with many unrelated directories
CHANGED_FILES=$(gh pr view $PR_NUMBER --json changedFiles \
  --jq '.changedFiles')

if [[ "$CHANGED_FILES" -gt 30 ]]; then
  echo "WARNING: $CHANGED_FILES files changed - consider splitting"
fi
```

### Atomicity Signals

| Signal | Severity | Threshold |
|--------|----------|-----------|
| Mixed commit types (feat + refactor + fix) | SUGGESTION | >2 distinct types |
| Large file count | SUGGESTION | >30 files |
| Mixed concerns across unrelated subsystems | IN-SCOPE | Subjective, reviewer judgment |
| Refactor bundled with feature | SUGGESTION | Any occurrence |
| Formatting changes bundled with logic | SUGGESTION | Any occurrence |

### Classification

- **BLOCKING**: Never. Splitting a PR is the author's
  judgment call, not a gate.
- **IN-SCOPE**: When mixed concerns are obvious and the
  split would be straightforward (e.g., a `cargo fmt`
  commit bundled with a feature).
- **SUGGESTION**: When the PR is large but logically
  coherent, note the size for awareness.

### Recommendation Template

When atomicity concerns are found:

```markdown
**[G-ATOMICITY] Consider splitting this PR**

This PR contains N distinct concerns:
1. [concern A] (files: ...)
2. [concern B] (files: ...)

Smaller PRs get reviewed more thoroughly (75%+ defect
detection rate vs 30% for large PRs) and are easier to
revert. Consider splitting into:
- PR 1: [concern A]
- PR 2: [concern B]

Author's discretion - this is a suggestion, not a blocker.
```

## Principle 3: Agent-Generated Code Needs Human Curation

AI coding tools produce code quickly, but the output
needs careful review for: redundant code, unnecessary
complexity, incomplete refactors, and scope drift.
Formatting commits and mixed-concern refactors are
telltale signs of iterative AI generation without a
final cleanup pass.

### Detection (during Phase 2.5: Code Quality)

Look for patterns characteristic of AI-generated code
that was not curated by a human before submission.

#### Tier 1: Structural checks (always run)

```bash
# 1. Wrapper functions (function body is a single call)
# Agent pattern: create_user() just calls _do_create_user()
gh pr diff $PR_NUMBER | \
  awk '/^\+.*def |^\+.*fn |^\+.*function /{name=$0; getline; \
  if(/^\+\s*(return |self\.)/ && !/^\+\s*$/) print name " -> WRAPPER?"}' \
  2>/dev/null || true

# 2. Redundant implementations (same logic, different names)
gh pr diff $PR_NUMBER | \
  grep -E '^\+.*(def |fn |function |func )' | \
  awk '{print $NF}' | sort | uniq -d

# 3. Over-abstraction signals
# New interfaces/traits/protocols with single implementations
NEW_ABSTRACTIONS=$(gh pr diff $PR_NUMBER | \
  grep -cE '^\+.*(trait |interface |protocol |abstract class )' || true)
if [[ "$NEW_ABSTRACTIONS" -gt 0 ]]; then
  echo "CHECK: $NEW_ABSTRACTIONS new abstractions - verify each has 2+ implementations"
fi

# 4. Incomplete refactors
# Old function still called after new replacement added
NEW_FUNCS=$(gh pr diff $PR_NUMBER | \
  grep -E '^\+.*(def |fn |function )' | \
  sed 's/.*\(def\|fn\|function\) \+\([a-zA-Z_]*\).*/\2/' | head -10)
for func in $NEW_FUNCS; do
  OLD_VARIANT=$(echo "$func" | sed 's/new_//;s/_v2$//;s/_updated$//')
  if [[ "$OLD_VARIANT" != "$func" ]]; then
    STILL_CALLED=$(gh pr diff $PR_NUMBER | grep -c "$OLD_VARIANT" || true)
    if [[ "$STILL_CALLED" -gt 0 ]]; then
      echo "INCOMPLETE REFACTOR? $func replaces $OLD_VARIANT but old version still referenced"
    fi
  fi
done
```

#### Tier 2: Diff-ratio checks (run for PRs > 10 files)

```bash
# 5. Addition-heavy ratio (agents add more than they remove)
STATS=$(gh pr view $PR_NUMBER --json additions,deletions \
  --jq '"\(.additions) \(.deletions)"')
ADDITIONS=$(echo $STATS | cut -d' ' -f1)
DELETIONS=$(echo $STATS | cut -d' ' -f2)

if [[ "$DELETIONS" -gt 0 ]]; then
  RATIO=$((ADDITIONS / DELETIONS))
  if [[ "$RATIO" -gt 5 ]]; then
    echo "CHECK: Add/delete ratio $RATIO:1 - agents tend to add without removing"
  fi
fi

# 6. Import bloat (new imports that may be unused)
ADDED_IMPORTS=$(gh pr diff $PR_NUMBER | \
  grep -cE '^\+.*(^import |^from .* import |^use |require\()' || true)
if [[ "$ADDED_IMPORTS" -gt 10 ]]; then
  echo "CHECK: $ADDED_IMPORTS new imports - verify none are unused"
fi

# 7. Scope drift via directory spread
CHANGED_DIRS=$(gh pr diff $PR_NUMBER --name-only | \
  awk -F/ 'NF>1{print $1"/"$2}' | sort -u)
DIR_COUNT=$(echo "$CHANGED_DIRS" | wc -l)
if [[ "$DIR_COUNT" -gt 5 ]]; then
  echo "CHECK: Changes span $DIR_COUNT directories:"
  echo "$CHANGED_DIRS"
fi
```

#### Tier 3: Content-level checks (reviewer judgment)

These cannot be fully automated. The reviewer should
manually check for:

- **Boilerplate inflation**: Does the PR add config
  files, CI changes, or documentation that is not
  required by the stated goal?
- **Defensive over-engineering**: Are there error
  handlers for conditions that cannot happen? Try/catch
  blocks wrapping infallible operations?
- **Naming inconsistency**: Do new functions follow
  existing naming conventions, or do they introduce a
  different style (camelCase vs snake_case, different
  prefix patterns)?
- **Comment density spike**: Agent-generated code
  often has more comments per line than human code.
  If the PR's comment density is notably higher than
  the surrounding code, flag it.

### Agent Code Curation Signals

| Signal | What to look for | Severity |
|--------|-----------------|----------|
| Redundant implementations | Functions doing the same thing with different names | IN-SCOPE |
| Premature abstraction | New trait/interface with exactly one implementation | SUGGESTION |
| Incomplete refactor | Old code path still exists alongside the new one | IN-SCOPE |
| Over-engineered error handling | Catch-all handlers, unnecessary Result wrapping | SUGGESTION |
| Unnecessary wrapper functions | Function that just calls another function | SUGGESTION |
| Scope drift | Changes to files unrelated to the stated goal | IN-SCOPE |
| Formatting commit bundled with logic | `cargo fmt` or `ruff format` in same PR as feature | SUGGESTION |
| Config/boilerplate bloat | New config files, CI changes unrelated to feature | SUGGESTION |

### Recommendation Template

When agent curation issues are found:

```markdown
**[G-CURATION] Agent-generated code needs cleanup pass**

This PR shows signs of iterative AI generation without
a final curation pass:

- [specific finding 1]
- [specific finding 2]

Recommendation: Review the PR with fresh eyes, asking
"does every change here serve the stated goal?" Remove
redundant code, collapse unnecessary abstractions, and
split unrelated changes into separate PRs.
```

### Integration with Anti-Slop (Phase 1.7)

Agent curation overlaps with slop detection but targets
*structural* issues rather than *prose* issues:

- **Slop detection** (Phase 1.7): AI markers in prose,
  documentation, and commit messages
- **Agent curation** (Phase 2.5): AI patterns in code
  structure, architecture, and implementation choices

Both should run. Slop detection catches the writing;
agent curation catches the engineering.

## Principle 4: Tests Should Test Your Code

Tests should break if someone reverts your fix, not
demonstrate why the fix was needed. Assertion blocks
showing unrelated functionality are documentation,
not regression protection.

### Detection (during Phase 2.5 and Test Plan)

Analyze test files changed in the PR:

```bash
# Get test files in the PR
TEST_FILES=$(gh pr diff $PR_NUMBER --name-only | \
  grep -E '(test_|_test\.|\.test\.|\.spec\.)')

# Check for tests that only assert existing behavior
# without connecting to the changed code
for file in $TEST_FILES; do
  # Look for assertions about code NOT changed in this PR
  gh pr diff $PR_NUMBER -- "$file" | \
    grep -E '^\+.*assert' | head -10
done
```

### Test Quality Signals

| Signal | What it means | Severity |
|--------|--------------|----------|
| Tests only assert pre-existing behavior | Demonstrating the problem, not protecting the fix | IN-SCOPE |
| No tests touch code changed in this PR | Tests don't protect against regression | IN-SCOPE |
| Tests pass with the fix reverted | Tests don't actually verify the fix | BLOCKING |
| Test names describe old behavior, not new | Naming suggests documentation, not verification | SUGGESTION |
| Assertion count >> code change size | Over-testing existing behavior | SUGGESTION |

### The Revert Test

The gold standard for test quality: if someone reverts
the fix, at least one test should fail. If no test
fails on revert, the tests are documentation, not
protection.

```bash
# Mental model for each test:
# 1. Does this test touch code changed in this PR?
# 2. Would reverting the PR changes cause this test to fail?
# 3. If not, what regression does this test actually prevent?
```

### Classification

- **BLOCKING**: Tests that pass even when the fix is
  reverted (they test nothing about the new code)
- **IN-SCOPE**: Tests that only assert old behavior
  without covering the new code path
- **SUGGESTION**: Tests that work but could be more
  targeted or better named

### Recommendation Template

When test quality issues are found:

```markdown
**[S-TESTS] Tests should protect against regressions**

The following tests don't break if someone reverts this
PR's changes:

- `test_existing_behavior` in `test_module.py`
  Asserts pre-existing behavior unrelated to the fix.

Write tests that:
1. Would FAIL if the fix is reverted
2. Cover the specific code path changed in this PR
3. Protect against the exact regression being fixed

Tests should answer: "what breaks if someone undoes my
change?" not "what was wrong before my change?"
```

## Integration Checklist

When this module is loaded, the following checks are
added to the review workflow:

### Phase 1 (Scope Establishment)
- [ ] Check PR atomicity (Principle 2)
- [ ] Flag mixed commit types
- [ ] Note PR size for awareness

### Phase 2.5 (Code Quality)
- [ ] Scan for agent curation signals (Principle 3)
- [ ] Check for redundant implementations
- [ ] Flag premature abstractions
- [ ] Identify incomplete refactors

### Phase 2.5 (Test Quality)
- [ ] Apply the revert test mentally (Principle 4)
- [ ] Verify tests touch changed code
- [ ] Flag demonstration-only assertions

### Report Generation (Phase 6)
- [ ] Include self-review checklist if signals found (Principle 1)
- [ ] Include atomicity recommendation if warranted (Principle 2)
- [ ] Include curation findings (Principle 3)
- [ ] Include test quality findings (Principle 4)
