# Destination Routing Module

Maps extracted content chunks to appropriate destinations in the documentation.

## Routing Strategy

### Priority Order

1. **Semantic match** - Find existing doc that covers the topic
2. **Default mapping**
 - Use category-based default destinations
3. **Create new** - Only when no suitable destination exists

### Preference: Existing Over New

Always prefer merging into existing documentation:
- Keeps documentation consolidated
- Avoids duplicate coverage
- Maintains established structure

Create new files only when:
- Content is substantial (>500 chars of high-value)
- No existing doc covers the topic
- Content warrants standalone treatment

## Semantic Matching

### Algorithm

```python
def find_semantic_match(chunk: ContentChunk, existing_docs: list[str]) -> str | None:
    """Find best-matching existing document for a content chunk."""

    best_match = None
    best_score = 0

    for doc_path in existing_docs:
        doc_content = read_file(doc_path)
        score = compute_relevance(chunk, doc_content)

        if score > best_score and score >= MATCH_THRESHOLD:
            best_match = doc_path
            best_score = score

    return best_match

def compute_relevance(chunk: ContentChunk, doc_content: str) -> float:
    """Score relevance of chunk to document."""
    score = 0.0

    # Header matching (highest weight)
    doc_headers = extract_headers(doc_content)
    if any(similar(chunk.header, h) for h in doc_headers):
        score += 0.4

    # Keyword overlap
    chunk_keywords = extract_keywords(chunk.content)
    doc_keywords = extract_keywords(doc_content)
    overlap = len(chunk_keywords & doc_keywords) / len(chunk_keywords)
    score += overlap * 0.3

    # Category alignment
    if doc_likely_category(doc_content) == chunk.category:
        score += 0.2

    # Reference mentions
    if chunk mentions doc_path or doc mentions chunk source:
        score += 0.1

    return score

MATCH_THRESHOLD = 0.5  # Minimum score to consider a match
```

### Existing Doc Discovery

Scan these locations for potential destinations:

```python
DOC_LOCATIONS = [
    'docs/',
    'docs/plans/',
    'docs/adr/',
    'README.md',
    'CHANGELOG.md',
]

# Plugin-specific locations
PLUGIN_DOC_LOCATIONS = [
    '{plugin}/docs/',
    '{plugin}/README.md',
]
```

## Default Mappings

When semantic matching finds no suitable destination:

| Category | Default Destination | Notes |
|----------|---------------------|-------|
| Actionable Items | `docs/plans/YYYY-MM-DD-{topic}.md` | New plan file |
| Decisions Made | `docs/adr/NNNN-YYYY-MM-DD-{topic}.md` | New ADR |
| Findings/Insights | `docs/{topic}.md` | New doc or best-effort match |
| Metrics/Baselines | `docs/benchmarks.md` or inline | Append if exists |
| Migration Guides | `docs/migration-guide.md` | Append section |
| API Changes | `CHANGELOG.md` or `docs/api.md` | Prefer CHANGELOG |

### Topic Extraction

Derive topic slug from content:

```python
def extract_topic(chunk: ContentChunk, source_file: str) -> str:
    """Extract topic slug for file naming."""

    # Try chunk header first
    if chunk.header:
        return slugify(chunk.header)

    # Try source file name
    source_name = Path(source_file).stem
    if '_REPORT' in source_name:
        return slugify(source_name.replace('_REPORT', ''))

    # Fall back to category
    return chunk.category

def slugify(text: str) -> str:
    """Convert text to kebab-case slug."""
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    text = text.strip('-')
    return text[:50]  # Max length
```

## Merge Strategy Selection

For each chunk-destination pair, determine how to merge:

### Decision Tree

```
Is destination a new file?
├── Yes → CREATE_NEW
└── No → Does destination have matching section?
    ├── Yes → Is new content more detailed?
    │   ├── Yes (2x+ detail OR newer date) → REPLACE_SECTION
    │   └── No → INTELLIGENT_WEAVE
    └── No → APPEND_WITH_CONTEXT
```

### Strategy Definitions

**CREATE_NEW**
- Generate complete new file with frontmatter
- Use appropriate template for category
- Include source attribution

**INTELLIGENT_WEAVE**
- Find matching section in destination
- Insert content matching existing style
- Preserve bullet/table/prose formatting

**REPLACE_SECTION**
- Back up existing content (in consolidation log)
- Replace entire section
- Add "Updated: YYYY-MM-DD" marker

**APPEND_WITH_CONTEXT**
- Add new section at logical location
- Include header with date and source
- Format: `## {Topic} (consolidated from {source}, {date})`

## Output Format

```markdown
## Routing Plan

### Source: API_REVIEW_REPORT.md

| Chunk | Destination | Strategy | Rationale |
|-------|-------------|----------|-----------|
| API Surface Inventory | docs/api-overview.md | CREATE_NEW | No existing API docs, substantial content |
| Consistency Findings | docs/architecture.md | APPEND_WITH_CONTEXT | Related topic, no matching section |
| Action Items | docs/plans/2025-12-06-api-consistency.md | CREATE_NEW | Actionable, needs tracking |
| CLI Recommendation | docs/adr/0002-cli-naming.md | CREATE_NEW | Decision warrants ADR |

### Skipped (Low Value)
| Chunk | Reason |
|-------|--------|
| Executive Summary | Generic, low value |
| Conclusion | Status only, no lasting value |

### Destination Summary
- **New files**: 3
- **Updates to existing**: 1
- **Skipped**: 2
```

## ADR Generation

For decisions that warrant an ADR:

```markdown
# ADR-{NNNN}: {Decision Title}

**Date**: {YYYY-MM-DD}
**Status**: Accepted
**Consolidated from**: {source_file}

## Context

{extracted context from source}

## Decision

{extracted decision}

## Consequences

{extracted consequences or "To be determined"}

## References

- Source: {source_file} (consolidated {date})
```

### ADR Numbering

```python
def next_adr_number(adr_dir: str) -> int:
    """Find next available ADR number."""
    existing = glob(f"{adr_dir}/[0-9][0-9][0-9][0-9]-*.md")
    if not existing:
        return 1
    numbers = [int(Path(p).name[:4]) for p in existing]
    return max(numbers) + 1
```

## Validation

Before finalizing routing:

1. **Check destination exists** (for updates)
2. **Check write permissions**
3. **Verify no circular references**
4. **Confirm ADR numbering is unique**

```python
def validate_routing(plan: RoutingPlan) -> list[str]:
    """Return list of validation errors."""
    errors = []

    for route in plan.routes:
        if route.strategy != 'CREATE_NEW':
            if not Path(route.destination).exists():
                errors.append(f"Destination not found: {route.destination}")

        if route.strategy == 'CREATE_NEW':
            if Path(route.destination).exists():
                errors.append(f"Would overwrite existing: {route.destination}")

    return errors
```
