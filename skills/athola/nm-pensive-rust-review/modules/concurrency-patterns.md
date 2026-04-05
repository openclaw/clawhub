---
name: concurrency-patterns
description: Concurrency cost hierarchy, synchronization primitives, async patterns, and performance-aware concurrency review
category: rust-review
tags: [concurrency, async, sync, deadlock, atomics, contention, performance]
---

# Concurrency Patterns

Analysis of concurrent and async code patterns in Rust,
grounded in the concurrency cost hierarchy.

## Concurrency Cost Hierarchy

"Acquiring a mutex isn't slow; contention is slow."
Before reviewing concurrency code, classify each
synchronization point by its cost tier.

| Level | Name | Approx Cost | Description |
|-------|------|-------------|-------------|
| 0 | Thread-local | ~2 ns | No atomics at all; per-thread state |
| 1 | Uncontended atomics | ~10 ns | Atomic ops, no cross-core sharing |
| 2 | Contended atomics | ~40-400 ns | Cache-line transfer between cores |
| 3 | Syscalls | ~1 us | Kernel transitions on lock paths |
| 4 | Context switches | ~10 us | Blocking locks, scheduler involvement |
| 5 | Catastrophe | ~ms+ | Spinning on oversubscribed systems |

Levels 3-5 are performance bugs. Target Level 2 as the
default. Achieve Level 1 through contention reduction.
Level 0 requires architectural redesign (per-thread
computation with periodic merges).

**Key insight**: Performance is dominated by atomic
instruction count, not total instruction count. An
algorithm with 9x more total instructions but the
same number of atomics performs identically.

### What to Flag in Review

- **Level 5**: Fair spin-locks on thread pools larger
  than core count. Always flag.
- **Level 4**: `std::sync::Condvar` wake patterns that
  convoy. Flag when hot path.
- **Level 3**: `sched_yield()` or `thread::yield_now()`
  in lock loops. Suggest backoff or parking.
- **Level 2 (avoidable)**: Atomic RMW on shared counter
  when per-thread counters + merge would suffice.
- **False sharing**: Independent atomics on the same
  cache line (64 bytes). Suggest `#[repr(align(64))]`
  or `crossbeam_utils::CachePadded`.

## Synchronization Primitives

Review primitives usage:

- `Arc`, `Mutex`, `RwLock`
- `Atomic*` types and ordering (`Relaxed` vs `SeqCst`)
- `tokio::sync` (mpsc, broadcast, watch, Semaphore)
- `Send`/`Sync` bounds
- `parking_lot` vs `std::sync` trade-offs

### Memory Ordering Review

Check ordering is neither too weak nor too strong:

- `Relaxed`: Counters, statistics (no cross-variable
  ordering needed)
- `Acquire`/`Release`: Publish/consume patterns,
  one-shot flags
- `SeqCst`: Only when total order across multiple
  atomics is required (rare; flag overuse)

## Async Patterns

Check async code:

- No blocking in async functions
- Proper `spawn_blocking` usage
- Guards dropped before awaiting
- Cancellation safety
- Task spawning patterns

## Best Practices

```rust
// Good: Drop guard before await
async fn update(data: Arc<Mutex<Data>>) {
    let value = {
        let guard = data.lock().await;
        guard.value.clone()
    }; // Guard dropped
    process(value).await;
}

// Good: Cache-padded to prevent false sharing
use crossbeam_utils::CachePadded;

struct Counters {
    reads: CachePadded<AtomicU64>,
    writes: CachePadded<AtomicU64>,
}
```

## Contention Reduction Patterns

When review finds Level 2+ contention on hot paths:

1. **Shard the lock**: `DashMap`, `ShardedLock`, or
   manual sharding by key hash
2. **Per-thread accumulation**: Thread-local counters
   merged at read time (Level 2 to Level 0)
3. **Read-copy-update (RCU)**: `arc-swap` for
   read-heavy, write-rare data
4. **Lock-free structures**: `crossbeam` queues and
   deques when contention dominates

## Deadlock Prevention

Identify potential deadlocks:

- Lock ordering consistency
- Nested locks
- Await points while holding locks
- Circular dependencies

## Data Race Detection

Check for:

- `static mut` misuse
- Shared mutable state
- Missing synchronization
- Race conditions

## Send/Sync Bounds

Verify:

- Proper trait bounds
- Thread safety guarantees
- Cross-thread data transfer
- Closure captures

## Common Issues

- Blocking in async context
- Guards held across await points
- Inconsistent lock ordering
- Missing bounds on generics
- Unsafe Send/Sync implementations
- `SeqCst` used everywhere (usually `Acquire`/`Release`
  suffices; `SeqCst` adds unnecessary fence cost)
- Spinning without backoff on oversubscribed systems
- False sharing between independent atomics

## Output Section

```markdown
## Concurrency
### Cost Classification
- [file:line] Level N: [primitive] - [justification]

### Issues Found
- [file:line] Guard held across await: [details]
- [file:line] Potential deadlock: [scenario]
- [file:line] False sharing risk: [layout details]
- [file:line] Unnecessary SeqCst: [suggest weaker ordering]

### Recommendations
- [concurrency improvements with cost tier impact]
```

## References

- Jon Gjengset, "The Cost of Concurrency Coordination"
  (video: youtube.com/watch?v=tND-wBBZ8RY)
- Travis Downs, "A Concurrency Cost Hierarchy"
  (travisdowns.github.io/blog/2020/07/06/concurrency-costs.html)
- Mara Bos, "Rust Atomics and Locks" (O'Reilly)
