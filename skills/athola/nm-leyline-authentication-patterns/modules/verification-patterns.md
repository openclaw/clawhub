---
name: verification-patterns
description: Authentication verification and testing patterns
estimated_tokens: 300
---

# Verification Patterns

## Smoke Test

### Simple Request Test
```python
def smoke_test(service: str) -> bool:
    """Test auth with minimal request."""
    try:
        result = subprocess.run(
            [service, "-p", "Respond with OK"],
            capture_output=True,
            timeout=30
        )
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        return False
```

### Model Access Test
```python
def test_model_access(service: str, model: str) -> bool:
    """Verify access to specific model."""
    result = subprocess.run(
        [service, "--model", model, "-p", "ping"],
        capture_output=True
    )
    return result.returncode == 0
```

## Pre-Flight Checks

### Full Verification Flow
```python
def preflight_auth_check(service: str) -> dict:
    """Complete auth verification before operations."""
    checks = {
        "env_var_set": False,
        "cli_available": False,
        "auth_valid": False,
        "model_access": False
    }

    # Check environment variable
    env_var = f"{service.upper()}_API_KEY"
    checks["env_var_set"] = bool(os.getenv(env_var))

    # Check CLI available
    checks["cli_available"] = shutil.which(service) is not None

    # Check auth status
    if checks["cli_available"]:
        result = subprocess.run([service, "auth", "status"], capture_output=True)
        checks["auth_valid"] = result.returncode == 0

    # Check model access
    if checks["auth_valid"]:
        checks["model_access"] = smoke_test(service)

    return checks
```

## Cached Verification

```python
class AuthCache:
    """Cache auth status to avoid repeated checks."""

    def __init__(self, ttl_seconds: int = 300):
        self.cache = {}
        self.ttl = ttl_seconds

    def get_status(self, service: str) -> AuthStatus | None:
        if service in self.cache:
            status, timestamp = self.cache[service]
            if time.time() - timestamp < self.ttl:
                return status
        return None

    def set_status(self, service: str, status: AuthStatus):
        self.cache[service] = (status, time.time())
```

## Error Diagnostics

```python
def diagnose_auth_failure(service: str, error: str) -> list[str]:
    """Diagnose common auth failures."""
    suggestions = []

    if "401" in error or "unauthorized" in error.lower():
        suggestions.append("API key may be invalid or expired")
        suggestions.append(f"Verify {service.upper()}_API_KEY is correct")

    if "403" in error or "forbidden" in error.lower():
        suggestions.append("API key may lack required permissions")
        suggestions.append("Check API key scopes in provider dashboard")

    if "network" in error.lower() or "connection" in error.lower():
        suggestions.append("Check network connectivity")
        suggestions.append("Verify proxy settings if applicable")

    return suggestions
```
