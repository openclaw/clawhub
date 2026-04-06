---
name: best-practices
description: Best practices and common pitfalls for Python performance optimization
category: performance
tags: [best-practices, guidelines, optimization, pitfalls]
dependencies: [profiling-tools, optimization-patterns]
estimated_tokens: 207
---

# Best Practices

Guidelines and common pitfalls for Python performance optimization.

## Best Practices

1. **Profile before optimizing** - Measure to find real bottlenecks
2. **Focus on hot paths** - Optimize frequently executed code
3. **Use appropriate data structures** - Dict for lookups, set for membership
4. **Cache expensive computations** - Use lru_cache
5. **Batch I/O operations** - Reduce system calls
6. **Use generators** for large datasets
7. **Consider NumPy** for numerical operations

## Common Pitfalls

- Optimizing without profiling
- Using global variables unnecessarily
- Creating unnecessary copies of data
- Not using connection pooling
- Ignoring algorithmic complexity
- Over-optimizing rare code paths

## Exit Criteria

- Profiled code to identify bottlenecks
- Applied appropriate optimization patterns
- Verified improvements with benchmarks
- Memory usage acceptable
- No performance regressions
