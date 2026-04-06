# PR Tier Checks

The PR tier adds quality scoring on top of branch tier
gates. Runs before merge.

## Additional Checks for Affected Plugins

After all branch tier checks pass, run these:

### 1. Skills Evaluation

Invoke `Skill(abstract:skills-eval)` for each affected
plugin. Capture:
- Per-skill quality scores
- Token efficiency ratings
- Compliance status

Report any skill scoring below 70 (MINIMUM_QUALITY_THRESHOLD).

### 2. Hooks Evaluation

If the plugin has hooks that changed in the diff:

Invoke `Skill(abstract:hooks-eval)` targeting only changed
hook files. Capture:
- Security findings
- Performance concerns
- Compliance status

### 3. Test Review

Invoke `Skill(pensive:test-review)` for each affected plugin.
Capture:
- Coverage percentage
- Anti-pattern findings
- Missing edge cases

### 4. Quick Bloat Scan

Invoke `Skill(conserve:bloat-detector)` at Tier 1 (quick) for
each affected plugin. Capture:
- Dead code candidates
- Duplicate content
- Stale files

### 5. Rules Evaluation

If `.claude/rules/` files changed in the diff:

Invoke `Skill(abstract:rules-eval)`. Capture:
- YAML validity
- Pattern specificity
- Content quality

## Parallel Execution

Group affected plugins into 2-3 clusters and dispatch
agents in parallel. Each agent runs the full PR check
suite on its assigned plugins.

## Scorecard Output

Add a scorecard section after the branch tier table:

```
Scorecard (PR tier)

Plugin          skills  hooks  tests  bloat  grade
sanctum         88/100  92/100 93%    90/100 A-
memory-palace   85/100  --     89%    82/100 B+

Top 5 Remediation Actions:
1. [sanctum] skills/commit-messages: missing trigger phrases
2. [memory-palace] hooks/research_interceptor.py: no timeout
...
```

## Verdict Rules

- Any branch-tier FAIL: overall FAIL
- Any skill score below 50: overall FAIL
- Any security finding (HIGH): overall FAIL
- All scores above 70: PASS
- Otherwise: PASS-WITH-WARNINGS with details
