---
name: plugin-review
description: |
  Review plugin quality with tiered checks and dependency-aware scoping. Use for PR validation and pre-release audits
version: 1.8.1
triggers:
  - review
  - quality
  - validation
  - testing
  - architecture
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/abstract", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.skills-eval", "night-market.hooks-eval", "night-market.rules-eval"]}}}
source: claude-night-market
source_plugin: abstract
---

> **Night Market Skill** — ported from [claude-night-market/abstract](https://github.com/athola/claude-night-market/tree/master/plugins/abstract). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Plugin Review

Tiered quality review of plugins with dependency-aware scoping.

## Table of Contents

- [Tiers](#tiers)
- [Orchestration](#orchestration)
- [Scope Detection](#scope-detection)
- [Module Loading](#module-loading)
- [Verdict](#verdict)
- [Output Format](#output-format)
- [Quality Gate Mode](#quality-gate-mode)
- [Configuration](#configuration)

## Tiers

| Tier | Trigger | Scope | Depth | Duration |
|------|---------|-------|-------|----------|
| branch | Default | Affected + related | Quick gates | ~2 min |
| pr | Before merge | Affected + related | Standard | ~5 min |
| release | Before version bump | All 17 plugins | Full | ~15 min |

## Orchestration

1. **Detect scope**: parse `--tier` flag, find affected
   plugins from git diff, resolve related plugins from
   `docs/plugin-dependencies.json`
2. **Plan**: build check matrix (tier x plugin x role)
3. **Execute**: run checks per tier definition
4. **Report**: per-plugin table, aggregate verdict

## Scope Detection

Affected plugins: `git diff main --name-only` filtered to
`plugins/*/`.

Related plugins: load `docs/plugin-dependencies.json`,
look up each affected plugin's reverse index to find
dependents. Mark as "related" (lighter checks).

If `--tier release` or no git diff available, scope to
all plugins.

## Module Loading

- **Always**: this SKILL.md (orchestration logic)
- **branch tier**: load `modules/tier-branch.md`
- **pr tier**: load `modules/tier-branch.md` then
  `modules/tier-pr.md`
- **release tier**: load all tier modules plus
  `modules/tier-release.md`
- **When resolving deps**: load
  `modules/dependency-detection.md`

## Verdict

| Result | Meaning |
|--------|---------|
| PASS | All checks green |
| PASS-WITH-WARNINGS | Non-blocking issues |
| FAIL | Blocking issues found |

## Output Format

```
Plugin Review (<tier> tier)
Affected: <list>
Related:  <list> (<reason>)

Plugin          test  lint  type  reg   verdict
<name>          PASS  PASS  PASS  PASS  PASS
...

Verdict: <PASS|PASS-WITH-WARNINGS|FAIL> (N/N plugins healthy)
```

PR and release tiers add scorecard sections.

## Quality Gate Mode

The `--quality-gate` flag enables CI/CD integration with
exit codes that distinguish warnings from failures:

- `0`: all quality gates passed
- `1`: warnings present but gates passed (non-blocking)
- `2`: quality gate failures (blocking)
- `3`: critical issues found (blocking)

Use `--fail-on warning` to treat warnings as blocking.

## Configuration

Place a `.plugin-review.yaml` file in the plugin root
to customize thresholds and focus areas:

```yaml
plugin_review:
  quality_gates:
    structure_min: 80
    skills_min: 75
    hooks_min: 70
    tokens_max_total: 50000
    bloat_max_percentage: 15
  focus_areas:
    - skills
    - hooks
    - tokens
  exclude_patterns:
    - "*/legacy/*"
    - "*/deprecated/*"
  severity_overrides:
    missing_description: warning
    large_file: info
```

See the `/plugin-review` command reference for full
usage examples.
