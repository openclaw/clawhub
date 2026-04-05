---
module: clean-code-checks
description: Clean code violations, anti-slop patterns, and error handling checks
parent_skill: pensive:code-refinement
category: code-quality
tags: [clean-code, anti-slop, naming, error-handling, complexity]
dependencies: [Read, Grep, Glob, Bash]
estimated_tokens: 450
---

# Clean Code Checks Module

Detect violations of clean code principles, AI slop patterns, and error handling gaps.

Covers three dimensions: Clean Code, Anti-Slop, and Error Handling.

## Clean Code Violations

### 1. Long Methods (>30 lines)

```bash
# Python: Find long functions
grep -n "^def \|^    def " --include="*.py" -r . | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  num=$(echo "$line" | cut -d: -f2)
  # Count lines until next def or end
  length=$(sed -n "${num},\$p" "$file" | awk '/^def |^    def /{if(NR>1)exit}END{print NR}')
  [ "$length" -gt 30 ] && echo "LONG_METHOD ($length lines): $line"
done
```

**Refactoring**: Extract method, compose method pattern.

### 2. Deep Nesting (>3 levels)

```bash
# Find deeply nested code (4+ indent levels = 16+ spaces or 4+ tabs)
grep -rn "^                " --include="*.py" . | head -20
grep -rn "^\t\t\t\t" --include="*.js" --include="*.ts" . | head -20
```

**Refactoring**: Guard clauses, extract method, strategy pattern.

### 3. Magic Numbers and Strings

```bash
# Find magic numbers (excluding 0, 1, common constants)
grep -rn "[^a-zA-Z_][2-9][0-9]\{1,\}[^a-zA-Z_0-9\"']" --include="*.py" . | \
  grep -v "range\|port\|version\|#\|test_\|assert" | head -20
```

**Refactoring**: Extract to named constants.

### 4. Poor Naming

Indicators of AI-generated generic names:
```bash
# Find generic function names
grep -rn "def process\|def handle\|def manage\|def do_\|def run_" --include="*.py" . | \
  grep -v "test_\|__" | head -20

# Find single-letter variables (outside loops/lambdas)
grep -rn " [a-z] = " --include="*.py" . | grep -v "for [a-z] in\|lambda [a-z]" | head -20
```

### 5. God Classes (>300 lines or >10 methods)

```bash
# Python: Large classes
grep -c "def " --include="*.py" -r . | awk -F: '$2>10{print "GOD_CLASS:", $0}'
```

## Anti-Slop Patterns

AI-specific code smells that traditional linters miss.

### 1. Premature Abstraction

Base classes/interfaces with only 1 implementation.

```bash
# Python: ABC with single inheritor
grep -rn "class.*ABC\|@abstractmethod" --include="*.py" . | cut -d: -f1 | sort -u | while read f; do
  class=$(grep -oP "class \K\w+" "$f" | head -1)
  [ -n "$class" ] && {
    inheritors=$(grep -rn "($class)" --include="*.py" . | wc -l)
    [ "$inheritors" -lt 2 ] && echo "PREMATURE_ABSTRACTION: $class in $f ($inheritors inheritors)"
  }
done
```

### 2. Enterprise Cosplay

Over-engineered patterns for simple problems:
- Factory for a single type
- Strategy pattern with one strategy
- Observer with one subscriber
- Middleware chain for single operation

```bash
# Find *Factory, *Builder, *Strategy with few usages
for pattern in Factory Builder Strategy Observer; do
  grep -rn "class.*$pattern" --include="*.py" --include="*.ts" . 2>/dev/null | while read line; do
    class=$(echo "$line" | grep -oP "class \K\w+")
    refs=$(grep -rn "$class" --include="*.py" --include="*.ts" . | wc -l)
    [ "$refs" -lt 4 ] && echo "ENTERPRISE_COSPLAY ($refs refs): $line"
  done
done
```

### 3. Hollow Abstractions

Code that adds indirection without value:
```python
# Anti-pattern: Wrapper that just delegates
class UserService:
    def __init__(self, repo):
        self.repo = repo
    def get_user(self, id):
        return self.repo.get_user(id)  # Just passes through
    def save_user(self, user):
        return self.repo.save_user(user)  # Just passes through
```

### 4. Verbose Where Concise Suffices

AI tends toward verbosity. Look for:
- Explicit boolean returns: `if x: return True; else: return False`
- Unnecessary else after return
- Redundant variable assignments before return

## Error Handling Checks

### 1. Bare/Broad Excepts

```bash
# Find bare except
grep -rn "except:" --include="*.py" -r .
# Find overly broad except
grep -rn "except Exception:" --include="*.py" -r . | grep -v "logging\|logger\|log\."
```

### 2. Swallowed Errors

```bash
# except + pass (swallowed)
grep -A1 "except" --include="*.py" -r . | grep -B1 "pass$" | grep "except"
```

### 3. Happy-Path-Only Code

```bash
# Functions >50 lines without any error handling
grep -rn "^def " --include="*.py" . | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  num=$(echo "$line" | cut -d: -f2)
  block=$(sed -n "${num},$((num+60))p" "$file")
  has_error=$(echo "$block" | grep -c "raise\|except\|Error\|error\|Warning")
  lines=$(echo "$block" | wc -l)
  [ "$lines" -gt 50 ] && [ "$has_error" -eq 0 ] && echo "HAPPY_PATH_ONLY: $line"
done
```

## Scoring

| Pattern | Severity | Confidence |
|---------|----------|------------|
| Bare except / swallowed error | HIGH | 95% |
| God class (>300 lines) | HIGH | 90% |
| Long method (>50 lines) | MEDIUM | 90% |
| Premature abstraction | MEDIUM | 85% |
| Magic numbers | MEDIUM | 80% |
| Deep nesting (>4) | MEDIUM | 85% |
| Generic naming | LOW | 70% |
| Verbose patterns | LOW | 75% |

## Integration with conserve:code-quality-principles

If the `conserve` plugin is installed, reference `Skill(conserve:code-quality-principles)` for KISS, YAGNI, and SOLID principle definitions with language-specific examples.

**Fallback** (conserve not installed): This module contains sufficient built-in checks for clean code violations. The conserve skill adds richer examples and conflict resolution guidance (e.g., "KISS vs SOLID" trade-offs).
