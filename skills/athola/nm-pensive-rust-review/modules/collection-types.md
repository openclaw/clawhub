---
name: collection-types
description: Detection of Vec used where HashSet or HashMap semantics apply,
  including contains loops, find loops, and dedup patterns
category: rust-review
tags: [collections, performance, vec, hashset, hashmap]
---

# Collection Types

Analysis of `Vec` usage where a different collection type would be more
correct or more efficient.

## What This Detects

- `vec.contains(&x)` -- O(n) membership test; `HashSet` gives O(1)
- `vec.dedup()` -- sorting + dedup pattern suggests a set
- `vec.iter().find(...)` / `vec.iter().position(...)` -- linear key lookup
  suggests `HashMap`

## Why It Matters

Using `Vec` for set or map operations produces O(n) behaviour where O(1) is
available.
It also signals unclear intent: a `HashSet` communicates uniqueness, a
`HashMap` communicates keyed access.

## Safe Patterns

```rust
// Good: set membership
let mut seen: HashSet<u64> = HashSet::new();
if seen.contains(&id) { ... }

// Good: keyed lookup
let mut index: HashMap<u64, User> = HashMap::new();
if let Some(user) = index.get(&id) { ... }
```

## Patterns to Flag

```rust
// Flag: O(n) membership on unbounded Vec
users.contains(&new_user)

// Flag: dedup implies uniqueness invariant
ids.sort();
ids.dedup();

// Flag: linear key scan
users.iter().find(|u| u.id == target_id)
```

## Output Section

```markdown
## Collection Types
### Issues Found
- [file:line] Vec used as set/map: [explanation]

### Recommendations
- Replace with HashSet for membership checks
- Replace with HashMap for keyed access
```
