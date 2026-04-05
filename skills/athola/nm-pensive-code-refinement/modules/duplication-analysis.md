---
module: duplication-analysis
description: Detect and consolidate code duplication and redundancy
parent_skill: pensive:code-refinement
category: code-quality
tags: [duplication, redundancy, DRY, consolidation]
dependencies: [Bash, Grep, Glob, Read]
estimated_tokens: 400
---

# Duplication Analysis Module

Detect near-identical code blocks, similar functions, and copy-paste patterns.

## Why Duplication Matters

AI-assisted coding produces qualitatively different duplication:
- AI suggests new implementations rather than reusing existing code
- Tab-completion generates similar blocks instead of abstracting
- 8x increase in 5+ line duplicated blocks (GitClear 2024)

## Detection Methods

### 1. Exact Block Duplication

```bash
# Use conserve's detect_duplicates.py if available
python3 plugins/conserve/scripts/detect_duplicates.py . --min-lines 5 2>/dev/null || \
  echo "FALLBACK: Manual duplication scan"

# Fallback: hash-based detection (no external deps)
find . -name "*.py" -not -path "*/.venv/*" -not -path "*/node_modules/*" | while read f; do
  awk 'NR%5==1{hash=""; start=NR} {hash=hash $0} NR%5==0{print hash, FILENAME, start}' "$f"
done | sort | uniq -d -w 100
```

### 2. Similar Function Signatures

```bash
# Python: Functions with near-identical signatures
grep -rn "^def \|^    def " --include="*.py" . | \
  sed 's/(.*//' | sort -t: -k2 | uniq -f1 -d

# TypeScript/JavaScript: Similar function declarations
grep -rn "function \|const .* = (" --include="*.ts" --include="*.js" . | \
  sed 's/(.*//' | sort -t: -k2 | uniq -f1 -d

# Rust: Similar fn signatures
grep -rn "^pub fn \|^fn " --include="*.rs" . | \
  sed 's/(.*//' | sort -t: -k2 | uniq -f1 -d
```

### 3. Structural Similarity

Look for repeated patterns:
- Multiple if/elif chains with same structure
- Repeated try/except blocks with minor variations
- Similar class methods across different classes
- Parallel data transformation pipelines

```bash
# Find structurally similar blocks (Python)
grep -rn "if.*:\n.*elif.*:\n.*elif" --include="*.py" . 2>/dev/null

# Find repeated error handling patterns
grep -c "try:" --include="*.py" -r . | awk -F: '$2>3{print "HIGH_TRY_COUNT:", $0}'
```

## Consolidation Strategies

### Strategy 1: Extract Function
**When**: Same logic repeated 3+ times
```python
# Before: Repeated validation in 3 handlers
def handler_a(data):
    if not data.get('name'): raise ValueError("Missing name")
    if len(data['name']) > 100: raise ValueError("Name too long")
    ...

# After: Shared validation
def validate_name(data):
    if not data.get('name'): raise ValueError("Missing name")
    if len(data['name']) > 100: raise ValueError("Name too long")
```

### Strategy 2: Extract Base Class / Mixin
**When**: Multiple classes share 3+ methods with identical logic

### Strategy 3: Configuration-Driven
**When**: Same logic with different constants/parameters
```python
# Before: 5 similar report generators
# After: One generator with config
def generate_report(config: ReportConfig) -> Report: ...
```

### Strategy 4: Template Method Pattern
**When**: Same workflow, different steps

## Scoring

| Pattern | Severity | Confidence |
|---------|----------|------------|
| 10+ line exact duplicate | HIGH | 95% |
| 5-9 line exact duplicate | MEDIUM | 90% |
| Similar function signatures (3+) | MEDIUM | 80% |
| Structural similarity | LOW | 70% |

## Output Format

```yaml
finding: duplication
severity: HIGH
locations:
  - file: src/handlers/user.py
    lines: 45-62
  - file: src/handlers/order.py
    lines: 23-40
duplicate_lines: 18
strategy: extract_function
suggested_name: validate_entity_permissions
effort: SMALL
```
