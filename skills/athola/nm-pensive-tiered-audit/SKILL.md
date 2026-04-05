---
name: tiered-audit
description: |
  Audit a codebase using three escalation tiers: git history analysis, targeted deep-dives, and full codebase review with gating
version: 1.8.1
triggers:
  - audit
  - git-history
  - code-quality
  - review
  - escalation
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/pensive", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.imbue:proof-of-work"]}}}
source: claude-night-market
source_plugin: pensive
---

> **Night Market Skill** — ported from [claude-night-market/pensive](https://github.com/athola/claude-night-market/tree/master/plugins/pensive). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Tiered Audit

## Table of Contents

- [When to Use](#when-to-use)
- [When NOT to Use](#when-not-to-use)
- [Tier 1: Git History Audit](#tier-1-git-history-audit)
- [Tier 2: Targeted Area Audit](#tier-2-targeted-area-audit)
- [Tier 3: Full Codebase Audit](#tier-3-full-codebase-audit)
- [Output Contract](#output-contract)

## When To Use

- Auditing codebase quality, patterns, or problems
- Reviewing what changed on a branch before merge
- Investigating areas of instability or churn
- Pre-PR quality assessment

## When NOT to Use

- Reviewing a specific file (use pensive:code-reviewer)
- Architecture-only review (use pensive:architecture-review)
- Single-commit review (use imbue:diff-analysis)

## Tier 1: Git History Audit

**Always runs first.** Analyzes git log, diff stats, and
blame to identify areas of concern without reading any
source files.

### What Tier 1 Analyzes

Run these git commands for the target commit range
(default: current branch vs main):

```bash
# 1. Churn hotspots: files changed most often
git log --format="" --name-only {base}..HEAD \
  | sort | uniq -c | sort -rn | head -20

# 2. Diff stats: size of changes per file
git diff --stat {base}..HEAD

# 3. Fix-on-fix patterns: commits fixing previous commits
git log --oneline {base}..HEAD \
  | grep -iE "(fix|revert|patch|hotfix)"

# 4. New file clusters: modules with many new files
git diff --name-status {base}..HEAD \
  | grep "^A" | cut -f2 \
  | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn

# 5. Large commits: single commits with big diffs
git log --format="%h %s" --shortstat {base}..HEAD
```

**Verification:** Confirm each command produces output.
If a command returns empty, the commit range may be wrong;
verify `{base}` resolves correctly with `git merge-base`.

### Tier 1 Output Format

Write findings to `.coordination/agents/tier1-audit.findings.md`:

```markdown
---
agent: tier1-audit
tier: 1
evidence_count: {N}
---

## Summary

{1-2 sentence overview of what the git history reveals}

## Churn Hotspots

{top 10 most-changed files with change counts}

[E1] Command: git log --format="" --name-only ...
     Output: {relevant output}

## Fix-on-Fix Patterns

{commits that fix previous commits in the same area}

[E2] Command: git log --oneline ... | grep -iE ...
     Output: {relevant output}

## New File Clusters

{modules with 5+ new files}

## Large Diffs

{commits with 200+ line changes}

## Escalation Recommendation

{list of areas flagged for Tier 2, or "no escalation needed"}
```

### Escalation Decision

After Tier 1 completes, check findings against the
escalation criteria in `modules/escalation-criteria.md`.

If NO criteria are met: audit is complete. Report findings.

If criteria ARE met: list flagged areas and proceed to
Tier 2 for each area sequentially.

## Tier 2: Targeted Area Audit

**Runs only for areas flagged by Tier 1.**
Each flagged area is audited one at a time, not in
parallel.

### What Tier 2 Analyzes

For each flagged area:

1. Read the source files in the area
2. Check for patterns, anti-patterns, bugs
3. Verify test coverage exists
4. Check documentation currency
5. Assess architectural fit

### Tier 2 Output Format

One findings file per area:
`.coordination/agents/tier2-{area-name}.findings.md`

Each file follows the output contract for audits
(see imbue:proof-of-work/modules/output-contracts).

## Tier 3: Full Codebase Audit

**Requires explicit user approval.** See
`modules/escalation-criteria.md` for the gate protocol.

Tier 3 should use dedicated sessions (one per area)
with file-based coordination, NOT parallel subagents.

## Output Contract

All tiers use this contract:

```yaml
output_contract:
  required_sections:
    - summary
    - evidence
  min_evidence_count: 3    # Tier 1
  # min_evidence_count: 8  # Tier 2
  expected_artifacts: []
  retry_budget: 1
  strictness: normal
```

Tier 2 raises the minimum evidence count to 8 because
it reads source files and should produce deeper analysis.

**Verification:** After each tier completes, verify the
findings file exists and contains at least the minimum
evidence count (`[E1]`, `[E2]`, etc.) before proceeding
to the next tier or reporting results.
