---
module: git-history-analysis
category: tier-1
dependencies: [Bash, Grep]
estimated_tokens: 250
---

# Git History Analysis Module

Detect bloat using git history: staleness, churn metrics, and reference counting.

## Core Techniques

### 1. Staleness Detection

**Command:**
```bash
# Files not modified in last 6 months
git log --since="6 months ago" --name-only --pretty=format: | sort -u > recent.txt
comm -13 recent.txt <(git ls-files | sort) > stale_files.txt
```

**Staleness Scoring:**
```python
def staleness_score(months_since_change):
    if months_since_change > 24:
        return 95  # Almost certainly abandoned
    elif months_since_change > 12:
        return 85  # Likely abandoned
    elif months_since_change > 6:
        return 65  # Possibly stale
    else:
        return 20  # Active
```

**Confidence Modifiers:**
- File type: Config files -20%, code files +0%
- Last author: If single author who left project +15%
- Dependencies: If no imports found +25%

### 2. Reference Counting

**Detect unused files:**
```bash
# For each file, count references in codebase
git ls-files | while read file; do
  filename=$(basename "$file")
  refs=$(git grep -l "$filename" | wc -l)
  if [ $refs -eq 1 ]; then  # Only self-reference
    echo "0 $file"
  else
    echo "$((refs - 1)) $file"  # Subtract self
  fi
done | grep "^0 "
```

**Confidence:** HIGH (90%) if zero refs + stale

**False Positives:**
- Entry points (main.py, index.js)
- Configuration files
- Documentation

### 3. Code Churn Metrics

**Churn formula:**
```bash
# Lines added + deleted per file
git log --numstat --pretty="%H" -- $file | \
  awk '{added+=$1; deleted+=$2} END {print added+deleted}'
```

**Churn Categories:**
- **High churn (>1000 changes/year)**: Active development
- **Low churn (<50 changes/year)**: Stable or abandoned
- **Zero churn + old**: Strong bloat signal

**Hotspot Detection:**
```python
def is_hotspot(churn, complexity):
    """
    Hotspot = High churn × High complexity
    Indicates technical debt accumulation
    """
    churn_score = normalize_churn(churn)
    complexity_score = cyclomatic_complexity(file)
    return churn_score * complexity_score > threshold
```

### 4. Ownership Analysis

**Detect abandoned code:**
```bash
# Find files where primary author has no recent commits
git log --format="%an" --since="6 months ago" | sort -u > active_authors.txt

git ls-files | while read file; do
  primary_author=$(git log --format="%an" -- "$file" | sort | uniq -c | sort -rn | head -1 | awk '{$1=""; print $0}' | sed 's/^ //')
  if ! grep -qF "$primary_author" active_authors.txt; then
    echo "$file - Primary author inactive: $primary_author"
  fi
done
```

**Confidence:** MEDIUM (70%) - Ownership transfer is possible

### 5. Branch Analysis

**Detect orphaned feature branches:**
```bash
# Branches not merged in 6+ months
git for-each-ref --sort=-committerdate refs/heads/ --format='%(committerdate:short) %(refname:short)' | \
  while read date branch; do
    age_days=$(( ($(date +%s) - $(date -d "$date" +%s)) / 86400 ))
    if [ $age_days -gt 180 ]; then
      echo "$branch - ${age_days} days old"
    fi
  done
```

**Action:** Suggest cleanup or archival

## Integrated Analysis

### Multi-Signal Validation

Combine signals for higher confidence:

```python
def calculate_bloat_confidence(file):
    signals = []

    # Staleness
    months = months_since_last_change(file)
    if months > 12:
        signals.append(('stale', 85, months))

    # No references
    refs = count_references(file)
    if refs == 0:
        signals.append(('unused', 90, refs))

    # Low churn
    churn = calculate_churn(file)
    if churn < 50:  # < 50 changes/year
        signals.append(('low_churn', 70, churn))

    # Inactive owner
    if is_owner_inactive(file):
        signals.append(('inactive_owner', 65, None))

    # Combined confidence
    if len(signals) >= 3:
        return 'HIGH', signals
    elif len(signals) == 2:
        return 'MEDIUM', signals
    else:
        return 'LOW', signals
```

### Example Output

```yaml
file: src/deprecated/old_api.py
confidence: HIGH
signals:
  - type: stale
    score: 85
    detail: 18 months since last change
  - type: unused
    score: 90
    detail: Zero references found
  - type: low_churn
    score: 70
    detail: 12 changes in last year
combined_score: 82
recommendation: DELETE
rationale: |
  Multiple strong signals indicate abandonment:
  - No changes in 18 months
  - No code references
  - Minimal historical activity
  Safe to remove with archival backup.
```

## AskGit Integration (Optional)

If AskGit is available, use SQL for advanced queries:

```sql
-- Find files with high churn but low recent activity
SELECT
  file_path,
  SUM(additions + deletions) as total_churn,
  MAX(author_when) as last_change
FROM commits
WHERE author_when < date('now', '-6 months')
GROUP BY file_path
HAVING total_churn > 1000
ORDER BY total_churn DESC;
```

## Performance Optimization

**Caching Strategy:**
```bash
# Cache git log results for reuse
git log --all --numstat --pretty=format:'%H|%an|%ai' > /tmp/git_cache.txt

# Query cache instead of running git log repeatedly
grep "path/to/file" /tmp/git_cache.txt
```

**Incremental Updates:**
- Store previous scan results
- Only analyze changed files
- Delta reporting

## Safety Checks

Before flagging for deletion:

1. **Test Files**: Exclude `test_*.py`, `*.spec.js`
2. **Migrations**: Database migrations must never auto-delete
3. **CI/CD**: Files in `.github/`, `.gitlab-ci.yml`
4. **Documentation**: User-facing docs need manual review

**Whitelist Patterns:**
```yaml
safe_paths:
  - tests/
  - migrations/
  - .github/
  - docs/api/  # API docs are references, not code

excluded_from_bloat_analysis:
  # Cache directories (always exclude from counts)
  - .venv/
  - venv/
  - __pycache__/
  - .pytest_cache/
  - .mypy_cache/
  - .ruff_cache/
  - .tox/
  - .git/
  # Dependencies and build artifacts
  - node_modules/
  - vendor/
  - dist/
  - build/
```

## Integration with Quick Scan

Git analysis validates quick scan findings:

```python
def validate_quick_scan_finding(finding):
    # Quick scan says file is bloated
    # Git analysis confirms or refutes
    git_score = analyze_git_history(finding.file)

    if quick_scan.score > 80 and git_score > 80:
        return 'HIGH_CONFIDENCE'
    elif quick_scan.score > 60 and git_score > 60:
        return 'MEDIUM_CONFIDENCE'
    else:
        return 'LOW_CONFIDENCE'  # Conflicting signals
```

## Next Steps

Based on git analysis:
- **HIGH confidence**: Create cleanup PR
- **MEDIUM confidence**: Run static analysis (Tier 2)
- **LOW confidence**: Manual code review
