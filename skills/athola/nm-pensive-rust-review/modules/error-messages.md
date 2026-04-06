---
name: error-messages
description: Detection of short error strings (under ~20 chars) in
  Err(), panic!(), and expect() that lack context or recovery hints
category: rust-review
tags: [error-handling, diagnostics, messages, quality]
---

# Error Messages

Analysis of error and panic messages for actionability.
Short messages without context make production incidents harder to diagnose.

## What This Detects

String literals under roughly 20 characters used in:

- `Err("short msg")`
- `panic!("short msg")`
- `.expect("short msg")`
- `Err("short msg".to_string())`

## Why It Matters

A message like `"not found"` or `"failed"` gives an on-call engineer no
information about what was not found, where the failure occurred, or how to
recover.

## Safe Patterns

```rust
// Good: identifies operation and input
.expect("failed to open config file at $CONFIG_PATH")

// Good: Err with context
return Err(format!(
    "user {} not found in tenant {}",
    user_id, tenant_id
));
```

## Patterns to Flag

```rust
// Bad: no context
.expect("failed")
.expect("not found")

// Bad: Err with bare short string
return Err("bad input");
return Err("denied".to_string());
```

## Output Section

```markdown
## Error Messages
### Issues Found
- [file:line] Short error message: [explanation]

### Recommendations
- Add operation context: what were you trying to do?
- Add input context: what value triggered the failure?
- Add recovery hints where possible
```
