---
module: quick-scan
category: tier-1
dependencies: [Bash, Grep, Glob]
estimated_tokens: 200
---

# Quick Scan Module

Fast heuristic-based bloat detection without external tools. Completes in < 5 minutes.

## Detection Patterns

### 1. Large Files (God Class Candidates)

```bash
# Find files > 500 lines (excluding cache and dependency directories)
find . -type f \( -name "*.py" -o -name "*.js" -o -name "*.ts" \) \
  -not -path "*/.venv/*" \
  -not -path "*/venv/*" \
  -not -path "*/__pycache__/*" \
  -not -path "*/.pytest_cache/*" \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" \
  -not -path "*/dist/*" \
  -not -path "*/build/*" \
  -not -path "*/.tox/*" \
  -not -path "*/.mypy_cache/*" \
  -not -path "*/.ruff_cache/*" | \
while read f; do
  lines=$(wc -l < "$f")
  if [ $lines -gt 500 ]; then
    echo "$lines $f"
  fi
done | sort -rn
```

**Thresholds:**
- Python: > 500 lines (God class likely)
- JavaScript/TypeScript: > 400 lines
- Markdown: > 300 lines (bloated docs)

**Confidence:** MEDIUM (70%) - Large size suggests but doesn't confirm bloat

### 2. Stale Files (Lava Flow)

```bash
# Files unchanged in 6+ months
git log --since="6 months ago" --name-only --pretty=format: | \
  sort -u > recent_files.txt

git ls-files | while read f; do
  if ! grep -qxF "$f" recent_files.txt; then
    last_modified=$(git log -1 --format="%ai" -- "$f")
    echo "$last_modified $f"
  fi
done | sort

rm recent_files.txt
```

**Thresholds:**
- > 12 months: HIGH confidence (95%)
- 6-12 months: MEDIUM confidence (75%)
- 3-6 months: LOW confidence (50%)

**False Positives:** Stable libraries, configuration files (check `.bloat-ignore`)

### 3. Commented Code Blocks

```bash
# Find large commented code blocks (Python)
grep -rn "^#.*def \|^#.*class \|^#.*import " --include="*.py" . | \
  awk '{print $1}' | uniq -c | sort -rn

# JavaScript/TypeScript
grep -rn "^//.*function \|^//.*class \|^//.*import " --include="*.js" --include="*.ts" . | \
  awk '{print $1}' | uniq -c | sort -rn
```

**Confidence:** HIGH (90%) - Commented code is rarely needed

### 4. Old TODOs/FIXMEs

```bash
# Find TODOs with dates > 3 months old
grep -rn "TODO\|FIXME\|HACK" --include="*.py" --include="*.js" --include="*.ts" --include="*.md" . | \
  grep -E "[0-9]{4}-[0-9]{2}" | \
  while read line; do
    # Extract date and compare (simplified - actual implementation would parse dates)
    echo "$line"
  done
```

**Thresholds:**
- > 12 months: Remove or convert to issue
- 6-12 months: Review for relevance
- 3-6 months: Monitor

**Confidence:** MEDIUM (70%) - Context-dependent

### 5. Duplicate Patterns

```bash
# Find potential duplicate files by name similarity (excluding cache directories)
find . -type f \( -name "*.py" -o -name "*.js" -o -name "*.ts" \) \
  -not -path "*/.venv/*" \
  -not -path "*/venv/*" \
  -not -path "*/__pycache__/*" \
  -not -path "*/.pytest_cache/*" \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" | \
  sed 's/.*\///' | sort | uniq -d

# Find duplicate files by content hash (excluding cache directories)
find . -type f -name "*.py" \
  -not -path "*/.venv/*" \
  -not -path "*/venv/*" \
  -not -path "*/__pycache__/*" \
  -not -path "*/.pytest_cache/*" \
  -not -path "*/.git/*" \
  -exec md5sum {} \; | \
  sort | uniq -w32 -D | cut -d' ' -f3-
```

**Confidence:** LOW (60%) - Needs manual review, may be intentional

## Scoring Algorithm

```python
def calculate_quick_scan_score(file_path, metrics):
    score = 0

    # Size penalty
    if metrics['lines'] > 500:
        score += (metrics['lines'] - 500) / 100 * 10

    # Staleness penalty
    months_unchanged = metrics['months_since_change']
    if months_unchanged > 12:
        score += 30  # High penalty
    elif months_unchanged > 6:
        score += 15  # Medium penalty

    # Commented code penalty
    commented_lines = metrics['commented_code_lines']
    score += commented_lines * 0.5

    # Old TODOs
    old_todos = metrics['todos_older_than_6mo']
    score += old_todos * 2

    # Normalize to 0-100
    return min(score, 100)
```

## Output Format

```yaml
file: path/to/bloated_file.py
bloat_score: 85
confidence: MEDIUM
signals:
  - large_file: 847 lines (threshold: 500)
  - stale: 18 months unchanged
  - commented_code: 23 lines
  - old_todos: 3 (oldest: 14 months)
token_estimate: ~3,200 tokens
recommendations:
  - action: DELETE
    rationale: No recent usage, high bloat score
    safety: Check for external references first
  - action: ARCHIVE
    rationale: Preserve history without active maintenance
    location: archive/legacy/
```

## Integration with Git Analysis

Quick scan coordinates with `git-history-analysis` module:
- Quick scan identifies candidates
- Git analysis validates with reference counting
- Combined confidence: HIGHER than either alone

## Performance

- **Target**: < 5 minutes for 10,000 files
- **Method**: Parallel grep, minimal disk I/O
- **Optimization**: Cache git log results, reuse across scans

## False Positive Handling

Respect `.bloat-ignore` patterns:

```gitignore
# .bloat-ignore - Patterns to exclude from bloat detection

# Cache directories (should always be excluded)
.venv/
venv/
__pycache__/
.pytest_cache/
.mypy_cache/
.ruff_cache/
.tox/
.git/

# Build and distribution
dist/
build/
*.egg-info/

# Dependencies
node_modules/
vendor/

# IDE and editor
.vscode/
.idea/

# Test fixtures and templates
tests/fixtures/*
config/*.template

# Auto-generated code
generated/*
*_pb2.py
```

**Default Exclusions**: The scan tools should automatically exclude common cache directories even without a `.bloat-ignore` file.

## Next Steps After Quick Scan

Based on findings:
- **High-confidence**: Proceed with cleanup
- **Medium-confidence**: Run Tier 2 for validation
- **Low-confidence**: Manual review required
