---
name: duplicate-validators
description: Detection of multiple validate_*, check_*, or verify_* functions
  that share similar structure and could be consolidated
category: rust-review
tags: [design, duplication, validation, refactoring]
---

# Duplicate Validators

Analysis of `validate_*`, `check_*`, and `verify_*` functions for
opportunities to consolidate repeated validation logic.

## What This Detects

Three or more functions sharing the same verb prefix (`validate_`, `check_`,
`verify_`) within a single file, which often indicates copy-pasted validation
logic that could be unified.

## Why It Matters

Duplicated validation logic diverges over time: one copy gets a bug fix or a
new rule while the others do not.
Consolidating into a generic validator ensures all callers benefit from each
fix.

## Safe Patterns

```rust
// Good: single generic validator with rule injection
fn validate_field(value: &str, rules: &[ValidationRule])
    -> Result<(), ValidationError>
{
    for rule in rules {
        rule.apply(value)?;
    }
    Ok(())
}
```

## Patterns to Flag

```rust
// Flag when 3+ share the same prefix:
fn validate_email(s: &str) -> bool { ... }
fn validate_phone(s: &str) -> bool { ... }
fn validate_username(s: &str) -> bool { ... }
fn validate_password(s: &str) -> bool { ... }
```

## Output Section

```markdown
## Duplicate Validators
### Issues Found
- [file] 4 validate_* functions: [list]

### Recommendations
- Extract shared logic into a generic validator
- Use a trait or rule-set parameter to unify related checks
```
