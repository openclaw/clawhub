---
name: code-quality-analysis
description: Shared code quality analysis patterns for review skills
parent_skill: pensive:shared
category: review-infrastructure
tags: [code-quality, deduplication, redundancy, analysis, DRY]
reusable_by: [pensive:code-refinement, pensive:unified-review, sanctum:pr-review, pensive:bug-review]
estimated_tokens: 450
---

# Code Quality Analysis Module

Shared patterns for code quality and deduplication analysis across review contexts.

## Quick Detection Commands

### Duplication Detection

```bash
# Python: Find similar function signatures
grep -rn "^def \|^    def " --include="*.py" . | \
  sed 's/(.*//' | sort -t: -k2 | uniq -f1 -d

# TypeScript/JavaScript: Similar declarations
grep -rn "function \|const .* = (" --include="*.ts" --include="*.js" . | \
  sed 's/(.*//' | sort -t: -k2 | uniq -f1 -d

# Find repeated code blocks (5+ lines)
find . -name "*.py" -not -path "*/.venv/*" | while read f; do
  awk 'NR%5==1{hash=""; start=NR} {hash=hash $0} NR%5==0{print hash, FILENAME, start}' "$f"
done | sort | uniq -d -w 100 | head -10
```

### Redundancy Patterns

```bash
# Find similar error handling blocks
grep -c "try:" --include="*.py" -r . | awk -F: '$2>5{print "HIGH_TRY_COUNT:", $0}'

# Find repeated validation patterns
grep -rn "if not.*:" --include="*.py" . | \
  sed 's/if not \(.*\):/\1/' | sort | uniq -c | sort -rn | head -10
```

## Quality Dimensions

| Dimension | Detection Method | Severity |
|-----------|-----------------|----------|
| Exact duplication (10+ lines) | Hash-based | HIGH |
| Similar functions (3+) | Signature matching | MEDIUM |
| Repeated patterns | Structural analysis | LOW-MEDIUM |
| Copy-paste indicators | Comment/naming similarity | MEDIUM |

## Integration with PR Review

When invoked from `/pr-review`, analyze only changed files:

```bash
# Get changed files
CHANGED_FILES=$(gh pr diff $PR_NUMBER --name-only | grep -E '\.(py|ts|js|rs|go)$')

# Run targeted analysis on changed files only
for file in $CHANGED_FILES; do
  # Check for duplication within file
  # Check for redundancy with existing codebase
done
```

## Consolidation Strategies

| Pattern | Strategy | When to Apply |
|---------|----------|---------------|
| Same logic 3+ times | Extract function | Always |
| Multiple classes share methods | Extract base/mixin | 3+ shared methods |
| Same logic, different constants | Configuration-driven | 2+ occurrences |
| Same workflow, different steps | Template method | Clear workflow pattern |

## Output Format

```yaml
finding: code-quality
type: duplication|redundancy|complexity
severity: HIGH|MEDIUM|LOW
confidence: 70-95%
locations:
  - file: path/to/file.py
    lines: 45-62
  - file: path/to/other.py
    lines: 23-40
strategy: extract_function|extract_class|configure|template_method
effort: SMALL|MEDIUM|LARGE
```

## Full Analysis: Invoke pensive:code-refinement

For comprehensive code quality analysis, invoke the full `pensive:code-refinement` skill:

```
Skill(pensive:code-refinement)
```

This provides six analysis dimensions:

| Dimension | Module | What It Catches |
|-----------|--------|-----------------|
| Duplication & Redundancy | `duplication-analysis` | Near-identical blocks, similar functions, copy-paste |
| **Algorithmic Efficiency** | `algorithm-efficiency` | O(n^2) where O(n) works, unnecessary iterations, time/space complexity |
| Clean Code Violations | `clean-code-checks` | Long methods, deep nesting, poor naming, magic values |
| Architectural Fit | `architectural-fit` | Paradigm mismatches, coupling violations, leaky abstractions |
| Anti-Slop Patterns | `clean-code-checks` | Premature abstraction, enterprise cosplay, hollow patterns |
| Error Handling | `clean-code-checks` | Bare excepts, swallowed errors, happy-path-only |

## Cross-Reference

- **Full skill**: `Skill(pensive:code-refinement)` - All six dimensions
- **Algorithm efficiency**: `pensive:code-refinement/modules/algorithm-efficiency` - Time/space complexity analysis
- **Clean code**: `pensive:code-refinement/modules/clean-code-checks` - SOLID, naming, complexity
- **Architectural fit**: `pensive:code-refinement/modules/architectural-fit` - Coupling, cohesion, paradigm alignment
- **Makefile-specific**: `pensive:makefile-review/modules/deduplication-patterns` - Pattern rules, functions
- **Safety-critical patterns**: `pensive:safety-critical-patterns` - NASA Power of 10 adapted guidelines
