# Error Handling Patterns

Consistent error handling across skills and hooks.

## Exception Hierarchy

```python
class AbstractError(Exception):
    """Base exception for abstract plugin."""
    pass

class ValidationError(AbstractError):
    """Raised when validation fails."""
    def __init__(self, message: str, field: str = None, code: str = None):
        self.field = field
        self.code = code
        super().__init__(message)

class StructureError(AbstractError):
    """Raised when file/directory structure is invalid."""
    pass

class ConfigurationError(AbstractError):
    """Raised when configuration is invalid."""
    pass
```

## Error Message Format

### Structure

```
[LEVEL] [CODE]: Brief description
  Location: file:line (if applicable)
  Details: Extended explanation
  Suggestion: How to fix
```

### Examples

**Good**:
```
[ERROR] E001: Missing required field 'description'
  Location: skills/my-skill/SKILL.md
  Details: The YAML frontmatter must include a 'description' field
  Suggestion: Add 'description: <what it does and when to use it>'
```

**Bad**:
```
Error: description missing
```

## Recovery Strategies

### Fail-Safe Defaults

For hooks and validators:

```python
def validate_with_fallback(data: dict) -> dict:
    """Validate and return result with safe defaults."""
    try:
        return validate_strict(data)
    except ValidationError as e:
        logger.warning(f"Validation failed: {e}, using defaults")
        return {'valid': False, 'errors': [str(e)], 'data': data}
```

### Graceful Degradation

For optional features:

```python
def load_optional_module(name: str) -> Module | None:
    """Load module if available, None otherwise."""
    try:
        return load_module(name)
    except ModuleNotFound:
        logger.info(f"Optional module {name} not found, skipping")
        return None
```

## Logging Patterns

### Structured Logging

```python
import logging

logger = logging.getLogger(__name__)

# Use structured messages
logger.error("Validation failed", extra={
    'field': 'description',
    'code': 'E001',
    'file': 'SKILL.md'
})
```

### Log Levels

| Level | Use Case |
|-------|----------|
| ERROR | Validation failures, missing required files |
| WARNING | Exceeded soft limits, deprecated usage |
| INFO | Normal operation, file processing |
| DEBUG | Detailed processing steps |
