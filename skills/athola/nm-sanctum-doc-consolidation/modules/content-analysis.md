# Content Analysis Module

Extracts and categorizes valuable content from candidate files.

## Content Categories

### Category Definitions

| Category | Description | Indicators |
|----------|-------------|------------|
| **Actionable Items** | Tasks, TODOs, next steps that require action | `Action Items`, `Next Steps`, `TODO`, `- [ ]` checkboxes |
| **Decisions Made** | Architecture choices, tradeoffs, rationale | `Decision`, `Chose`, `Tradeoff`, `Rationale`, `Why we` |
| **Findings/Insights** | Audit results, analysis conclusions, observations | `Findings`, `Observations`, `Analysis`, `Discovered`, `Noted` |
| **Metrics/Baselines** | Quantitative data, before/after, benchmarks | Tables with numbers, `Before`, `After`, percentages, `Improvement` |
| **Migration Guides** | Step-by-step procedures, how-to instructions | `Steps`, `How to`, `Migration`, numbered lists with commands |
| **API Changes** | Interface modifications, breaking changes, deprecations | `API`, `Breaking`, `Deprecated`, `New endpoint`, `Removed` |

### Extraction Process

For each candidate file:

1. **Parse structure** - Identify sections by headers (`##`, `###`)
2. **Extract chunks** - Each section becomes a content chunk
3. **Categorize** - Match chunk to best-fit category
4. **Score value** - Assess high/medium/low

## Value Scoring

### High Value
Content that is:
- **Specific**: Contains concrete names, paths, numbers
- **Actionable**: Reader can act on it directly
- **Unique**: Not already documented elsewhere

Examples:
- Specific action items with owners
- Concrete metrics (before: 287 lines, after: 255 lines)
- Explicit decisions with rationale
- Step-by-step procedures that worked

### Medium Value
Content that is:
- **Somewhat specific**: General guidance with some detail
- **Reference-worthy**: Useful for future lookups
- **Partially covered**: Extends existing documentation

Examples:
- General recommendations without specifics
- Findings that align with existing docs
- Metrics without clear baseline comparison

### Low Value
Content that is:
- **Generic**: Could apply to any project
- **Redundant**: Already well-documented elsewhere
- **Ephemeral**: Only relevant to the moment

Examples:
- Executive summaries (usually boilerplate)
- Generic best practice reminders
- Status statements ("The review is complete")

## Chunk Extraction Algorithm

```python
def extract_chunks(content: str) -> list[ContentChunk]:
    chunks = []
    current_section = None
    current_content = []

    for line in content.split('\n'):
        # New section header
        if line.startswith('## '):
            if current_section:
                chunks.append(make_chunk(current_section, current_content))
            current_section = line[3:].strip()
            current_content = []
        elif line.startswith('### '):
            # Subsection - append to current or create new
            if current_section:
                current_content.append(line)
            else:
                current_section = line[4:].strip()
                current_content = []
        else:
            current_content.append(line)

    # Don't forget last section
    if current_section:
        chunks.append(make_chunk(current_section, current_content))

    return chunks

def make_chunk(header: str, content: list[str]) -> ContentChunk:
    text = '\n'.join(content).strip()
    category = categorize(header, text)
    value = score_value(text, category)

    return ContentChunk(
        header=header,
        content=text,
        category=category,
        value=value
    )
```

## Categorization Rules

Match in order (first match wins):

```python
CATEGORY_PATTERNS = {
    'actionable': [
        r'action\s*items?',
        r'next\s*steps?',
        r'todo',
        r'tasks?',
        r'- \[ \]',  # Unchecked checkboxes
    ],
    'decisions': [
        r'decision',
        r'chose|chosen',
        r'tradeoff',
        r'rationale',
        r'why\s+we',
        r'approach',
    ],
    'findings': [
        r'finding',
        r'observation',
        r'analysis',
        r'discovered',
        r'audit',
        r'review\s+result',
    ],
    'metrics': [
        r'\d+%',
        r'before.*after',
        r'improvement',
        r'reduction',
        r'benchmark',
        r'\|\s*\d+\s*\|',  # Table with numbers
    ],
    'migration': [
        r'migration',
        r'step\s*\d',
        r'how\s+to',
        r'procedure',
        r'```bash',  # Code blocks with commands
    ],
    'api_changes': [
        r'api',
        r'breaking\s+change',
        r'deprecat',
        r'endpoint',
        r'interface',
    ],
}
```

## Output Format

```markdown
## Content Analysis: API_REVIEW_REPORT.md

### Extracted Chunks

| # | Section | Category | Value | Size |
|---|---------|----------|-------|------|
| 1 | Executive Summary | findings | low | 234 chars |
| 2 | API Surface Inventory | findings | high | 1,847 chars |
| 3 | Consistency Audit Findings | findings | high | 2,103 chars |
| 4 | Action Items | actionable | high | 1,456 chars |
| 5 | Recommendations | actionable | medium | 892 chars |
| 6 | Conclusion | findings | low | 312 chars |

### High-Value Content (4 chunks)
- API Surface Inventory: Detailed plugin API table
- Consistency Audit Findings: Specific issues with examples
- Action Items: Concrete tasks with priorities
- (included in routing)

### Excluded (Low Value)
- Executive Summary: Generic overview
- Conclusion: Status statement only
```

## Special Handling

### Tables
Preserve markdown tables intact - they often contain valuable structured data:
```python
def is_table(lines: list[str]) -> bool:
    return any('|' in line and line.count('|') >= 2 for line in lines)
```

### Code Blocks
Preserve code blocks, especially those showing:
- Configuration examples
- Command sequences
- Before/after code comparisons

### Checklists
Preserve checkbox lists - they indicate actionable items:
```markdown
- [x] Completed item (historical record)
- [ ] Pending item (action needed)
```

### Cross-references
Note internal references for destination routing:
```python
# Links like "See also: docs/security.md" suggest destinations
REFERENCE_PATTERN = r'see\s+(?:also:?\s*)?([^\s,]+\.md)'
```
