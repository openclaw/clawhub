---
name: auth-methods
description: Detailed authentication method implementations
estimated_tokens: 350
---

# Authentication Methods

## API Key Authentication

### Setup
```bash
# Set in environment
export GEMINI_API_KEY="your-key-here"

# Or in .env file
echo "GEMINI_API_KEY=your-key-here" >> ~/.env
```

### Verification
```python
def verify_api_key(env_var: str) -> AuthStatus:
    key = os.getenv(env_var)

    if not key:
        return AuthStatus(
            authenticated=False,
            message=f"Missing {env_var}",
            suggested_action=f"Set {env_var} environment variable"
        )

    # Validate format (basic check)
    if len(key) < 20:
        return AuthStatus(
            authenticated=False,
            message="API key appears invalid (too short)",
            suggested_action="Verify API key is correct"
        )

    return AuthStatus(authenticated=True)
```

## OAuth Authentication

### Browser Flow
```python
def initiate_oauth(service: str) -> AuthStatus:
    """Start OAuth browser flow."""
    result = subprocess.run(
        [service, "auth", "login"],
        capture_output=True
    )

    if result.returncode == 0:
        return AuthStatus(
            authenticated=True,
            message="OAuth completed successfully"
        )

    return AuthStatus(
        authenticated=False,
        message="OAuth flow failed",
        suggested_action="Check browser, try incognito mode"
    )
```

### Token Storage
```python
# OAuth tokens typically stored by CLI
# Common locations:
# ~/.config/{service}/credentials.json
# ~/.{service}/auth.json
```

## Token Authentication

### Token Refresh
```python
def refresh_token(service: str) -> AuthStatus:
    """Refresh expired token."""
    result = subprocess.run(
        [service, "token", "refresh"],
        capture_output=True
    )

    if result.returncode == 0:
        return AuthStatus(authenticated=True)

    # Token refresh failed, need re-auth
    return AuthStatus(
        authenticated=False,
        message="Token refresh failed",
        suggested_action=f"Run '{service} auth login' to re-authenticate"
    )
```

### Token Validation
```python
def validate_token(token: str) -> bool:
    """Basic token validation."""
    try:
        # JWT tokens have 3 parts
        parts = token.split(".")
        if len(parts) == 3:
            return True
    except:
        pass
    return False
```

## Multi-Method Secondary

```python
def authenticate(service: str, methods: list[AuthMethod]) -> AuthStatus:
    """Try multiple auth methods in order."""
    for method in methods:
        status = verify_auth(service, method)
        if status.authenticated:
            return status

    return AuthStatus(
        authenticated=False,
        message="All authentication methods failed",
        suggested_action="Check credentials and try again"
    )
```
