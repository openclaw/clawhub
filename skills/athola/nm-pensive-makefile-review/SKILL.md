---
name: makefile-review
description: Audit Makefiles for build correctness, portability, and recipe duplication
version: 1.8.1
triggers:
  - makefile
  - build
  - make
  - portability
  - automation
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/pensive", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.pensive:shared", "night-market.imbue:proof-of-work"]}}}
source: claude-night-market
source_plugin: pensive
---

> **Night Market Skill** — ported from [claude-night-market/pensive](https://github.com/athola/claude-night-market/tree/master/plugins/pensive). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Quick Start](#quick-start)
- [When to Use](#when-to-use)
- [Required TodoWrite Items](#required-todowrite-items)
- [Workflow](#workflow)
- [Step 1: Map Context (`makefile-review:context-mapped`)](#step-1:-map-context-(makefile-review:context-mapped))
- [Step 2: Dependency Graph (`makefile-review:dependency-graph`)](#step-2:-dependency-graph-(makefile-review:dependency-graph))
- [Step 3: Deduplication Audit (`makefile-review:dedup-candidates`)](#step-3:-deduplication-audit-(makefile-review:dedup-candidates))
- [Step 4: Portability Check (`makefile-review:tooling-alignment`)](#step-4:-portability-check-(makefile-review:tooling-alignment))
- [Step 5: Evidence Log (`makefile-review:evidence-logged`)](#step-5:-evidence-log-(makefile-review:evidence-logged))
- [Progressive Loading](#progressive-loading)
- [Output Format](#output-format)
- [Summary](#summary)
- [Testing](#testing)

## Testing

Run `pytest plugins/pensive/tests/skills/test_makefile_review.py` to verify review logic.

# Makefile Review Workflow

Audit Makefiles for best practices, deduplication, and portability.

## Quick Start

```bash
/makefile-review
```

## When To Use

- Makefile changes or additions
- Build system optimization
- Portability improvements
- CI/CD pipeline updates
- Developer experience improvements

## When NOT To Use

- Creating new Makefiles - use abstract:make-dogfood
- Architecture review - use architecture-review

## Required TodoWrite Items

1. `makefile-review:context-mapped`
2. `makefile-review:dependency-graph`
3. `makefile-review:dedup-candidates`
4. `makefile-review:tooling-alignment`
5. `makefile-review:evidence-logged`

## Workflow

### Step 1: Map Context (`makefile-review:context-mapped`)

Confirm baseline:
```bash
pwd && git status -sb && git diff --stat
```
**Verification:** Run `git status` to confirm working tree state.

Find Make-related files:
```bash
rg -n "^include" -g'Makefile*'
rg --files -g '*.mk'
```

Document changed targets, project goals, and tooling requirements.

### Step 2: Dependency Graph (`makefile-review:dependency-graph`)

@include modules/dependency-graph.md

### Step 3: Deduplication Audit (`makefile-review:dedup-candidates`)

@include modules/deduplication-patterns.md

### Step 4: Portability Check (`makefile-review:tooling-alignment`)

@include modules/portability-checks.md

### Step 5: Evidence Log (`makefile-review:evidence-logged`)

Use `imbue:proof-of-work` to record command outputs with file:line references.

Summarize findings:
- Severity (critical, major, minor)
- Expected impact
- Suggested refactors
- Owners and dates for follow-ups

## Progressive Loading

Load additional context as needed:

**Best Practices & Examples**: `@include modules/best-practices.md`

**Plugin Dogfood Checks**: `@include modules/plugin-dogfood-checks.md` - Makefile completeness analysis, target generation, and dogfooding validation.

## Output Format

```markdown
## Summary
Makefile review findings

## Context
- Files reviewed: [list]
- Targets changed: [list]

## Dependency Analysis
[graph and issues]

## Duplication Candidates
### [D1] Repeated command
- Locations: [list]
- Recommendation: [pattern rule]

## Portability Issues
[cross-platform concerns]

## Missing Targets
- [ ] help
- [ ] format
- [ ] lint

## Recommendation
Approve / Approve with actions / Block
```

## Exit Criteria

- Context mapped
- Dependencies analyzed
- Deduplication reviewed
- Portability checked
- Evidence logged
## Troubleshooting

### Common Issues

**No Makefile found**
Ensure `Makefile` or `*.mk` files exist in the project root or specify paths explicitly.

**Include directives not resolved**
Run `rg -n "^include" -g'Makefile*'` to trace include chains manually.
