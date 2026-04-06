---
name: cfg-test-misuse
description: Detection of #[cfg(test)] applied to individual functions or
  impls outside a mod tests block, which is a common structural mistake
category: rust-review
tags: [testing, cfg, attributes, structure]
---

# cfg(test) Misuse

Analysis of `#[cfg(test)]` placement on individual items outside a
`mod tests { ... }` block.

## What This Detects

`#[cfg(test)]` on a standalone `fn`, `impl`, or `struct` that is not nested
inside a `mod tests` block.

## Why It Matters

The idiomatic pattern is a single `mod tests` block gated with `#[cfg(test)]`,
which keeps test code in one place.
Applying `#[cfg(test)]` to an individual `impl` block is particularly
hazardous: it removes method implementations from the production binary
without an obvious compiler warning.

## Safe Patterns

```rust
// Good: single gated mod tests block
#[cfg(test)]
mod tests {
    use super::*;

    fn helper() { ... }

    #[test]
    fn test_something() { ... }
}
```

## Patterns to Flag

```rust
// Bad: cfg(test) on standalone function
#[cfg(test)]
fn setup_fixture() { ... }

// Bad: cfg(test) on impl block outside mod tests
#[cfg(test)]
impl MyStruct {
    fn test_helper(&self) { ... }
}
```

## Output Section

```markdown
## cfg(test) Misuse
### Issues Found
- [file:line] cfg(test) outside mod tests: [explanation]

### Recommendations
- Move all test-only items inside a single `#[cfg(test)] mod tests` block
```
