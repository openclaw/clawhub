---
name: ownership-analysis
description: Borrowing patterns, lifetime annotations, and ownership semantics analysis
category: rust-review
tags: [ownership, borrowing, lifetimes, references]
---

# Ownership Analysis

Deep analysis of Rust's ownership, borrowing, and lifetime patterns.

## Borrowing Patterns

Inspect diffs for:
- Unnecessary clones
- Temporary allocations
- Misuse of `Rc<RefCell<_>>`
- Excessive `Arc` wrapping

## Lifetime Annotations

Check:
- Lifetime annotations correctness
- Reference scopes
- Ownership transfer semantics
- Lifetime elision applicability

## Clone Avoidance Patterns

Prefer borrowing over cloning:
```rust
// Prefer borrowing
fn process(data: &[u8]) -> Result<()>

// Use Cow for flexibility
fn normalize(s: Cow<str>) -> Cow<str>

// Iterators over collections
fn sum(items: impl Iterator<Item = i32>) -> i32
```

## Reference Scope Checking

Verify:
- Borrow checker satisfaction
- No dangling references
- Proper lifetime bounds
- Interior mutability patterns

## Common Issues

- **Unnecessary clones**: Use references when possible
- **Lifetime complexity**: Simplify with helper methods
- **Rc/Arc overuse**: validate shared ownership is needed
- **Temporary allocations**: Use stack when possible

## Output Section

```markdown
## Ownership Analysis
### Borrowing Issues
- [file:line] Unnecessary clone: [explanation]
- [file:line] Lifetime annotation: [suggestion]

### Recommendations
- [specific improvements]
```
