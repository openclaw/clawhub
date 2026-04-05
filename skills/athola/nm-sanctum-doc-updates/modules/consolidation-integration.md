# Consolidation Integration Module

Bridges doc-updates with doc-consolidation capabilities. Detects redundancy and bloat in existing documentation, presenting consolidation opportunities before edits begin.

## Purpose

During Phase 2.5, scan for:
1. **Redundant files**: Multiple docs covering the same topic
2. **Bloated files**: Docs exceeding recommended length thresholds
3. **Stale files**: Documentation that should be deleted or archived
4. **Untracked reports**: LLM-generated files that need consolidation

## Detection Approach

### Reuse from doc-consolidation

Import candidate detection logic from `sanctum:doc-consolidation`:
- Git-untracked file detection
- ALL_CAPS naming pattern matching
- Content marker scanning (Executive Summary, Findings, etc.)

### Additional Signals for Committed Files

Extend detection to analyze committed documentation:

**Bloat signals:**
- `docs/`: File exceeds 500 lines, section exceeds 150 lines
- `book/`: File exceeds 1000 lines, section exceeds 300 lines
- Multiple "wall of text" paragraphs (>4 sentences in docs/, >8 in book/)

**Redundancy signals:**
- Similar file names: `api-overview.md` vs `api-reference.md`
- Similar headings across files
- Overlapping content sections (manual inspection)
- Design docs whose content exists in command/skill documentation
- Planning artifacts for completed work (already implemented)

**Redundancy check command:**
```bash
# For a candidate file, check if content exists elsewhere
grep -r "key phrase from candidate" docs/ book/ plugins/*/commands/*.md plugins/*/README.md
```

**Staleness signals:**
- References to deprecated features
- Version numbers more than 2 minor versions behind
- "TODO: update" comments older than 30 days

## Workflow

### Step 1: Scan for Candidates

```bash
# Find untracked .md files (doc-consolidation pattern)
git status --porcelain | grep '^??' | grep '\.md$' | grep -v 'docs/\|book/\|skills/\|commands/\|agents/'

# Find bloated docs/ files (500 line limit)
find docs/ -name '*.md' -exec wc -l {} \; 2>/dev/null | awk '$1 > 500 {print}'

# Find bloated book/ files (1000 line limit)
find book/ -name '*.md' -exec wc -l {} \; 2>/dev/null | awk '$1 > 1000 {print}'

# Find recently unchanged files (potential staleness) - docs: 90 days, book: 180 days
find docs/ -name '*.md' -mtime +90 -type f 2>/dev/null
find book/ -name '*.md' -mtime +180 -type f 2>/dev/null
```

### Step 2: Present Opportunities

Show consolidation candidates with recommended actions:

```markdown
## Phase 2.5: Consolidation Opportunities

### Redundant Files (delete - content exists elsewhere)

| File | Action | Reason |
|------|--------|--------|
| plugins/memory-palace/docs/PALACE_UNIFICATION.md | Delete | Content already in commands/palace.md |
| docs/old-api-design.md | Delete | Superseded by docs/api-overview.md |

### Untracked Reports (merge or delete)

| File | Score | Markers | Recommendation |
|------|-------|---------|----------------|
| API_REVIEW_REPORT.md | 6 | Executive Summary, Findings | Merge to docs/api-overview.md |
| MIGRATION_NOTES.md | 4 | Action Items, Tables | Merge to docs/migration-guide.md |

### Bloated Files (split or trim)

| File | Lines | Threshold | Recommendation |
|------|-------|-----------|----------------|
| book/src/tutorials/error-handling-tutorial.md | 1031 | 1000 | Trim verbose sections |
| docs/function-extraction-guidelines.md | 571 | 500 | Consider splitting principles/patterns |

### Staleness Candidates (review or delete)

| File | Last Modified | Issue | Recommendation |
|------|---------------|-------|----------------|
| docs/enhanced-pre-commit-hooks.md | 45 days | Content moved to imbue | Delete |
| docs/technical-debt-framework.md | 60 days | Replaced by backlog | Delete |

---

**Options:**
- `Y` - Proceed with all recommended actions
- `n` - Skip consolidation, continue to edits
- `select` - Choose specific items to address
- `--skip-consolidation` flag bypasses this phase
```

### Step 3: Execute Approved Actions

For each approved action:

**Delete (redundant) actions:**
1. Verify content exists in target document(s) by searching for key phrases
2. Confirm no unique valuable content would be lost
3. Remove file: `rm <file>`
4. Add deletion to git staging: `git add -u`

**Merge actions:**
1. Extract valuable content from source
2. Integrate into destination (using doc-consolidation merge strategies)
3. Delete source file
4. Add to git staging

**Delete (stale) actions:**
1. Confirm file has no unique valuable content
2. Remove file
3. Add deletion to git staging

**Split actions:**
1. Create new files for logical sections
2. Move content to new locations
3. Update cross-references
4. Preserve original as index if needed

**Action priority:**
1. Delete redundant first (unbloats without adding content)
2. Delete stale second (removes outdated info)
3. Merge third (consolidates remaining value)
4. Split last (increases file count, use sparingly)

## User Controls

### Skip Flag
```bash
/update-docs --skip-consolidation
```
Bypasses Phase 2.5 entirely for quick updates.

### Selective Processing
When user chooses "select":
```
Enter file numbers to process (comma-separated), or 'all'/'none':
> 1,3
Processing: API_REVIEW_REPORT.md, docs/enhanced-pre-commit-hooks.md
```

### Dry Run
```bash
/update-docs --consolidation-dry-run
```
Shows what would be consolidated without executing.

## Thresholds

| Metric | docs/ Limit | book/ Limit | Action |
|--------|-------------|-------------|--------|
| File length | 500 lines | 1000 lines | Flag for review |
| Section length | 150 lines | 300 lines | Suggest split |
| Paragraph sentences | 4 | 8 | Warn, don't block |
| Stale threshold | 90 days | 180 days | Review suggestion |

## Integration with doc-consolidation

This module **imports** patterns from doc-consolidation but **does not** duplicate its full workflow:

- **Imports**: Candidate detection signals, content markers, scoring
- **Extends**: Adds bloat and staleness detection for committed files
- **Defers to**: Full doc-consolidation skill for complex multi-file merges

For straightforward cases (single untracked report, obvious deletion), handle inline. For complex consolidations, recommend: "Run `/merge-docs` for detailed consolidation workflow."

## Exit Criteria

Phase 2.5 completes when:
- All candidates reviewed (approved or skipped)
- Approved merges/deletions executed
- Git staging updated with changes
- Summary logged for Phase 5 preview

Proceed to Phase 3 (Edits Applied) regardless of consolidation outcome.
