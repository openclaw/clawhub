---
name: skills-eval
description: Evaluate and improve Claude skill quality through auditing
version: 1.8.1
triggers:
  - evaluation
  - improvement
  - skills
  - optimization
  - quality-assurance
  - tool-use
  - performance-metrics
  - reviewing
  - preparing for production
  - or auditing skills
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/abstract", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.modular-skills", "night-market.performance-optimization"]}}}
source: claude-night-market
source_plugin: abstract
---

> **Night Market Skill** — ported from [claude-night-market/abstract](https://github.com/athola/claude-night-market/tree/master/plugins/abstract). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Skills Evaluation and Improvement

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Evaluation Workflow](#evaluation-workflow)
4. [Evaluation and Optimization](#evaluation-and-optimization)
5. [Resources](#resources)

## Overview

This framework audits Claude skills against quality standards to improve performance and reduce token consumption. Automated tools analyze skill structure, measure context usage, and identify specific technical improvements. Run verification commands after each audit to confirm fixes work correctly.

The `skills-auditor` provides structural analysis, while the `improvement-suggester` ranks fixes by impact. Compliance is verified through the `compliance-checker`. Runtime efficiency is monitored by `tool-performance-analyzer` and `token-usage-tracker`.

## Quick Start

### Basic Audit
Run a full audit of all skills or target a specific file to identify structural issues.
```bash
# Audit all skills
make audit-all

# Audit specific skill
make audit-skill TARGET=path/to/skill/SKILL.md
```

### Analysis and Optimization
Use `skill_analyzer.py` for complexity checks and `token_estimator.py` to verify the context budget.
```bash
make analyze-skill TARGET=path/to/skill/SKILL.md
make estimate-tokens TARGET=path/to/skill/SKILL.md
```

### Improvements
Generate a prioritized plan and verify standards compliance using `improvement_suggester.py` and `compliance_checker.py`.
```bash
make improve-skill TARGET=path/to/skill/SKILL.md
make check-compliance TARGET=path/to/skill/SKILL.md
```

## Evaluation Workflow

Start with `make audit-all` to inventory skills and identify high-priority targets. For each skill requiring attention, run analysis with `analyze-skill` to map complexity. Generate an improvement plan, apply fixes, and run `check-compliance` to verify the skill meets project standards. Finalize by checking the token budget for efficiency.

## Evaluation and Optimization

Quality assessments use the `skills-auditor` and `improvement-suggester` to generate detailed reports. Performance analysis focuses on token efficiency through the `token-usage-tracker` and tool performance via `tool-performance-analyzer`. For standards compliance, the `compliance-checker` automates common fixes for structural issues.

### Scoring and Prioritization

We evaluate skills across five dimensions: structure compliance, content quality, token efficiency, activation reliability, and tool integration. Scores above 90 represent production-ready skills, while scores below 50 indicate critical issues requiring immediate attention.

Improvements are prioritized by impact. Critical issues include security vulnerabilities or broken functionality. High-priority items cover structural flaws that hinder discoverability. Medium and low priorities focus on best practices and minor optimizations.

### Structural Patterns

**Deprecated**: `skills/shared/modules/` directories. Shared modules must be relocated into the consuming skill's own `modules/` directory. The evaluator flags any remaining `skills/shared/` as a structural warning.

**Current**: Each skill owns its modules at `skills/<skill-name>/modules/`. Cross-skill references use relative paths (e.g., `../skill-authoring/modules/anti-rationalization.md`).

## Resources

### Shared Modules: Cross-Skill Patterns
- **Anti-Rationalization Patterns**: See [anti-rationalization.md](../skill-authoring/modules/anti-rationalization.md)
- **Enforcement Language**: See [enforcement-language.md](../shared-patterns/modules/workflow-patterns.md)
- **Trigger Patterns**: See [trigger-patterns.md](modules/evaluation-criteria.md)

### Skill-Specific Modules
- **Trigger Isolation Analysis**: See `modules/trigger-isolation-analysis.md`
- **Skill Authoring Best Practices**: See `modules/skill-authoring-best-practices.md`
- **Authoring Checklist**: See `modules/authoring-checklist.md`
- **Evaluation Workflows**: See `modules/evaluation-workflows.md`
- **Quality Metrics**: See `modules/quality-metrics.md`
- **Advanced Tool Use Analysis**: See `modules/advanced-tool-use-analysis.md`
- **Evaluation Framework**: See `modules/evaluation-framework.md`
- **Integration Patterns**: See `modules/integration.md`
- **Troubleshooting**: See `modules/troubleshooting.md`
- **Pressure Testing**: See `modules/pressure-testing.md`
- **Integration Testing**: See `modules/integration-testing.md`
- **Multi-Metric Evaluation**: See `modules/multi-metric-evaluation-methodology.md`
- **Performance Benchmarking**: See `modules/performance-benchmarking.md`

### Tools and Automation
- **Tools**: Executable analysis utilities in `scripts/` directory.
- **Automation**: Setup and validation scripts in `scripts/automation/`.
