---
name: unified-review
description: |
  Orchestrate multiple review types into a single multi-domain review with integrated reporting
version: 1.8.1
triggers:
  - review
  - orchestration
  - code-quality
  - analysis
  - multi-domain
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/pensive", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.pensive:shared", "night-market.imbue:proof-of-work", "night-market.imbue:structured-output"]}}}
source: claude-night-market
source_plugin: pensive
---

> **Night Market Skill** — ported from [claude-night-market/pensive](https://github.com/athola/claude-night-market/tree/master/plugins/pensive). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Quick Start](#quick-start)
- [When to Use](#when-to-use)
- [Review Skill Selection Matrix](#review-skill-selection-matrix)
- [Workflow](#workflow)
- [1. Analyze Repository Context](#1-analyze-repository-context)
- [2. Select Review Skills](#2-select-review-skills)
- [3. Execute Reviews](#3-execute-reviews)
- [4. Integrate Findings](#4-integrate-findings)
- [Review Modes](#review-modes)
- [Auto-Detect (default)](#auto-detect-(default))
- [Focused Mode](#focused-mode)
- [Full Review Mode](#full-review-mode)
- [Quality Gates](#quality-gates)
- [Deliverables](#deliverables)
- [Executive Summary](#executive-summary)
- [Domain-Specific Reports](#domain-specific-reports)
- [Integrated Action Plan](#integrated-action-plan)
- [Modular Architecture](#modular-architecture)
- [Exit Criteria](#exit-criteria)


# Unified Review Orchestration

Intelligently selects and executes appropriate review skills based on codebase analysis and context.

## Quick Start

```bash
# Auto-detect and run appropriate reviews
/full-review

# Focus on specific areas
/full-review api          # API surface review
/full-review architecture # Architecture review
/full-review bugs         # Bug hunting
/full-review tests        # Test suite review
/full-review all          # Run all applicable skills
```
**Verification:** Run `pytest -v` to verify tests pass.

## When To Use

- Starting a full code review
- Reviewing changes across multiple domains
- Need intelligent selection of review skills
- Want integrated reporting from multiple review types
- Before merging major feature branches

## When NOT To Use

- Specific review type known
  - use bug-review
- Test-review
- Architecture-only focus - use
  architecture-review
- Specific review type known
  - use bug-review

## Review Skill Selection Matrix

| Codebase Pattern | Review Skills | Triggers |
|-----------------|---------------|----------|
| Rust files (`*.rs`, `Cargo.toml`) | rust-review, bug-review, api-review | Rust project detected |
| API changes (`openapi.yaml`, `routes/`) | api-review, architecture-review | Public API surfaces |
| Test files (`test_*.py`, `*_test.go`) | test-review, bug-review | Test infrastructure |
| Makefile/build system | makefile-review, architecture-review | Build complexity |
| Mathematical algorithms | math-review, bug-review | Numerical computation |
| Architecture docs/ADRs | architecture-review, api-review | System design |
| General code quality | bug-review, test-review | Default review |

## Workflow

### 1. Analyze Repository Context
- Detect primary languages from extensions and manifests
- Analyze git status and diffs for change scope
- Identify project structure (monorepo, microservices, library)
- Detect build systems, testing frameworks, documentation

### 2. Select Review Skills
```python
# Detection logic
if has_rust_files():
    schedule_skill("rust-review")
if has_api_changes():
    schedule_skill("api-review")
if has_test_files():
    schedule_skill("test-review")
if has_makefiles():
    schedule_skill("makefile-review")
if has_math_code():
    schedule_skill("math-review")
if has_architecture_changes():
    schedule_skill("architecture-review")
# Default
schedule_skill("bug-review")
```
**Verification:** Run `pytest -v` to verify tests pass.

### 3. Execute Reviews

Dispatch selected skills concurrently via the Agent tool.
Use this mapping to resolve skill names to agent types:

| Skill Name | Agent Type | Notes |
|---|---|---|
| bug-review | `pensive:code-reviewer` | Covers bugs, API, tests |
| api-review | `pensive:code-reviewer` | Same agent, API focus |
| test-review | `pensive:code-reviewer` | Same agent, test focus |
| architecture-review | `pensive:architecture-reviewer` | ADR compliance |
| rust-review | `pensive:rust-auditor` | Rust-specific |
| code-refinement | `pensive:code-refiner` | Duplication, quality |
| math-review | `general-purpose` | Prompt: invoke `Skill(pensive:math-review)` |
| makefile-review | `general-purpose` | Prompt: invoke `Skill(pensive:makefile-review)` |
| shell-review | `general-purpose` | Prompt: invoke `Skill(pensive:shell-review)` |

**Rules:**
- Never use skill names as agent types (e.g., `pensive:math-review` is NOT an agent)
- When `pensive:code-reviewer` covers multiple domains, dispatch once with combined scope
- For skills without dedicated agents, use `general-purpose` and instruct it to invoke the Skill tool
- Maintain consistent evidence logging across all agents
- Track progress via TodoWrite

### 4. Integrate Findings

- Consolidate findings across domains
- Identify cross-domain patterns
- Prioritize by impact and effort
- Generate unified action plan

**Deferred capture for backlog findings:**
Findings that are triaged to the backlog (out-of-scope for
the current review or deferred by the team) should be
preserved so they are not lost between review cycles.
For each finding assigned to the backlog, run:

```bash
python3 scripts/deferred_capture.py \
  --title "<finding title>" \
  --source review \
  --context "Review dimension: <dimension>. <finding description>"
```

The `<dimension>` value should match the review skill that
surfaced the finding (e.g. `bug-review`, `api-review`,
`architecture-review`).
This runs automatically after the action plan is finalised,
without prompting the user.

## Review Modes

### Auto-Detect (default)
Automatically selects skills based on codebase analysis.

### Focused Mode
Run specific review domains:
- `/full-review api` → api-review only
- `/full-review architecture` → architecture-review only
- `/full-review bugs` → bug-review only
- `/full-review tests` → test-review only

### Full Review Mode
Run all applicable review skills:
- `/full-review all` → Execute all detected skills

## Quality Gates

Each review must:
1. Establish proper context
2. Execute all selected skills successfully
3. Document findings with evidence
4. Prioritize recommendations by impact
5. Create action plan with owners

## Deliverables

### Executive Summary
- Overall codebase health assessment
- Critical issues requiring immediate attention
- Review frequency recommendations

### Domain-Specific Reports
- API surface analysis and consistency
- Architecture alignment with ADRs
- Test coverage gaps and improvements
- Bug analysis and security findings
- Performance and maintainability recommendations

### Integrated Action Plan
- Prioritized remediation tasks
- Cross-domain dependencies
- Assigned owners and target dates
- Follow-up review schedule

## Modular Architecture

All review skills use a hub-and-spoke architecture with progressive loading:

- **`pensive:shared`**: Common workflow, output templates, quality checklists
- **Each skill has `modules/`**: Domain-specific details loaded on demand
- **Cross-plugin deps**: `imbue:proof-of-work`, `imbue:diff-analysis/modules/risk-assessment-framework`

This reduces token usage by 50-70% for focused reviews while maintaining full capabilities.

## Exit Criteria

- All selected review skills executed
- Findings consolidated and prioritized
- Action plan created with ownership
- Evidence logged per structured output format
## Supporting Modules

- [Review workflow core](modules/review-workflow-core.md) - standard 5-step workflow pattern for all pensive reviews
- [Output format templates](modules/output-format-templates.md) - finding entry, severity, action item templates
- [Quality checklist patterns](modules/quality-checklist-patterns.md) - pre-review, analysis, evidence, deliverable checklists

## Troubleshooting

### Common Issues

If the auto-detection fails to identify the correct review skills, explicitly specify the mode (e.g., `/full-review rust` instead of just `/full-review`). If integration fails, check that `TodoWrite` logs are accessible and that evidence files were correctly written by the individual skills.
