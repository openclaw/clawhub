---
name: math-review
description: |
  Verify math-heavy code for algorithm correctness, numerical stability, and standards alignment
version: 1.8.1
triggers:
  - math
  - algorithms
  - numerical
  - stability
  - verification
  - scientific
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/pensive", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.pensive:shared", "night-market.imbue:proof-of-work"]}}}
source: claude-night-market
source_plugin: pensive
---

> **Night Market Skill** — ported from [claude-night-market/pensive](https://github.com/athola/claude-night-market/tree/master/plugins/pensive). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Quick Start](#quick-start)
- [When to Use](#when-to-use)
- [Required TodoWrite Items](#required-todowrite-items)
- [Core Workflow](#core-workflow)
- [1. Context Sync](#1-context-sync)
- [2. Requirements Mapping](#2-requirements-mapping)
- [3. Derivation Verification](#3-derivation-verification)
- [4. Stability Assessment](#4-stability-assessment)
- [5. Proof of Work](#5-proof-of-work)
- [Progressive Loading](#progressive-loading)
- [Essential Checklist](#essential-checklist)
- [Output Format](#output-format)
- [Summary](#summary)
- [Context](#context)
- [Requirements Analysis](#requirements-analysis)
- [Derivation Review](#derivation-review)
- [Stability Analysis](#stability-analysis)
- [Issues](#issues)
- [Recommendation](#recommendation)
- [Exit Criteria](#exit-criteria)


# Mathematical Algorithm Review

Intensive analysis ensuring numerical stability and alignment with standards.

## Quick Start

```bash
/math-review
```
**Verification:** Run the command with `--help` flag to verify availability.

## When To Use

- Changes to mathematical models or algorithms
- Statistical routines or probabilistic logic
- Numerical integration or optimization
- Scientific computing code
- ML/AI model implementations
- Safety-critical calculations

## When NOT To Use

- General algorithm review -
  use architecture-review
- Performance optimization - use parseltongue:python-performance
- General algorithm review -
  use architecture-review
- Performance optimization - use parseltongue:python-performance

## Required TodoWrite Items

1. `math-review:context-synced`
2. `math-review:requirements-mapped`
3. `math-review:derivations-verified`
4. `math-review:stability-assessed`
5. `math-review:evidence-logged`

## Core Workflow

### 1. Context Sync
```bash
pwd && git status -sb && git diff --stat origin/main..HEAD
```
**Verification:** Run `git status` to confirm working tree state.
Enumerate math-heavy files (source, tests, docs, notebooks). Classify risk: safety-critical, financial, ML fairness.

### 2. Requirements Mapping
Translate requirements → mathematical invariants. Document pre/post conditions, conservation laws, bounds. **Load**: `modules/requirements-mapping.md`

### 3. Derivation Verification
Re-derive formulas using CAS. Challenge approximations. Cite authoritative standards (NASA-STD-7009, ASME VVUQ). **Load**: `modules/derivation-verification.md`

### 4. Stability Assessment
Evaluate conditioning, precision, scaling, randomness. Compare complexity. Quantify uncertainty. **Load**: `modules/numerical-stability.md`

### 5. Proof of Work
```bash
pytest tests/math/ --benchmark
jupyter nbconvert --execute derivation.ipynb
```
**Verification:** Run `pytest -v tests/math/` to verify.
Log deviations, recommend: Approve / Approve with actions / Block. **Load**: `modules/testing-strategies.md`

## Progressive Loading

**Default (200 tokens)**: Core workflow, checklists
**+Requirements** (+300 tokens): Invariants, pre/post conditions, coverage analysis
**+Derivation** (+350 tokens): CAS verification, standards, citations
**+Stability** (+400 tokens): Numerical properties, precision, complexity
**+Testing** (+350 tokens): Edge cases, benchmarks, reproducibility

**Total with all modules**: ~1600 tokens

## Essential Checklist

**Correctness**: Formulas match spec | Edge cases handled | Units consistent | Domain enforced
**Stability**: Condition number OK | Precision sufficient | No cancellation | Overflow prevented
**Verification**: Derivations documented | References cited | Tests cover invariants | Benchmarks reproducible
**Documentation**: Assumptions stated | Limitations documented | Error bounds specified | References linked

## Output Format

```markdown
## Summary
[Brief findings]

## Context
Files | Risk classification | Standards

## Requirements Analysis
| Invariant | Verified | Evidence |

## Derivation Review
[Status and conflicts]

## Stability Analysis
Condition number | Precision | Risks

## Issues
[M1] [Title]: Location | Issue | Fix

## Recommendation
Approve / Approve with actions / Block
```
**Verification:** Run the command with `--help` flag to verify availability.

## Exit Criteria

- Context synced, requirements mapped, derivations verified, stability assessed, evidence logged with citations
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
