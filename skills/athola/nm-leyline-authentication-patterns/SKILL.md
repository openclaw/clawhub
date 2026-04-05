---
name: authentication-patterns
description: |
  'Authentication patterns for external services: API keys, OAuth, token management, verification. authentication, API keys, OAuth, token management, credentials.'
version: 1.8.1
triggers:
  - authentication
  - api-keys
  - oauth
  - tokens
  - security
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/leyline", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.error-patterns"]}}}
source: claude-night-market
source_plugin: leyline
---

> **Night Market Skill** — ported from [claude-night-market/leyline](https://github.com/athola/claude-night-market/tree/master/plugins/leyline). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Authentication Methods](#authentication-methods)
- [Quick Start](#quick-start)
- [Verify Authentication](#verify-authentication)
- [Smoke Test](#smoke-test)
- [Standard Flow](#standard-flow)
- [Step 1: Check Environment](#step-1:-check-environment)
- [Step 2: Verify with Service](#step-2:-verify-with-service)
- [Step 3: Handle Failures](#step-3:-handle-failures)
- [Integration Pattern](#integration-pattern)
- [Detailed Resources](#detailed-resources)
- [Exit Criteria](#exit-criteria)


# Authentication Patterns

## Overview

Common authentication patterns for integrating with external services. Provides consistent approaches to credential management, verification, and error handling.

## When To Use

- Integrating with external APIs
- Need credential verification
- Managing multiple auth methods
- Handling auth failures gracefully

## When NOT To Use

- Project doesn't use the leyline infrastructure patterns
- Simple scripts without service architecture needs

## Authentication Methods

| Method | Best For | Environment Variable |
|--------|----------|---------------------|
| API Key | Simple integrations | `{SERVICE}_API_KEY` |
| OAuth | User-authenticated | Browser-based flow |
| Token | Session-based | `{SERVICE}_TOKEN` |
| None | Public APIs | N/A |

## Quick Start

### Verify Authentication
```python
from leyline.auth import verify_auth, AuthMethod

# API Key verification
status = verify_auth(
    service="gemini",
    method=AuthMethod.API_KEY,
    env_var="GEMINI_API_KEY"
)

if not status.authenticated:
    print(f"Auth failed: {status.message}")
    print(f"Action: {status.suggested_action}")
```
**Verification:** Run the command with `--help` flag to verify availability.

### Smoke Test
```python
def verify_with_smoke_test(service: str) -> bool:
    """Verify auth with simple request."""
    result = execute_simple_request(service, "ping")
    return result.success
```
**Verification:** Run `pytest -v` to verify tests pass.

## Standard Flow

### Step 1: Check Environment
```python
def check_credentials(service: str, env_var: str) -> bool:
    value = os.getenv(env_var)
    if not value:
        print(f"Missing {env_var}")
        return False
    return True
```
**Verification:** Run the command with `--help` flag to verify availability.

### Step 2: Verify with Service
```python
def verify_with_service(service: str) -> AuthStatus:
    result = subprocess.run(
        [service, "auth", "status"],
        capture_output=True
    )
    return AuthStatus(
        authenticated=(result.returncode == 0),
        message=result.stdout.decode()
    )
```
**Verification:** Run the command with `--help` flag to verify availability.

### Step 3: Handle Failures
```python
def handle_auth_failure(service: str, method: AuthMethod) -> str:
    actions = {
        AuthMethod.API_KEY: f"Set {service.upper()}_API_KEY environment variable",
        AuthMethod.OAUTH: f"Run '{service} auth login' for browser auth",
        AuthMethod.TOKEN: f"Refresh token with '{service} token refresh'"
    }
    return actions[method]
```
**Verification:** Run the command with `--help` flag to verify availability.

## Integration Pattern

```yaml
# In your skill's frontmatter
dependencies: [leyline:authentication-patterns]
```
**Verification:** Run the command with `--help` flag to verify availability.

## Interactive Authentication (Shell)

For workflows requiring interactive authentication with token caching and session management:

```bash
# Source the interactive auth script
source plugins/leyline/scripts/interactive_auth.sh

# Ensure authentication before proceeding
ensure_auth github || exit 1
ensure_auth gitlab || exit 1
ensure_auth aws || exit 1

# Continue with authenticated operations
gh pr view 123
glab issue list
aws s3 ls
```

**Features:**
- ✅ Interactive OAuth flows for GitHub, GitLab, AWS, and more
- ✅ Token caching (5-minute TTL)
- ✅ Session persistence (24-hour TTL)
- ✅ CI/CD compatible (auto-detects non-interactive environments)
- ✅ Multi-service support

See `modules/interactive-auth.md` for complete documentation.

## Detailed Resources

- **Auth Methods**: See `modules/auth-methods.md` for method details
- **Verification**: See `modules/verification-patterns.md` for testing patterns
- **Interactive**: See `modules/interactive-auth.md` for shell-based auth flows

## Exit Criteria

- Credentials verified or clear failure message
- Suggested action for auth failures
- Smoke test confirms working auth
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
