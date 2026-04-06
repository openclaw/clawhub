---
name: benchmarking-tools
description: Benchmarking tools including custom decorators and pytest-benchmark for performance testing
category: performance
tags: [benchmarking, testing, performance, pytest-benchmark]
dependencies: []
estimated_tokens: 173
---

# Benchmarking Tools

Tools and techniques for benchmarking Python code performance.

## Custom Benchmark Decorator

```python
import time
from functools import wraps

def benchmark(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = time.perf_counter() - start
        print(f"{func.__name__}: {elapsed:.6f}s")
        return result
    return wrapper

@benchmark
def my_function():
    # Code to benchmark
    pass
```

## pytest-benchmark

```python
# Install: pip install pytest-benchmark

def test_list_comprehension(benchmark):
    result = benchmark(lambda: [i**2 for i in range(10000)])
    assert len(result) == 10000

# Run: pytest --benchmark-compare
```
