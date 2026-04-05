---
name: review-core
description: |
  Reusable scaffolding for review workflows with context establishment, evidence capture, and structured output
version: 1.8.1
triggers:
  - workflow
  - scaffolding
  - evidence
  - reporting
  - analysis
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/imbue", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: imbue
---

> **Night Market Skill** — ported from [claude-night-market/imbue](https://github.com/athola/claude-night-market/tree/master/plugins/imbue). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Core Review Workflow

## Table of Contents

1. [When to Use](#when-to-use)
2. [Activation Patterns](#activation-patterns)
3. [Required TodoWrite Items](#required-todowrite-items)
4. [Step 1 – Establish Context](#step-1--establish-context-review-corecontext-established)
5. [Step 2 – Inventory Scope](#step-2--inventory-scope-review-corescope-inventoried)
6. [Step 3 – Capture Evidence](#step-3--capture-evidence-review-coreevidence-captured)
7. [Step 4 – Structure Deliverables](#step-4--structure-deliverables-review-coredeliverables-structured)
8. [Step 5 – Contingency Plan](#step-5--contingency-plan-review-corecontingencies-documented)
9. [Troubleshooting](#troubleshooting)

## When To Use
- Use this skill at the beginning of any detailed review workflow (e.g., for architecture, math, or an API).
- It provides a consistent structure for capturing context, logging evidence, and formatting the final report, which makes the findings of different reviews comparable.

## When NOT To Use

- Diff-focused analysis - use diff-analysis

## Activation Patterns
**Trigger Keywords**: review, audit, analysis, assessment, evaluation, inspection
**Contextual Cues**:
- "review this code/design/architecture"
- "conduct an audit of"
- "analyze this for issues"
- "evaluate the quality of"
- "perform an assessment"

**Auto-Load When**: Any review-specific workflow is detected or when analysis methodologies are requested.

## Required TodoWrite Items
1. `review-core:context-established`
2. `review-core:scope-inventoried`
3. `review-core:evidence-captured`
4. `review-core:deliverables-structured`
5. `review-core:contingencies-documented`

## Step 1 – Establish Context (`review-core:context-established`)
- Confirm `pwd`, repo, branch, and upstream base (e.g., `git status -sb`, `git rev-parse --abbrev-ref HEAD`).
- Note comparison target (merge base, release tag) so later diffs reference a concrete range.
- Summarize the feature/bug/initiative under review plus stakeholders and deadlines.

## Step 2 – Inventory Scope (`review-core:scope-inventoried`)
- List relevant artifacts for this review: source files, configs, docs, specs, generated assets (OpenAPI, Makefiles, ADRs, notebooks, etc.).
- Record how you enumerated them (commands like `rg --files -g '*.mk'`, `ls docs`, `cargo metadata`).
- Capture assumptions or constraints inherited from the plan/issue so the domain-specific analysis can cite them.

## Step 3 – Capture Evidence (`review-core:evidence-captured`)
- Log every command/output that informs the review (e.g., `git diff --stat`, `make -pn`, `cargo doc`, `web.run` citations). Keep snippets or line numbers for later reference.
- Track open questions or variances found during preflight; if they block progress, record owners/timelines now.

## Step 4 – Structure Deliverables (`review-core:deliverables-structured`)
- Prepare the reporting skeleton shared by all reviews:
  - Summary (baseline, scope, recommendation)
  - Ordered findings (severity, file:line, principle violated, remediation)
  - Follow-up tasks (owner + due date)
  - Evidence appendix (commands, URLs, notebooks)
- validate the domain-specific checklist will populate each section before concluding.

## Step 5 – Contingency Plan (`review-core:contingencies-documented`)
- If a required tool or skill is unavailable (e.g., `web.run`), document the alternative steps that will be taken and any limitations this introduces. This helps reviewers understand any gaps in coverage.
- Note any outstanding approvals or data needed to complete the review.

## Exit Criteria
- All TodoWrite items complete with concrete notes (commands run, files listed, evidence paths).
- Domain-specific review can now assume consistent context/evidence/deliverable scaffolding and focus on specialized analysis.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
