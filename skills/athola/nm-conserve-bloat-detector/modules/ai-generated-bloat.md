---
module: ai-generated-bloat
category: tier-2
dependencies: [Bash, Grep, Read]
estimated_tokens: 200
---

# AI-Generated Bloat Detection Module

Detect bloat patterns specific to AI-assisted coding: vibe coding artifacts, slop patterns, and agent psychosis indicators.

## Why This Module Exists

AI coding has created qualitatively different bloat than traditional development:
- **2024**: First year copy/pasted lines exceeded refactored lines (GitClear)
- **Refactoring**: Dropped from 25% (2021) to <10% (2024), predicted 3% (2025)
- **Duplication**: 8x increase in 5+ line code blocks

## AI Bloat Patterns

### 1. Tab-Completion Bloat (Repetitive Logic)

**Definition**: Same pattern repeated 3+ times instead of abstracted into shared function.

```bash
# Detect similar code blocks (built-in, no external deps)
python3 plugins/conserve/scripts/detect_duplicates.py . --min-lines 5

# JSON output for CI integration
python3 plugins/conserve/scripts/detect_duplicates.py . --format json --threshold 15

# Heuristic: functions with near-identical signatures
grep -rn "^def " --include="*.py" . | cut -d: -f2 | sort | uniq -c | sort -rn | head -10
```

**Confidence**: HIGH (85%)
**Action**: REFACTOR - extract to shared utility
**Rationale**: AI suggests new implementations rather than reusing existing code

### 2. Massive Single Commits (Vibe Coding Signature)

**Definition**: Commits with >500 insertions, especially without proportional tests.

```bash
# Find vibe coding commits
git log --oneline --shortstat | grep -E "[0-9]{3,} insertion" | head -20

# Commits with high insertion:deletion ratio (adding without cleanup)
git log --shortstat --pretty=format:"%h %s" | awk '/insertion|deletion/ {
  ins=$4; del=$6;
  if (ins > 200 && (del == "" || ins/del > 10)) print prev, ins, del
} {prev=$0}'
```

**Confidence**: MEDIUM (70%)
**Action**: INVESTIGATE - review for understanding gaps
**Rationale**: Large additions without refactoring indicate Tab-driven development

### 3. Hallucinated Dependencies

**Definition**: Imports referencing non-existent packages (AI hallucination).

```bash
# Python: Check for uninstallable packages
pip freeze > /tmp/installed.txt
grep -rh "^import \|^from " --include="*.py" . | \
  sed 's/^import //;s/^from //;s/ import.*//' | \
  sort -u | while read pkg; do
    root=$(echo $pkg | cut -d. -f1)
    grep -q "^$root" /tmp/installed.txt || echo "HALLUCINATED?: $pkg"
  done

# JavaScript: Check for phantom packages
jq -r '.dependencies // {} | keys[]' package.json | while read pkg; do
  npm view $pkg version 2>/dev/null || echo "HALLUCINATED?: $pkg"
done
```

**Confidence**: HIGH (95%)
**Action**: DELETE or REPLACE
**Rationale**: AI invents plausible-sounding packages (slopsquatting risk)

### 4. Happy Path Only (Test Coverage Gap)

**Definition**: Code >200 lines with no corresponding tests, or tests without error assertions.

```bash
# Files without test coverage
find . -name "*.py" ! -path "*/test*" \
  -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  -exec sh -c '
  lines=$(wc -l < "$1")
  if [ $lines -gt 200 ]; then
    base=$(basename "$1" .py)
    test_exists=$(find . -name "test_${base}.py" -o -name "${base}_test.py" \
      -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
      -not -path "*/node_modules/*" -not -path "*/.git/*" | head -1)
    [ -z "$test_exists" ] && echo "UNTESTED ($lines lines): $1"
  fi
' _ {} \;

# Tests without error/exception assertions
grep -rL "assert.*Error\|assert.*Exception\|pytest.raises\|with self.assertRaises" \
  --include="test_*.py" .
```

**Confidence**: HIGH (90%)
**Action**: AUGMENT_TESTS before adding more code
**Rationale**: AI generates happy path; errors require human insight

### 5. Premature Abstraction

**Definition**: Base classes/interfaces with only 1-2 implementations.

```bash
# Python: Abstract classes with single inheritor
grep -rn "class.*ABC\|@abstractmethod" --include="*.py" . | cut -d: -f1 | sort -u | while read f; do
  class=$(grep -oP "class \K\w+" "$f" | head -1)
  inheritors=$(grep -rn "($class)" --include="*.py" . | wc -l)
  [ $inheritors -lt 2 ] && echo "PREMATURE: $class in $f (${inheritors} inheritors)"
done
```

**Confidence**: HIGH (85%)
**Action**: INLINE - remove abstraction until 3rd use case
**Rationale**: AI suggests "scalable" patterns for simple problems

### 6. Enterprise Cosplay

**Definition**: Microservices, Kubernetes, complex architecture for simple applications.

```bash
# Docker complexity for simple apps
if [ -f docker-compose.yml ]; then
  services=$(grep -c "^  [a-z].*:$" docker-compose.yml)
  code_lines=$(find . \( -name "*.py" -o -name "*.js" \) \
    -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
    -not -path "*/node_modules/*" -not -path "*/.git/*" | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
  ratio=$((code_lines / services))
  [ $ratio -lt 500 ] && echo "ENTERPRISE_COSPLAY: $services services for $code_lines lines"
fi

# Kubernetes for CRUD
[ -d k8s ] && [ $(find . -name "*.py" -not -path "*/.venv/*" -not -path "*/__pycache__/*" -not -path "*/node_modules/*" -not -path "*/.git/*" | xargs wc -l | tail -1 | awk '{print $1}') -lt 5000 ] && \
  echo "ENTERPRISE_COSPLAY: Kubernetes for <5000 lines"
```

**Confidence**: MEDIUM (70%)
**Action**: SIMPLIFY - evaluate if complexity is justified
**Rationale**: AI defaults to "production-ready" patterns without context

### 7. Documentation Slop

**Definition**: AI-generated docs with excessive hedging, formulaic structure, surface insights.

```bash
# Hedge word density (AI slop indicators)
hedge_words="worth noting|arguably|to some extent|it's important|consider that|generally speaking"
for f in $(find . -name "*.md" -not -path "*/.venv/*" -not -path "*/node_modules/*" -not -path "*/.git/*"); do
  total=$(wc -w < "$f")
  hedges=$(grep -oiE "$hedge_words" "$f" | wc -l)
  if [ $total -gt 100 ]; then
    density=$((hedges * 1000 / total))
    [ $density -gt 20 ] && echo "DOC_SLOP ($density/1000): $f"
  fi
done
```

**Confidence**: MEDIUM (65%)
**Action**: REWRITE with concrete specifics
**Rationale**: AI safety training creates artificial hedging

## Scoring

```python
AI_BLOAT_SCORES = {
    'tab_completion_bloat': 25,
    'massive_single_commit': 15,
    'hallucinated_dependency': 35,
    'happy_path_only': 30,
    'premature_abstraction': 20,
    'enterprise_cosplay': 25,
    'documentation_slop': 10,
}

def ai_bloat_score(detected_patterns):
    return min(100, sum(AI_BLOAT_SCORES.get(p, 0) for p in detected_patterns))
```

## Integration with Existing Tiers

**Tier 1 (Quick Scan)**: Massive single commits, hedge word density
**Tier 2 (Targeted)**: Duplication ratio, test coverage gaps, premature abstraction
**Tier 3 (Deep Audit)**: Hallucinated dependencies, enterprise cosplay analysis

## Output Format

```yaml
file: src/services/user_manager.py
ai_bloat_patterns:
  - tab_completion_bloat
  - happy_path_only
ai_bloat_score: 55/100
indicators:
  similar_blocks: 4
  test_coverage: 0%
  commit_size: 847 lines
confidence: HIGH
action: REFACTOR + ADD_TESTS
rationale: "Vibe coding signature - large addition without tests or abstraction"
```

## Prevention Recommendations

When AI bloat is detected, recommend:

1. **Refactoring Budget**: Add 25 lines of refactoring for every 100 lines added
2. **Test Requirement**: No merge without proportional test coverage
3. **Understanding Gate**: Require explanation of non-trivial changes
4. **24-Hour Rule**: Sleep before adopting new AI-suggested patterns

## Related

- `code-bloat-patterns` - Traditional anti-patterns (God class, Lava flow)
- `documentation-bloat` - Readability metrics
- `imbue:anti-cargo-cult` - Understanding verification protocol
- Knowledge corpus: `agent-psychosis-codebase-hygiene.md`
