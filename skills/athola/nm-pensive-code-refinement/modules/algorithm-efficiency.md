---
module: algorithm-efficiency
description: Detect algorithmic inefficiencies and suggest improvements
parent_skill: pensive:code-refinement
category: code-quality
tags: [algorithms, complexity, performance, optimization]
dependencies: [Read, Grep, Glob]
estimated_tokens: 400
---

# Algorithm Efficiency Module

Identify time and space complexity inefficiencies at the code block level.

## Scope

This module focuses on **code-block-level** optimizations — not system architecture or database query optimization. It catches patterns where a better algorithm or data structure eliminates unnecessary work.

## Detection Patterns

### 1. Nested Loop on Same Collection (O(n^2) -> O(n) or O(n log n))

```python
# Anti-pattern: O(n^2) lookup
for item in items:
    for other in items:
        if item.id == other.parent_id:
            ...

# Better: O(n) with index
index = {item.id: item for item in items}
for item in items:
    parent = index.get(item.parent_id)
```

**Detection:**
```bash
# Find nested for-loops on same variable (Python)
grep -n "for .* in " --include="*.py" -r . | \
  awk -F: '{file=$1; line=$2; var=$0; gsub(/.*in /,"",var); gsub(/:.*/,"",var); print file, line, var}' | \
  sort | uniq -f2 -d
```

### 2. Repeated Sort / Search

```python
# Anti-pattern: sorting inside a loop
for query in queries:
    sorted_data = sorted(data)  # O(n log n) per query = O(m * n log n)
    result = bisect.bisect(sorted_data, query)

# Better: sort once
sorted_data = sorted(data)  # O(n log n) once
for query in queries:
    result = bisect.bisect(sorted_data, query)  # O(m * log n)
```

**Detection:**
```bash
# Find sort/sorted inside loops
grep -n "sorted\|\.sort()" --include="*.py" -r . | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  num=$(echo "$line" | cut -d: -f2)
  # Check if inside a for/while loop
  sed -n "$((num-5)),$((num))p" "$file" | grep -q "for \|while " && echo "SORT_IN_LOOP: $line"
done
```

### 3. List Where Set/Dict Suffices

```python
# Anti-pattern: O(n) membership test
if item in large_list:  # O(n)
    ...

# Better: O(1) membership test
large_set = set(large_list)
if item in large_set:  # O(1)
    ...
```

**Detection:**
```bash
# Find "in list_var" patterns (heuristic)
grep -n " in \[" --include="*.py" -r .
grep -n " not in " --include="*.py" -r . | grep -v "not in {" | grep -v "not in set("
```

### 4. String Concatenation in Loop

```python
# Anti-pattern: O(n^2) string building
result = ""
for item in items:
    result += str(item) + ", "

# Better: O(n) with join
result = ", ".join(str(item) for item in items)
```

### 5. Unnecessary Intermediate Collections

```python
# Anti-pattern: builds full list just to iterate
all_items = [transform(x) for x in data]  # allocates full list
for item in all_items:
    process(item)

# Better: generator (lazy evaluation)
for item in (transform(x) for x in data):
    process(item)
```

### 6. Repeated Computation (Missing Memoization)

```python
# Anti-pattern: recomputes expensive value
def get_result(n):
    # called 1000x with same n values
    return expensive_compute(n)

# Better: cache
from functools import lru_cache

@lru_cache(maxsize=128)
def get_result(n):
    return expensive_compute(n)
```

## Complexity Estimation Heuristics

Rather than formal Big-O analysis, use practical heuristics:

| Pattern | Likely Complexity | Flag When |
|---------|------------------|-----------|
| Single loop over data | O(n) | Data > 10K and no early exit |
| Nested loop, same data | O(n^2) | Always flag |
| Sort inside loop | O(m * n log n) | Always flag |
| `in list` inside loop | O(n * m) | List > 100 items |
| Recursive without memo | O(2^n) potential | Recursive calls > 1 |
| String concat in loop | O(n^2) | Loop > 100 iterations |

## Scoring

| Pattern | Severity | Confidence |
|---------|----------|------------|
| Nested loop, same data | HIGH | 85% |
| Sort/search in loop | HIGH | 90% |
| List where set suffices | MEDIUM | 80% |
| String concat in loop | MEDIUM | 85% |
| Missing memoization | LOW | 65% |
| Unnecessary intermediates | LOW | 70% |

## Output Format

```yaml
finding: algorithm-inefficiency
severity: HIGH
type: nested_loop_same_collection
location:
  file: src/matching.py
  lines: 45-58
current_complexity: O(n^2)
suggested_complexity: O(n)
strategy: build_index_first
effort: SMALL
```
