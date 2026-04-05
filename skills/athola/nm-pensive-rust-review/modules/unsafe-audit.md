---
name: unsafe-audit
description: Unsafe block auditing, FFI contracts, and safety invariants
category: rust-review
tags: [unsafe, ffi, safety, invariants]
---

# Unsafe & FFI Audit

detailed audit of unsafe code and FFI boundaries.

## Unsafe Block Invariants

For each `unsafe` block, document:
- Pointer validity requirements
- Aliasing rules adherence
- Memory ordering guarantees
- Uninitialized memory handling
- FFI contracts

## SAFETY Comments

Every unsafe block must have:
- Clear safety comment
- Invariant documentation
- Caller requirements
- Pre/post conditions

## FFI Boundaries

Audit `extern "C"` interfaces:
- Representation alignment (`#[repr(C)]`)
- Ownership transfer semantics
- Resource cleanup guarantees
- Error code translation
- Null pointer handling

## Safe Abstraction Wrappers

Recommend wrapping unsafe in safe APIs:
```rust
// Wrap unsafe in safe API
pub fn safe_operation(ptr: NonNull<Data>) -> Result<(), Error> {
    // SAFETY: ptr is non-null and properly aligned
    // Caller guarantees exclusive access
    unsafe {
        (*ptr.as_ptr()).process()
    }
}
```

## Common Unsafe Patterns

Check for:
- Raw pointer dereferences
- Mutable static access
- Type transmutations
- Inline assembly
- Trait object manipulation

## Undefined Behavior Checks

Verify absence of:
- Use after free
- Double free
- Null pointer dereferences
- Data races in unsafe code
- Invalid enum discriminants

## Output Section

```markdown
## Unsafe Audit
### [U1] file:line
- Invariants: [documented]
- Risk: [high/medium/low]
- SAFETY comment: [present/missing]
- Recommendation: [action]

### Summary
- Total unsafe blocks: X
- Properly documented: Y
- Action required: Z
```
