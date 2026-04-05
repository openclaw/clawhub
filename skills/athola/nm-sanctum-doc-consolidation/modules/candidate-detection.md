# Candidate Detection Module

Identifies markdown files that are candidates for consolidation.

## Detection Signals

Apply signals in priority order. A file is a candidate if it matches **any** signal.

### Signal 1: Git-Untracked Location (Highest Priority)

```bash
# Find untracked .md files
git status --porcelain | grep '^??' | grep '\.md$'
```

**Exclude standard locations:**
- `docs/` - Already permanent documentation
- `skills/` - Skill definitions
- `modules/` - Skill modules
- `commands/` - Slash commands
- `agents/` - Agent definitions
- `.github/` - GitHub templates

**Exclude standard names:**
- `README.md`, `README`
- `LICENSE.md`, `LICENSE`
- `CONTRIBUTING.md`
- `CHANGELOG.md`, `HISTORY.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`

### Signal 2: ALL_CAPS Naming Pattern

Files with ALL_CAPS names that aren't standard conventions:

```
MATCHES (candidates):
- API_REVIEW_REPORT.md
- REFACTORING_REPORT.md
- MIGRATION_ANALYSIS.md
- AUDIT_FINDINGS.md
- *_REPORT.md
- *_ANALYSIS.md
- *_REVIEW.md
- *_FINDINGS.md

EXCLUDES (not candidates):
- README.md
- LICENSE.md
- CONTRIBUTING.md
- CHANGELOG.md
- SECURITY.md
- CODE_OF_CONDUCT.md
```

### Signal 3: Content Markers

Scan first 100 lines for LLM output markers:

**Strong markers (any one = candidate):**
- `**Date**:` or `Date:` at start of line
- `## Executive Summary`
- `## Summary` (at document start)
- `## Findings`
- `## Action Items`
- `## Recommendations`
- `## Conclusion`

**Supporting markers (need 2+ to qualify):**
- Markdown tables with `|` columns
- `### High Priority` / `### Medium Priority` / `### Low Priority`
- `- [ ]` checkbox lists
- `## 1.` numbered top-level sections
- `**Scope**:` or `**Status**:`
- Lines starting with status markers

## Detection Algorithm

```python
def detect_candidates(repo_path: str) -> list[CandidateFile]:
    candidates = []

    # Get untracked markdown files
    untracked = git_untracked_md_files(repo_path)

    for file_path in untracked:
        # Skip standard locations
        if is_standard_location(file_path):
            continue

        # Skip standard names
        if is_standard_name(file_path):
            continue

        score = 0
        reasons = []

        # Check naming pattern
        if is_allcaps_nonstandard(file_path):
            score += 3
            reasons.append("ALL_CAPS non-standard name")

        # Check content markers
        content = read_first_n_lines(file_path, 100)
        strong, supporting = count_content_markers(content)

        if strong > 0:
            score += 3
            reasons.append(f"Strong markers: {strong}")

        if supporting >= 2:
            score += 2
            reasons.append(f"Supporting markers: {supporting}")

        # Threshold: score >= 2
        if score >= 2:
            candidates.append(CandidateFile(
                path=file_path,
                score=score,
                reasons=reasons
            ))

    return sorted(candidates, key=lambda c: c.score, reverse=True)
```

## Output Format

```markdown
## Detected Candidates

| File | Score | Reasons |
|------|-------|---------|
| API_REVIEW_REPORT.md | 6 | ALL_CAPS name, Strong markers: 3, Supporting: 4 |
| REFACTORING_REPORT.md | 5 | ALL_CAPS name, Strong markers: 2 |
| analysis-notes.md | 2 | Supporting markers: 3 |

Proceeding with 3 candidates...
```

## Edge Cases

### Nested untracked directories
If an entire directory is untracked, scan all `.md` files within:
```bash
git status --porcelain | grep '^??' | while read status path; do
  if [ -d "$path" ]; then
    find "$path" -name "*.md"
  fi
done
```

### Partially staged files
Files that are partially staged (`MM` or `AM` status) should be flagged for user attention - they may contain mixed committed/uncommitted content.

### Renamed/moved files
If git shows a rename (`R` status), check if the destination is a standard location. If moving TO a standard location, not a candidate.

## Validation

Before proceeding, confirm candidates with user:

```markdown
Found 3 consolidation candidates:

1. **API_REVIEW_REPORT.md** (score: 6)
   - ALL_CAPS non-standard name
   - Contains: Executive Summary, Findings, Action Items

2. **REFACTORING_REPORT.md** (score: 5)
   - ALL_CAPS non-standard name
   - Contains: Summary, Conclusion

3. **analysis-notes.md** (score: 2)
   - Contains: Multiple tables, checkbox lists

Analyze these files for consolidation? [Y/n/select specific]
```
