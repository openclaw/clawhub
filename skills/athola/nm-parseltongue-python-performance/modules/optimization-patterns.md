---
name: optimization-patterns
description: Ten proven optimization patterns for Python code including list comprehensions, generators, caching, and parallel processing
category: performance
tags: [optimization, patterns, performance, best-practices]
dependencies: []
estimated_tokens: 811
---

# Optimization Patterns

Proven patterns for optimizing Python code performance.

## Pattern 1: List Comprehensions vs Loops

```python
# Slow
def slow_squares(n):
    result = []
    for i in range(n):
        result.append(i**2)
    return result

# Fast (~2x speedup)
def fast_squares(n):
    return [i**2 for i in range(n)]
```

## Pattern 2: Generator Expressions for Memory

```python
import sys

# Memory-intensive
list_data = [i**2 for i in range(1000000)]  # ~40MB

# Memory-efficient
gen_data = (i**2 for i in range(1000000))   # ~200 bytes

# Use generators when you only iterate once
total = sum(i**2 for i in range(1000000))
```

## Pattern 3: String Concatenation

```python
# Slow (O(n²))
def slow_concat(items):
    result = ""
    for item in items:
        result += str(item)
    return result

# Fast (O(n))
def fast_concat(items):
    return "".join(str(item) for item in items)
```

## Pattern 4: Dictionary Lookups vs List Searches

```python
# O(n) - slow for large datasets
def list_search(items, target):
    return target in items

# O(1) - constant time
def dict_search(lookup_dict, target):
    return target in lookup_dict

# Convert to set/dict for repeated lookups
lookup_set = set(items)
```

## Pattern 5: Local Variable Access

```python
# Global access is slower
GLOBAL_VALUE = 100

def use_global():
    total = 0
    for i in range(10000):
        total += GLOBAL_VALUE  # Slower
    return total

def use_local():
    local_value = 100  # Cache locally
    total = 0
    for i in range(10000):
        total += local_value  # Faster
    return total
```

## Pattern 6: Caching with lru_cache

```python
from functools import lru_cache

@lru_cache(maxsize=None)
def fibonacci(n):
    if n < 2:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

# Without cache: O(2^n), With cache: O(n)
```

## Pattern 7: NumPy for Numerical Operations

```python
import numpy as np

# Pure Python
def python_multiply():
    a = list(range(100000))
    b = list(range(100000))
    return [x * y for x, y in zip(a, b)]

# NumPy (~100x faster)
def numpy_multiply():
    a = np.arange(100000)
    b = np.arange(100000)
    return a * b
```

## Pattern 8: __slots__ for Memory

```python
class RegularClass:
    def __init__(self, x, y, z):
        self.x = x
        self.y = y
        self.z = z

class SlottedClass:
    __slots__ = ['x', 'y', 'z']

    def __init__(self, x, y, z):
        self.x = x
        self.y = y
        self.z = z

# SlottedClass uses ~40% less memory per instance
```

## Pattern 9: Multiprocessing for CPU-Bound

```python
import multiprocessing as mp

def cpu_intensive_task(n):
    return sum(i**2 for i in range(n))

def parallel_processing():
    with mp.Pool(processes=4) as pool:
        results = pool.map(cpu_intensive_task, [1000000] * 4)
    return results
```

## Pattern 10: Batch Database Operations

```python
# Slow: Individual commits
def slow_inserts(conn, data):
    cursor = conn.cursor()
    for item in data:
        cursor.execute("INSERT INTO items VALUES (?)", (item,))
        conn.commit()  # Commit each insert

# Fast: Batch with single commit
def fast_inserts(conn, data):
    cursor = conn.cursor()
    cursor.executemany("INSERT INTO items VALUES (?)", [(d,) for d in data])
    conn.commit()  # Single commit
```
