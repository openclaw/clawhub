---
name: decisive-action
description: |
  Guidance on when to ask clarifying questions vs proceed with standard approaches. Reduces unnecessary interaction rounds
version: 1.8.1
triggers:
  - efficiency
  - workflow
  - decision-making
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/conserve", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: conserve
---

> **Night Market Skill** — ported from [claude-night-market/conserve](https://github.com/athola/claude-night-market/tree/master/plugins/conserve). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Core Principle](#core-principle)
- [When to Ask (High Impact Ambiguity)](#when-to-ask-high-impact-ambiguity)
- [When to Proceed Without Asking](#when-to-proceed-without-asking)
- [Decision Matrix](#decision-matrix)
- [Safety Mechanisms](#safety-mechanisms)
- [Examples](#examples)
- [Anti-Patterns](#anti-patterns)
- [Integration](#integration)

# Decisive Action

Guidance on when to ask clarifying questions versus proceeding autonomously.


## When To Use

- Reducing unnecessary clarifying questions
- Taking autonomous action when intent is clear

## When NOT To Use

- High-stakes irreversible operations requiring explicit confirmation
- Ambiguous requirements where clarification prevents wasted work

## Core Principle

Ask questions only when ambiguity would **materially impair correctness** or capacity to fulfill the request precisely.

## When to Ask (High Impact Ambiguity)

### Always Ask For

| Scenario | Why | Example |
|----------|-----|---------|
| **Destructive Operations** | Irreversible, high cost of error | "Delete which files?" |
| **Multiple Valid Approaches** | Materially different tradeoffs | "Add index vs cache vs denormalize?" |
| **Security-Critical** | Wrong choice = vulnerability | "Which auth method?" |
| **Data Migration** | Data loss risk | "Preserve or transform?" |
| **Breaking Changes** | Affects downstream users | "Deprecate or remove?" |

### Ask Threshold Checklist

Before asking, verify:
- [ ] >30% chance of wrong interpretation
- [ ] Error cost > correction cost
- [ ] No clear standard approach exists
- [ ] User context doesn't clarify intent

## When to Proceed Without Asking

### Default to Action For

| Scenario | Why | Assumption |
|----------|-----|------------|
| **Standard Approach Exists** | Industry convention | Use conventional pattern |
| **Easily Reversible** | Low cost of error | Can undo via git/backup |
| **Clear from Context** | Intent is obvious | Proceed with stated goal |
| **User Can Review** | PR/dry-run available | Changes are inspectable |

### Proceed Threshold Checklist

Proceed without asking if:
- [ ] Standard/obvious solution exists
- [ ] Easily reversible (git, backup)
- [ ] User can review before finalize
- [ ] Context makes intent clear
- [ ] Error cost < interruption cost

## Decision Matrix

| Reversibility | Ambiguity | Action |
|---------------|-----------|--------|
| Reversible | Low | **Proceed** |
| Reversible | High | **Proceed** with preview |
| Irreversible | Low | **Proceed** with confirmation |
| Irreversible | High | **Ask** |

## Safety Mechanisms

### Before Proceeding Autonomously

1. **Dry-run/Preview**: Show proposed action before executing
2. **Backup First**: Create git branch, backup directory
3. **Incremental Changes**: Commit small, reviewable chunks
4. **Document Assumptions**: In commit message or PR description

### Undo Capability

Always ensure rollback is possible:
- Git operations: `git stash`, backup branches
- File operations: Copy before modify
- Data operations: Transaction rollback

## Examples

### Example: Should Ask

**User**: "Delete the old files"

**Analysis**:
- Destructive operation ✗
- Multiple interpretations ✗
- No clear standard ✗

**Response**:
```
Which files should I delete? I found:
- Files unchanged >6 months: 23 files
- Files in deprecated/: 5 files
- Files marked TODO remove: 2 files
```

### Example: Should Proceed

**User**: "Add error handling to the parser"

**Analysis**:
- Standard approach exists ✓
- Easily reversible (git) ✓
- User can review PR ✓

**Action**: Implement try/catch with logging, create PR.

### Example: Proceed with Preview

**User**: "Refactor the API layer"

**Analysis**:
- Multiple valid approaches
- BUT: reversible via git
- AND: user can review

**Action**:
```
Refactoring API layer. Proposed changes:

1. Extract authentication middleware
2. Standardize error responses
3. Add request validation

Creating branch: refactor/api-layer
Preview diff available before merge.
```

## Anti-Patterns

### Asking Too Much (Inefficient)

- Asking for every implementation detail
- Seeking validation for obvious choices
- Repeating questions already answered in context

### Asking Too Little (Risky)

- Proceeding with destructive actions silently
- Assuming intent when multiple valid interpretations exist
- Ignoring ambiguity in security-critical operations

## Integration

Combine with:
- `conserve:response-compression` - Direct communication
- `sanctum:git-workspace-review` - Context gathering
- `imbue:scope-guard` - Scope management

## Quick Reference

| Situation | Action |
|-----------|--------|
| "Delete X" | **Ask** which X |
| "Add feature" | **Proceed** with standard approach |
| "Fix bug" | **Proceed** with obvious fix |
| "Choose between A/B" | **Ask** for preference |
| "Optimize query" | **Ask** if multiple approaches |
| "Format code" | **Proceed** with project style |
| "Deploy to prod" | **Ask** for confirmation |
