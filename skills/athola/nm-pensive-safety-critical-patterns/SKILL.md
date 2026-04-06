---
name: safety-critical-patterns
description: |
  NASA Power of 10 rules adapted for writing robust, verifiable code with context-appropriate rigor
version: 1.8.1
triggers:
  - safety
  - defensive-coding
  - assertions
  - NASA
  - robustness
  - verification
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/pensive", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.pensive:shared", "night-market.pensive:code-refinement"]}}}
source: claude-night-market
source_plugin: pensive
---

> **Night Market Skill** — ported from [claude-night-market/pensive](https://github.com/athola/claude-night-market/tree/master/plugins/pensive). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Safety-Critical Coding Patterns

Guidelines adapted from NASA's Power of 10 rules for safety-critical software.

## When to Apply

**Full rigor**: Safety-critical systems, financial transactions, data integrity code
**Selective application**: Business logic, API handlers, core algorithms
**Light touch**: Scripts, prototypes, non-critical utilities

> "Match rigor to consequence" - The real engineering principle

## The 10 Rules (Adapted)

### 1. Restrict Control Flow
Avoid `goto`, `setjmp/longjmp`, and **limit recursion**.

**Why**: Ensures acyclic call graphs that tools can verify.
**Adaptation**: Recursion acceptable with provable termination (tail recursion, bounded depth).

### 2. Fixed Loop Bounds
All loops should have verifiable upper bounds.

```python
# Good - bound is clear
for i in range(min(len(items), MAX_ITEMS)):
    process(item)

# Risky - unbounded
while not_done:  # When does this end?
    process_next()
```

**Adaptation**: Document expected bounds; add safety limits on potentially unbounded loops.

### 3. No Dynamic Memory After Initialization
Avoid heap allocation in critical paths after startup.

**Why**: Prevents allocation failures at runtime.
**Adaptation**: Pre-allocate pools; use object reuse patterns in hot paths.

### 4. Function Length ~60 Lines
Functions should fit on one screen/page.

**Why**: Cognitive limits on comprehension remain valid.
**Adaptation**: Flexible for declarative code; strict for complex logic.

### 5. Assertion Density
Include defensive assertions documenting expectations.

```python
def transfer_funds(from_acct, to_acct, amount):
    assert from_acct != to_acct, "Cannot transfer to same account"
    assert amount > 0, "Transfer amount must be positive"
    assert from_acct.balance >= amount, "Insufficient funds"
    # ... implementation
```

**Adaptation**: Focus on boundary conditions and invariants, not arbitrary quotas.

### 6. Minimal Variable Scope
Declare variables at narrowest possible scope.

```python
# Good - scoped tightly
for item in items:
    total = calculate(item)  # Only exists in loop
    results.append(total)

# Avoid - unnecessarily broad
total = 0  # Why is this outside?
for item in items:
    total = calculate(item)
    results.append(total)
```

### 7. Check Return Values and Parameters
Validate inputs; never ignore return values.

```python
# Good
result = parse_config(path)
if result is None:
    raise ConfigError(f"Failed to parse {path}")

# Bad
parse_config(path)  # Ignored return
```

### 8. Limited Preprocessor/Metaprogramming
Restrict macros, decorators, and code generation.

**Why**: Makes static analysis possible.
**Adaptation**: Document metaprogramming thoroughly; prefer explicit over magic.

### 9. Pointer/Reference Discipline
Limit indirection levels; be explicit about ownership.

**Adaptation**: Use type hints, avoid deep nesting of optionals, prefer immutable data.

### 10. Enable All Warnings
Compile/lint with strictest settings from day one.

```bash
# Python
ruff check --select=ALL
mypy --strict

# TypeScript
tsc --strict --noImplicitAny
```

## Rules That May Not Apply

| Rule | When to Relax |
|------|---------------|
| No recursion | Tree traversal, parser combinators with bounded depth |
| No dynamic memory | GC languages, short-lived processes |
| 60-line functions | Declarative configs, state machines |
| No function pointers | Callbacks, event handlers, strategies |

## Integration

Reference this skill from:
- `pensive:code-refinement` - Clean code dimension
- `pensive:code-refinement` - Quality checks
- `sanctum:pr-review` - Code quality phase

## Sources

- NASA JPL Power of 10 Rules (Gerard Holzmann, 2006)
- MISRA C Guidelines
- HN discussion insights on practical application
