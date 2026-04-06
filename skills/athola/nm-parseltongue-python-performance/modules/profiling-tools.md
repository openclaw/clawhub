---
name: profiling-tools
description: CPU profiling with cProfile, line profiling, memory profiling, and production profiling with py-spy
category: performance
tags: [profiling, cProfile, memory-profiler, py-spy]
dependencies: []
estimated_tokens: 360
---

# Profiling Tools

detailed tools for profiling Python code performance and memory usage.

## CPU Profiling with cProfile

```python
import cProfile
import pstats
from pstats import SortKey

def main():
    # Your code here
    result = expensive_operation()
    return result

if __name__ == "__main__":
    profiler = cProfile.Profile()
    profiler.enable()

    main()

    profiler.disable()
    stats = pstats.Stats(profiler)
    stats.sort_stats(SortKey.CUMULATIVE)
    stats.print_stats(10)  # Top 10 functions
```

**Command-line profiling:**
```bash
python -m cProfile -o output.prof script.py
python -m pstats output.prof
```

## Line Profiling

```python
# Install: pip install line-profiler
from line_profiler import LineProfiler

def profile_function(func, *args, **kwargs):
    lp = LineProfiler()
    lp.add_function(func)
    lp_wrapper = lp(func)
    result = lp_wrapper(*args, **kwargs)
    lp.print_stats()
    return result
```

## Memory Profiling

```python
# Install: pip install memory-profiler
from memory_profiler import profile

@profile
def memory_intensive():
    big_list = [i for i in range(1000000)]
    big_dict = {i: i**2 for i in range(100000)}
    return sum(big_list)

# Run: python -m memory_profiler script.py
```

## Production Profiling with py-spy

```bash
# Install: pip install py-spy

# Profile running process
py-spy top --pid 12345

# Generate flamegraph
py-spy record -o profile.svg --pid 12345

# Profile script
py-spy record -o profile.svg -- python script.py
```
