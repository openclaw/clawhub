# Validation Patterns

Reusable validation patterns for skills and hooks.

## Frontmatter Validation

### Required Fields Check

```python
def validate_required_fields(data: dict, required: list[str]) -> list[str]:
    """Return list of missing required fields."""
    return [field for field in required if field not in data or not data[field]]
```

### Field Constraints

| Field | Constraint | Validation |
|-------|------------|------------|
| name | ≤64 chars, kebab-case | `re.match(r'^[a-z0-9-]+$', name) and len(name) <= 64` |
| description | ≤1024 chars, non-empty | `0 < len(desc) <= 1024` |
| version | semver format | `re.match(r'^\d+\.\d+\.\d+$', version)` |

### Third-Person Voice Check

```python
FIRST_PERSON = ['I ', 'I\'m', 'my ', 'we ', 'our ']
SECOND_PERSON = ['you ', 'your ', 'you\'re']

def is_third_person(text: str) -> bool:
    """Check if text uses third-person voice."""
    text_lower = text.lower()
    for phrase in FIRST_PERSON + SECOND_PERSON:
        if phrase.lower() in text_lower:
            return False
    return True
```

## Structure Validation

### File Existence Check

```python
from pathlib import Path

def validate_references(skill_path: Path, references: list[str]) -> dict:
    """Validate that referenced files exist."""
    results = {'valid': [], 'missing': []}
    for ref in references:
        ref_path = skill_path.parent / ref
        if ref_path.exists():
            results['valid'].append(ref)
        else:
            results['missing'].append(ref)
    return results
```

### Line Count Check

```python
def check_line_count(file_path: Path, max_lines: int = 500) -> tuple[int, bool]:
    """Return (line_count, is_over_limit)."""
    with open(file_path) as f:
        lines = sum(1 for _ in f)
    return lines, lines > max_lines
```

## Error Reporting Format

### Structured Report

```python
@dataclass
class ValidationResult:
    level: str  # 'error', 'warning', 'info'
    code: str   # 'E001', 'W001', etc.
    message: str
    location: str  # file:line or just file
    suggestion: str | None = None

def format_result(result: ValidationResult) -> str:
    icon = {'error': 'X', 'warning': '!', 'info': 'i'}[result.level]
    msg = f"{icon} [{result.code}] {result.message}"
    if result.location:
        msg += f" ({result.location})"
    if result.suggestion:
        msg += f"\n  → {result.suggestion}"
    return msg
```

### Error Codes

| Code | Level | Description |
|------|-------|-------------|
| E001 | error | Missing required field |
| E002 | error | Invalid field format |
| E003 | error | Referenced file not found |
| W001 | warning | Line count exceeds limit |
| W002 | warning | Non-third-person voice detected |
| W003 | warning | Missing recommended field |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All checks passed |
| 1 | Warnings present, but valid |
| 2 | Errors found, invalid |
| 3 | Critical errors, cannot proceed |
