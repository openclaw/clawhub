# Directory-Specific Style Rules

Apply different documentation standards based on file location. The `docs/` directory requires strict conciseness while `book/` allows technical book format with longer explanations.

## Rule Sets

### docs/ - Strict Reference Style

Target audience: Developers seeking quick answers.

| Rule | Limit | Rationale |
|------|-------|-----------|
| Max file length | 500 lines | Keeps files navigable |
| Max section length | 100 lines | Forces topic focus |
| Max paragraph sentences | 4 | Prevents wall-of-text |
| Max list items | 10 | Subgroup beyond this |
| Max table rows | 15 | Paginate or summarize |

**Required patterns:**
- Start directly (no "This document describes...")
- Imperative mood for instructions
- Bullets over prose for lists of 3+ items
- Code examples over abstract descriptions

**Anti-patterns to flag:**
- Executive summaries (remove or move to introduction)
- Filler phrases: "in order to", "it should be noted", "as mentioned"
- Qualification hedging: "generally", "typically", "usually"
- Empty transitions: "Moving on", "Now let's look at"

### book/ - Technical Book Style

Target audience: Learners working through chapters.

| Rule | Limit | Rationale |
|------|-------|-----------|
| Max file length | 1000 lines | Chapter-length content |
| Max section length | 300 lines | Tutorial depth allowed |
| Max paragraph sentences | 8 | Explanatory narratives |
| Max list items | 15 | Subgroup for clarity |
| Max table rows | 25 | Comparison tables |

**Allowed patterns:**
- Narrative explanations
- Before/after comparisons
- Step-by-step walkthroughs
- Conceptual introductions
- Callout emojis (sparingly)

**Still flagged:**
- Filler phrases
- Redundant explanations
- Overly long code blocks without commentary

### wiki/ - Wiki Reference Style

Target audience: Internal team and contributors seeking context.

| Rule | Limit | Rationale |
|------|-------|-----------|
| Max file length | 500 lines | Quick reference |
| Max section length | 100 lines | Topic focus |
| Max paragraph sentences | 4 | Scannable |
| Max list items | 10 | Subgroup beyond this |
| Max table rows | 15 | Paginate or summarize |

**Required patterns:**
- Same as docs/ strict style
- Cross-links to related wiki pages
- Architecture Decision Records (ADRs) in wiki/architecture/

### plugins/*/README.md - Plugin Summary Style

Target audience: Users evaluating or installing plugins.

| Rule | Limit | Rationale |
|------|-------|-----------|
| Max file length | 300 lines | Concise overview |
| Max section length | 50 lines | Quick scan |
| Max paragraph sentences | 4 | Brief descriptions |
| Max list items | 10 | Key features only |
| Max table rows | 15 | Command/skill listing |

**Required patterns:**
- Installation instructions
- Quick start example
- Link to detailed docs in book/

### Shared Rules (All Locations)

Apply everywhere regardless of directory:

- No emojis in headings or body (callouts excepted in book/)
- Grounded language (specific references, not vague claims)
- Imperative mood for docstrings
- No marketing language ("capable", "smooth", "elegant")
- No first-person plural ("we can see", "let's explore")
- Prose text wraps at 80 chars per line (hybrid wrapping:
  prefer sentence/clause boundaries over arbitrary breaks)
- Blank line before and after every heading
- ATX headings only (`#` prefix, never setext underlines)
- Blank line before every list (ordered or unordered)
- Reference-style links when inline links push past 80 chars
- Full formatting spec: `Skill(leyline:markdown-formatting)`

## Detection Patterns

### Wall-of-Text Detection

```python
def detect_wall_of_text(content: str, max_sentences: int) -> list[Violation]:
    violations = []
    paragraphs = extract_paragraphs(content)

    for i, para in enumerate(paragraphs):
        sentence_count = len(re.split(r'[.!?]+', para.strip()))
        if sentence_count > max_sentences:
            violations.append({
                'type': 'wall_of_text',
                'location': f'paragraph {i+1}',
                'actual': sentence_count,
                'limit': max_sentences,
                'suggestion': 'Break into smaller paragraphs or convert to bullet list'
            })

    return violations
```

### Filler Phrase Detection

```python
FILLER_PHRASES = [
    r'\bin order to\b',
    r'\bit should be noted\b',
    r'\bas mentioned (above|below|earlier|previously)\b',
    r'\bmoving on\b',
    r'\bnow let\'?s (look at|explore|consider)\b',
    r'\bthis (document|section|chapter) (describes|explains|covers)\b',
]

def detect_filler(content: str) -> list[Violation]:
    violations = []
    for pattern in FILLER_PHRASES:
        matches = re.findall(pattern, content, re.IGNORECASE)
        for match in matches:
            violations.append({
                'type': 'filler_phrase',
                'phrase': match,
                'suggestion': 'Remove or rewrite directly'
            })
    return violations
```

## Validation Workflow

### Step 1: Determine Rule Set

```python
def get_ruleset(file_path: str) -> RuleSet:
    if file_path.startswith('book/'):
        return BOOK_RULES
    elif file_path.startswith('docs/'):
        return DOCS_RULES
    elif file_path.startswith('wiki/'):
        return WIKI_RULES
    elif re.match(r'plugins/[^/]+/README\.md$', file_path):
        return PLUGIN_README_RULES
    else:
        return DOCS_RULES  # Default to strict
```

### Step 2: Run Checks

```python
def validate_file(file_path: str, content: str) -> ValidationResult:
    rules = get_ruleset(file_path)
    violations = []

    # Structure checks
    lines = content.split('\n')
    if len(lines) > rules.max_lines:
        violations.append({
            'severity': 'warning',
            'type': 'file_length',
            'actual': len(lines),
            'limit': rules.max_lines
        })

    # Wall-of-text check
    violations.extend(detect_wall_of_text(content, rules.max_sentences))

    # Filler phrase check
    violations.extend(detect_filler(content))

    return ValidationResult(
        file_path=file_path,
        ruleset=rules.name,
        violations=violations,
        passed=len([v for v in violations if v.get('severity') == 'error']) == 0
    )
```

### Step 3: Report Format

```markdown
## Style Validation: docs/api-overview.md

Using ruleset: **docs/ (strict)**

### Violations Found

| Severity | Type | Details | Suggestion |
|----------|------|---------|------------|
| warning | wall_of_text | Paragraph 3 has 7 sentences (limit: 4) | Break into smaller paragraphs |
| info | filler_phrase | "in order to" | Remove or rewrite directly |
| info | filler_phrase | "This document describes" | Start with content directly |

### Passed Checks
- File length: 287/500 lines
- Section lengths: All under 100 lines
- No marketing language detected
```

## Progressive Loading

This module loads only when Phase 4 (Guidelines Verified) is reached. It does not run during earlier phases to conserve context.

**Load trigger**: `doc-updates:edits-applied` completed
**Dependencies**: None
