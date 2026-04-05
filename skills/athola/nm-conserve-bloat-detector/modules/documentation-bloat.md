---
module: documentation-bloat
category: tier-2
dependencies: [Bash, Grep, Read]
estimated_tokens: 120
---

# Documentation Bloat Module

Detect documentation redundancy, verbosity, and poor readability.

## Detection Categories

### 1. Duplicate Documentation

#### Cross-File (Jaccard Similarity)
```bash
# Quick similarity check between two files
words1=$(tr '[:space:]' '\n' < file1.md | sort -u)
words2=$(tr '[:space:]' '\n' < file2.md | sort -u)
# > 70% overlap = potential duplication
```

| Similarity | Confidence | Action |
|------------|------------|--------|
| > 90% | HIGH (95%) | DELETE one, keep recent |
| 70-90% | MEDIUM (80%) | MERGE, preserve unique |
| 50-70% | LOW (60%) | CROSS-LINK |

#### Intra-File (Section Hashing)
Hash each `##` section's normalized content. Duplicates = repeated sections.

**Confidence:** HIGH (85%)

### 2. Excessive Verbosity

| Metric | Threshold | Action |
|--------|-----------|--------|
| Word count | > 500 words/section | Condense |
| Sentence length | > 25 words avg | Simplify |
| Passive voice | > 30% | Rewrite active |
| Readability | Flesch < 40 | Simplify |

```bash
# Quick verbosity check
wc -w file.md  # Total words
rg -c '\.' file.md  # Approximate sentences (or grep -c)
```

### 3. Stale Documentation

| Signal | Confidence | Action |
|--------|------------|--------|
| Unchanged 12+ months | HIGH (85%) | Review/Archive |
| References deleted code | HIGH (90%) | Update/Delete |
| No git activity | MEDIUM (75%) | Investigate |

```bash
# Find stale docs
git log -1 --format="%ar" -- docs/*.md | rg -E "year|months"
# fallback: grep -E "year|months"
```

### 4. Missing/Outdated References

- Broken internal links: `rg -oP '\[.*?\]\((?!http).*?\)' *.md` (or `grep -oP`)
- References to deleted files
- Outdated API examples

**Confidence:** HIGH (90%) for broken links

## Scoring

```python
def doc_bloat_score(metrics):
    score = 0
    if metrics['duplicate_ratio'] > 0.3: score += 30
    if metrics['avg_words_per_section'] > 500: score += 20
    if metrics['readability'] < 40: score += 15
    if metrics['stale_months'] > 12: score += 25
    return min(100, score)
```

## Output Format

```yaml
file: docs/old-guide.md
bloat_type: [duplicate, verbose, stale]
bloat_score: 72/100
confidence: HIGH
token_estimate: ~1,200
similar_to: docs/guide.md (87%)
action: MERGE
```

## Related
- `quick-scan` - Tier 1 stale detection
- `git-history-analysis` - Activity signals
