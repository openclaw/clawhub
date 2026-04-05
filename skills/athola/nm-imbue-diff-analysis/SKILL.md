---
name: diff-analysis
description: |
  Analyze changesets with risk scoring, categorization by type/impact, and release note preparation
version: 1.8.1
triggers:
  - changes
  - semantic-analysis
  - risk-assessment
  - categorization
  - summaries
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/imbue", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.imbue:proof-of-work"]}}}
source: claude-night-market
source_plugin: imbue
---

> **Night Market Skill** — ported from [claude-night-market/imbue](https://github.com/athola/claude-night-market/tree/master/plugins/imbue). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Activation Patterns](#activation-patterns)
- [4-Step Methodology](#4-step-methodology)
- [Exit Criteria](#exit-criteria)
- [Troubleshooting](#troubleshooting)

# Diff Analysis Methodology

## Overview

Structured method for analyzing changesets: categorize changes, assess risks, generate insights. Works for git diffs, configuration changes, API migrations, schema updates, or document revisions.

## When To Use
- Extracting insights from raw change data
- Categorizing and prioritizing changes before code reviews
- Preparing release notes or changelogs
- Assessing migration scope and risk

## When NOT To Use

- Quick context catchup - use catchup instead
- Full PR review - use review-core with pensive skills

## Activation Patterns
**Trigger Keywords**: diff, changes, release notes, changelog, migration, impact, risk assessment

**Auto-Load When**: Git diffs present, change analysis requested, impact assessment needed.

## Progressive Loading

Load modules based on workflow stage:

### Always Load
- `modules/semantic-categorization.md` for change categorization workflow

### Conditional Loading
- `modules/risk-assessment-framework.md` when risk assessment is needed
- `modules/git-diff-patterns.md` when working with git repositories

### Integration
- Use `sanctum:git-workspace-review` for git data gathering
- Use `imbue:proof-of-work` for capturing analysis evidence
- Use `imbue:structured-output` for formatting final deliverables

## Required TodoWrite Items
1. `diff-analysis:baseline-established`
2. `diff-analysis:changes-categorized`
3. `diff-analysis:risks-assessed`
4. `diff-analysis:summary-prepared`

Mark each item complete as you finish the corresponding step.

## 4-Step Methodology

### Step 1: Establish Baseline (`diff-analysis:baseline-established`)
Define comparison scope: what states are being compared, boundary of analysis, and scale metrics.

For git contexts, load `modules/git-diff-patterns.md`. For other contexts, compare relevant artifacts.

### Step 2: Categorize Changes (`diff-analysis:changes-categorized`)
Group changes by semantic type. Load `modules/semantic-categorization.md` for change categories, semantic categories, and prioritization.

### Step 3: Assess Risks (`diff-analysis:risks-assessed`)
Evaluate impact. Load `modules/risk-assessment-framework.md` for risk indicators, levels, and scoring methodology.

### Step 4: Prepare Summary (`diff-analysis:summary-prepared`)
Synthesize findings: theme, scope with counts, risk level, review focus, dependencies. Format for downstream consumption (PR descriptions, release notes, reviews).

## Exit Criteria
- All TodoWrite items completed with categorized changes and risk assessment
- Downstream workflows have semantic understanding of the changeset
- Summary ready for appropriate consumption (review, release notes, planning)
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
