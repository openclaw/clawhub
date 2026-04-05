---
name: subagent-testing
description: Test skills via RED/GREEN/REFACTOR TDD with fresh subagents
version: 1.8.1
triggers:
  - testing
  - validation
  - TDD
  - subagents
  - fresh-instances
  - validating skill behavior
  - preventing priming bias
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/abstract", "emoji": "\ud83e\uddea"}}
source: claude-night-market
source_plugin: abstract
---

> **Night Market Skill** — ported from [claude-night-market/abstract](https://github.com/athola/claude-night-market/tree/master/plugins/abstract). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Subagent Testing - TDD for Skills

Test skills with fresh subagent instances to prevent priming bias and validate effectiveness.

## Table of Contents

1. [Overview](#overview)
2. [Why Fresh Instances Matter](#why-fresh-instances-matter)
3. [Testing Methodology](#testing-methodology)
4. [Quick Start](#quick-start)
5. [Detailed Testing Guide](#detailed-testing-guide)
6. [Success Criteria](#success-criteria)

## Overview

**Fresh instances prevent priming:** Each test uses a new Claude conversation to verify
the skill's impact is measured, not conversation history effects.

## Why Fresh Instances Matter

### The Priming Problem
Running tests in the same conversation creates bias:
- Prior context influences responses
- Skill effects get mixed with conversation history
- Can't isolate skill's true impact

### Fresh Instance Benefits
- **Isolation**: Each test starts clean
- **Reproducibility**: Consistent baseline state
- **Measurement**: Clear before/after comparison
- **Validation**: Proves skill effectiveness, not priming

## Testing Methodology

Three-phase TDD-style approach:

### Phase 1: Baseline Testing (RED)
Test without skill to establish baseline behavior.

### Phase 2: With-Skill Testing (GREEN)
Test with skill loaded to measure improvements.

### Phase 3: Rationalization Testing (REFACTOR)
Test skill's anti-rationalization guardrails.

## Quick Start

```bash
# 1. Create baseline tests (without skill)
# Use 5 diverse scenarios
# Document full responses

# 2. Create with-skill tests (fresh instances)
# Load skill explicitly
# Use identical prompts
# Compare to baseline

# 3. Create rationalization tests
# Test anti-rationalization patterns
# Verify guardrails work
```

## Detailed Testing Guide

For complete testing patterns, examples, and templates:
- **[Testing Patterns](modules/testing-patterns.md)** - Full TDD methodology
- **[Test Examples](modules/testing-patterns.md)** - Baseline, with-skill, rationalization tests
- **[Analysis Templates](modules/testing-patterns.md)** - Scoring and comparison frameworks

## Success Criteria

- **Baseline**: Document 5+ diverse baseline scenarios
- **Improvement**: ≥50% improvement in skill-related metrics
- **Consistency**: Results reproducible across fresh instances
- **Rationalization Defense**: Guardrails prevent ≥80% of rationalization attempts

## See Also

- **skill-authoring**: Creating effective skills
- **bulletproof-skill**: Anti-rationalization patterns
- **test-skill**: Automated skill testing command
