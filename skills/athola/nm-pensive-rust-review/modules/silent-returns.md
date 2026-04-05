---
name: silent-returns
description: Detection of let-else, if-let, and match arms that silently
  discard Result/Option values via bare return or continue
category: rust-review
tags: [error-handling, result, option, control-flow]
---

# Silent Returns

Analysis of control-flow branches that discard `Result` or `Option` values
without propagating or logging the reason for failure.

## What This Detects

Patterns where a branch exits the function or loop without surfacing why a
value was absent or erroneous:

- `let x = expr else { return; }` -- let-else with bare return
- `let x = expr else { continue; }` -- let-else with bare continue
- Match arms using `=> return` or `=> continue` on error/None variants

## Why It Matters

Silent discards hide failure information from callers and make bugs hard to
diagnose in production.
The `?` operator, `return Err(...)`, or at minimum a `log::warn!` call
should replace bare early exits.

## Safe Patterns

```rust
// Good: propagate the error
let value = expr?;

// Good: log before discarding
let Some(value) = optional else {
    log::warn!("expected value not present, skipping");
    continue;
};

// Good: return meaningful error
let Some(value) = optional else {
    return Err(MyError::MissingValue);
};
```

## Patterns to Flag

```rust
// Bad: silent discard
let Some(value) = optional else { return; };

// Bad: match arm drops error silently
match result {
    Ok(v) => v,
    Err(_) => return,
}
```

## Output Section

```markdown
## Silent Returns
### Issues Found
- [file:line] Silent discard: [explanation]

### Recommendations
- Replace bare `return` / `continue` with `return Err(...)` or log the cause
```
