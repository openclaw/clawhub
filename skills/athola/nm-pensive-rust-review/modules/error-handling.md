---
name: error-handling
description: Result/Option patterns, custom error types, and error propagation analysis
category: rust-review
tags: [errors, result, option, propagation]
---

# Error Handling

Analysis of error handling patterns and correctness in Rust code.

## Result and Option Usage

Evaluate:
- `Result` and `Option` usage patterns
- Custom error types design
- Context addition with `anyhow` or `thiserror`
- `?` propagation correctness

## Error Type Design

Check custom error types:
- Implements `std::error::Error`
- Provides meaningful context
- Conversion traits (`From`, `Into`)
- Error hierarchy structure

## Error Propagation

Best practices:
```rust
// Good: Proper error propagation
fn process() -> Result<(), ProcessError> {
    let data = fetch().context("failed to fetch")?;
    validate(&data)?;
    Ok(())
}
```

## Common Issues to Flag

- Panics in library code (`unwrap`, `expect`)
- Logging side-effects in error paths
- Mismatched error hierarchies
- Missing retry/backoff logic
- Silent error swallowing
- Over-generic error types

## Error Context

Verify context is added:
- Operation context
- Input data context
- Failure reasons
- Recovery suggestions

## Output Section

```markdown
## Error Handling
### Issues Found
- [file:line] Panic in library: [details]
- [file:line] Missing context: [suggestion]

### Recommendations
- [error handling improvements]
```
