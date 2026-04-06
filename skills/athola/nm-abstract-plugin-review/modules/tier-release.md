# Release Tier Checks

The release tier runs a full ecosystem audit across all 17
plugins. Requires plan mode for parallel agent dispatch.

## Scope

All 17 plugins, regardless of git diff. This is the
pre-release validation gate.

## Additional Checks (Beyond PR Tier)

### 1. Architecture Review

Invoke `Skill(pensive:architecture-review)` to assess:
- ADR compliance across all plugins
- Cross-plugin coupling analysis
- Module boundary violations
- Design pattern adherence

### 2. Unified Review

Invoke `Skill(pensive:unified-review)` for multi-domain
orchestration covering API, architecture, test, and code
quality dimensions.

### 3. Deep Bloat Scan

Invoke `Skill(conserve:bloat-detector)` at Tier 2-3 (deep) for
full dead code analysis, cross-file duplication detection,
and dependency audit.

### 4. Token Efficiency Analysis

For each plugin, calculate:
- Total skill description budget usage
- Per-skill token estimates
- Progressive loading compliance
- Module size distribution

Flag any plugin exceeding its proportional token budget
allocation.

### 5. Meta-Evaluation

Run `python3 plugins/sanctum/scripts/meta_evaluation.py`
to validate that evaluation-related skills (skills-eval,
hooks-eval, rules-eval) meet their own quality standards.

### 6. Cross-Plugin Dependency Validation

Regenerate the dependency map and compare with the committed
version:

```bash
python3 scripts/generate_dependency_map.py --stdout | \
  diff - docs/plugin-dependencies.json
```

Flag any drift between actual and documented dependencies.

## Agent Dispatch Plan

Requires plan mode (4+ agents rule). Suggested grouping:

| Agent | Plugins | Focus |
|-------|---------|-------|
| 1 | abstract, leyline | Foundation layer |
| 2 | sanctum, imbue, conserve | Core infrastructure |
| 3 | attune, conjure, hookify | Workflow plugins |
| 4 | pensive, memory-palace, minister | Domain specialists |
| 5 | parseltongue, egregore, spec-kit | Language/pipeline |
| 6 | scribe, scry, archetypes | Media/docs/patterns |

Each agent runs full PR-tier checks on its plugins plus
the release-specific checks.

## Full Ecosystem Report

```
Plugin Review (release tier) - vX.Y.Z
Date: YYYY-MM-DD
Plugins: 17/17

ECOSYSTEM HEALTH
Plugin          test  lint  type  skills hooks  bloat  grade
abstract        PASS  PASS  PASS  92     88     90     A
attune          PASS  PASS  PASS  85     --     82     B+
conjure         PASS  PASS  PASS  88     85     87     A-
...

ARCHITECTURE
ADR compliance: 7/7
Coupling score: 0.06
Boundary violations: 0

TOKEN BUDGET
Used: 15,200 / 17,000 chars (89.4%)
Largest: attune (3,920 chars, 23.1%)

DEPENDENCY MAP
Status: current (no drift)

Verdict: PASS (17/17 plugins healthy)
```

## Verdict Rules

- Any test FAIL: overall FAIL
- Any security finding (HIGH): overall FAIL
- ADR violation without justification: overall FAIL
- Coupling score > 0.7: FAIL
- All plugins grade B or above: PASS
- Otherwise: PASS-WITH-WARNINGS
