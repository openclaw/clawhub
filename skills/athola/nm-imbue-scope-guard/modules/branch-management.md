# Branch Threshold Management

Monitoring and enforcement of branch size thresholds.

## Metrics & Thresholds

| Metric | Green | Yellow | Red |
|--------|-------|--------|-----|
| **Lines changed** | < 1000 | 1000-1500 | > 2000 |
| **New files created** | < 8 | 8-12 | > 15 |
| **Commits on branch** | < 15 | 15-25 | > 30 |
| **Days on branch** | < 3 | 3-7 | > 7 |

## Check Command

Quick threshold check using git:

```bash
# Quick threshold check
lines=$(git diff main --stat | tail -1 | awk '{print $4}')
files=$(git diff main --name-only --diff-filter=A | wc -l)
commits=$(git rev-list --count main..HEAD)
days=$(( ($(date +%s) - $(git log -1 --format=%ct $(git merge-base main HEAD))) / 86400 ))

echo "Lines: $lines | Files: $files | Commits: $commits | Days: $days"
```

## Zone Responses

### Green Zone

**Status:** Healthy branch size, proceed normally.

**Action:** None required, continue work.

### Yellow Zone

**Status:** Approaching thresholds, requires awareness.

**Prompt Template:**
```
Branch approaching thresholds:
- Lines: 1,247 (Yellow zone)
- Commits: 18 (Yellow zone)

Before continuing, confirm:
1. Does this still match the original scope?
2. What's the current Worthiness Score?
3. Can anything be split to backlog?
```

**Required Actions:**
1. Review current scope vs original plan
2. Re-score remaining work with Worthiness formula
3. Identify candidates for backlog deferral
4. Consider splitting to new branch

### Red Zone

**Status:** Exceeds thresholds, requires justification.

**Prompt Template:**
```
Branch exceeds thresholds:
- Lines: 2,341 (Red zone)
- Days: 9 (Red zone)

Required before PR:
1. Document why scope expanded
2. Identify items to split to backlog or future branch
3. Re-score Worthiness with current scope
4. Explicit approval to continue
```

**Required Actions:**
1. **Document expansion:** Write justification for scope growth
2. **Split work:** Identify features to defer or move to new branch
3. **Re-score:** Calculate Worthiness with current scope
4. **Explicit approval:** Get confirmation to proceed with current size

**Blocking:** May block PR creation until Red zone issues addressed (configurable via hook).

## Integration Points

### Hook: pre-pr-scope-check

Automatically runs before PR creation:
1. Check all threshold metrics
2. Warn on Yellow, block on Red (configurable)
3. Require justification for Red zone branches

### During Execution

Periodically during long-running sessions:
1. Run threshold check
2. Warn if Yellow zone reached
3. Require justification if Red zone reached

**Self-invoke prompt:** "This branch has grown significantly. Let me check scope-guard thresholds."

## Branch Budget

**Default:** 3 major features per branch

**Budget Tracking:**
```
Branch: feature/auth-improvements
Budget: 3 features

Current allocation:
1. OAuth2 flow refactor (primary)
2. Token refresh logic (secondary)
3. [OPEN SLOT]

Proposed: Session timeout handling
Decision: Fits in slot 3 → Proceed
```

**When at capacity:**
- Drop existing feature, OR
- Split to new branch, OR
- Document override justification
