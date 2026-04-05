---
name: classification
description: Error classification taxonomy and detection patterns
estimated_tokens: 350
---

# Error Classification

## HTTP Status Code Mapping

```python
ERROR_CLASSIFICATION = {
    # Authentication
    401: ErrorCategory.CONFIGURATION,
    403: ErrorCategory.CONFIGURATION,

    # Client errors
    400: ErrorCategory.PERMANENT,
    404: ErrorCategory.CONFIGURATION,
    422: ErrorCategory.PERMANENT,

    # Rate limits
    429: ErrorCategory.RESOURCE,

    # Server errors (transient)
    500: ErrorCategory.TRANSIENT,
    502: ErrorCategory.TRANSIENT,
    503: ErrorCategory.TRANSIENT,
    504: ErrorCategory.TRANSIENT,
}
```

## Error Detection Patterns

### By Message Content
```python
def classify_by_message(error_msg: str) -> ErrorCategory:
    error_msg = error_msg.lower()

    if any(k in error_msg for k in ["rate limit", "quota", "exceeded"]):
        return ErrorCategory.RESOURCE

    if any(k in error_msg for k in ["auth", "token", "credential", "permission"]):
        return ErrorCategory.CONFIGURATION

    if any(k in error_msg for k in ["timeout", "connection", "network"]):
        return ErrorCategory.TRANSIENT

    if any(k in error_msg for k in ["invalid", "malformed", "syntax"]):
        return ErrorCategory.PERMANENT

    return ErrorCategory.TRANSIENT  # Default: assume retryable
```

## Service-Specific Errors

### Gemini Errors
| Error | Category | Recovery |
|-------|----------|----------|
| RESOURCE_EXHAUSTED | Resource | Wait for quota reset |
| INVALID_ARGUMENT | Permanent | Fix request format |
| PERMISSION_DENIED | Config | Check API key |
| DEADLINE_EXCEEDED | Transient | Retry with backoff |

### Qwen Errors
| Error | Category | Recovery |
|-------|----------|----------|
| RateLimitReached | Resource | Wait or switch service |
| InvalidAPIKey | Config | Verify QWEN_API_KEY |
| ModelNotFound | Config | Check model name |
| ServerError | Transient | Retry |

## Error Hierarchy

```python
class LeylineError(Exception):
    """Base error for leyline infrastructure."""
    category = ErrorCategory.TRANSIENT

class AuthenticationError(LeylineError):
    """Authentication/authorization failures."""
    category = ErrorCategory.CONFIGURATION

class RateLimitError(LeylineError):
    """Rate limit or quota exceeded."""
    category = ErrorCategory.RESOURCE

class ServiceUnavailableError(LeylineError):
    """Service temporarily unavailable."""
    category = ErrorCategory.TRANSIENT

class ConfigurationError(LeylineError):
    """Missing or invalid configuration."""
    category = ErrorCategory.CONFIGURATION
```
