---
module: code-bloat-patterns
category: tier-2
dependencies: [Bash, Grep, Read]
estimated_tokens: 150
---

# Code Bloat Patterns Module

Detect anti-patterns using pattern recognition and heuristics. Works without external tools.

> **Tool Preference (Claude Code 2.1.31+)**: The bash snippets in this module are reference implementations for external script execution or CI pipelines. When performing these analyses directly within Claude Code, prefer native tools: use Grep instead of `grep`, Glob instead of `find`, and Read instead of `cat`/`sed`.

## Anti-Patterns

### 1. God Class
**Definition:** Single class with > 500 lines, > 10 methods, multiple responsibilities.

```bash
# Quick detection
find . -name "*.py" \
  -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  -exec sh -c 'lines=$(wc -l < "$1"); [ $lines -gt 500 ] && echo "GOD_CLASS: $1 - $lines lines"' _ {} \;
```
**Confidence:** HIGH (85%) | **Action:** REFACTOR into focused modules

### 2. Lava Flow
**Definition:** Ancient untouched code - commented blocks, old TODOs.

```bash
# Find files with >20% commented code
grep -rn "^#\|^//" --include="*.py" . | cut -d: -f1 | sort | uniq -c | sort -rn | head -10
```
**Confidence:** HIGH (90%) | **Action:** DELETE commented code

### 3. Dead Code
**Detection:** Use static analysis (Vulture/Knip) or fallback heuristic:
```bash
# Heuristic: find functions with 0 calls
grep -rn "^def " --include="*.py" . | while read line; do
  func=$(echo $line | awk '{print $2}' | cut -d'(' -f1)
  [ $(git grep -c "$func(" 2>/dev/null || echo 0) -eq 1 ] && echo "DEAD: $func"
done
```
**Confidence:** MEDIUM (70%) heuristic, HIGH (90%) with tools | **Action:** DELETE

### 4. Import Bloat
```bash
# Star imports (block tree-shaking)
grep -rn "^from .* import \*" --include="*.py" .

# Unused imports (requires autoflake)
autoflake --check --remove-all-unused-imports -r .
```
**Confidence:** HIGH (95%) | **Action:** Fix imports

### 5. Duplication
**Intra-file:** Hash-based block detection (5+ line matches)
**Cross-file:** Function signature matching
**Semantic:** AST comparison (80%+ similarity)

**Confidence:** HIGH (85%) | **Action:** EXTRACT to shared utility

## Language-Specific

### Python
- Circular imports: Files with 20+ imports
- Deep nesting: > 4 indentation levels

### JavaScript/TypeScript
- Barrel files: `export * from` breaks tree-shaking
- CommonJS in ESM: `module.exports`/`require()` blocks bundler optimization

## AI-Amplified Patterns

These traditional patterns are amplified by AI coding tools:

### 6. Tab-Completion Duplication
**Definition:** AI suggests similar code blocks instead of reusing existing functions.
**2024 Data:** 8x increase in 5+ line duplicated blocks (GitClear)

```bash
# Quick detection: near-identical function signatures
grep -rn "^def " --include="*.py" . | awk -F'def ' '{print $2}' | \
  cut -d'(' -f1 | sort | uniq -c | sort -rn | awk '$1 > 1'
```
**Confidence:** HIGH (85%) | **Action:** EXTRACT shared utility

### 7. Dead Wrapper / Facade Bloat
**Definition:** Modules that wrap existing functionality without adding meaningful logic — thin facades, unused service interfaces, or re-export layers with no consumers.

**Signals:**
- File imports from another internal module and re-exports similar API
- No external imports of the wrapper (0 refs from outside itself)
- Not a proper package (missing `__init__.py` for Python)
- Docstring examples show imports but no actual code uses them
- Functionality already exists in the wrapped module or in `examples/`

```bash
# Find Python files that only re-export from other internal modules
for f in $(find . -name "*.py" -not -path "*/test*" -not -path "*/__pycache__/*" -not -path "*/.venv/*" -not -path "*/node_modules/*" -not -path "*/.git/*"); do
  # Check if file mostly imports and re-calls another module's functions
  imports=$(grep -c "^from \.\." "$f" 2>/dev/null || echo 0)
  total=$(wc -l < "$f" 2>/dev/null || echo 0)
  refs=$(git grep -l "$(basename "$f" .py)" -- "*.py" 2>/dev/null | grep -v "$f" | wc -l)
  if [ "$imports" -gt 2 ] && [ "$refs" -eq 0 ] && [ "$total" -gt 50 ]; then
    echo "DEAD_WRAPPER: $f ($total lines, $imports internal imports, 0 external refs)"
  fi
done
```

**Also check for intra-file dead wrappers:**
```bash
# Find classes/functions that only delegate to another method with no transformation
grep -rn "def .*self" --include="*.py" . | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  # Check if function body is just "return self.other_thing(...)"
  body=$(sed -n "$((lineno+1)),$((lineno+3))p" "$file" 2>/dev/null)
  if echo "$body" | grep -qP '^\s+return self\.\w+\(' && [ $(echo "$body" | wc -l) -le 2 ]; then
    echo "PASSTHROUGH: $file:$lineno - trivial delegation"
  fi
done
```

**Confidence:** HIGH (85%) for whole-file wrappers, MEDIUM (70%) for intra-file passthrough
**Action:** DELETE (whole-file) or INLINE (intra-file passthrough)

### 8. Premature Abstraction
**Definition:** Base classes/interfaces with <3 implementations (YAGNI violation).
**AI Cause:** AI defaults to "scalable" patterns without context.

```bash
# Find abstract classes with few inheritors
grep -rln "ABC\|abstractmethod" --include="*.py" . | while read f; do
  class=$(grep -oP "class \K\w+" "$f" | head -1)
  [ $(grep -rc "($class)" --include="*.py" . 2>/dev/null) -lt 3 ] && echo "PREMATURE: $class"
done
```
**Confidence:** HIGH (80%) | **Action:** INLINE until 3rd use case

### 9. Happy Path Bias
**Definition:** Tests verify success paths only; no error handling tested.
**AI Cause:** AI optimizes for "works" demonstrations.

```bash
# Tests without error assertions
grep -rL "Error\|Exception\|raises\|fail\|invalid" --include="test_*.py" .
```
**Confidence:** MEDIUM (70%) | **Action:** ADD error path tests

For comprehensive AI-specific patterns, see: `@module:ai-generated-bloat`

## Scoring

```python
PATTERN_SCORES = {
    'god_class': 30, 'lava_flow': 25, 'dead_code': 35,
    'import_bloat': 15, 'duplication': 20, 'dead_wrapper': 30
}
score = min(100, sum(PATTERN_SCORES[p] for p in detected))
```

## Output Format

```yaml
file: src/legacy/manager.py
patterns: [god_class, lava_flow, import_bloat]
bloat_score: 85/100
confidence: HIGH
token_estimate: ~3,400
action: REFACTOR
```

All actions require user approval.
