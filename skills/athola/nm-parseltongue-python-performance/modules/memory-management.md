---
name: memory-management
description: Memory optimization techniques including leak tracking with tracemalloc and weak references for caches
category: performance
tags: [memory, optimization, tracemalloc, weak-references]
dependencies: [profiling-tools]
estimated_tokens: 167
---

# Memory Management

Techniques for optimizing memory usage and preventing memory leaks.

## Tracking Memory Leaks

```python
import tracemalloc

tracemalloc.start()

# Your code here
result = memory_intensive_operation()

snapshot = tracemalloc.take_snapshot()
top_stats = snapshot.statistics('lineno')

print("Top 10 memory allocations:")
for stat in top_stats[:10]:
    print(stat)
```

## Weak References for Caches

```python
import weakref

# Allows garbage collection when no strong references
weak_cache = weakref.WeakValueDictionary()

def get_resource(key):
    resource = weak_cache.get(key)
    if resource is None:
        resource = create_expensive_resource(key)
        weak_cache[key] = resource
    return resource
```
