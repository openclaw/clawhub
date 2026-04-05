---
name: interactive-auth
description: Interactive authentication with token caching and multi-service support
estimated_tokens: 800
---

# Interactive Authentication

## Overview

Provides interactive authentication flows for external services with automatic token caching, session management, and multi-service support. Designed to be sourced by workflows requiring external API access.

## Philosophy

**Authenticate Once, Use Everywhere**: Tokens are cached locally and validated efficiently, minimizing interactive prompts while maintaining security.

**User-Friendly Defaults**: Interactive prompts guide users through authentication with clear instructions and recovery options.

**CI/CD Compatible**: Automatically detects non-interactive environments and falls back to environment variables.

## Features

- ✅ **Interactive OAuth flows** for supported services
- ✅ **Token caching** with configurable TTL (default: 5 minutes)
- ✅ **Session persistence** across workflow runs
- ✅ **Multi-service support** (GitHub, GitLab, AWS, GCP, and more)
- ✅ **CI/CD detection** with automatic fallback
- ✅ **Retry logic** with exponential backoff
- ✅ **Graceful degradation** when auth is optional

## Quick Start

```bash
# Source this script in your workflow
source plugins/leyline/scripts/interactive_auth.sh

# Ensure authentication before using service
ensure_auth github || exit 1

# Use service APIs with confidence
gh pr view 123
gh api repos/owner/repo/issues
```

## Configuration

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `AUTH_CACHE_DIR` | Token cache directory | `~/.cache/claude-auth` |
| `AUTH_CACHE_TTL` | Cache TTL in seconds | `300` (5 minutes) |
| `AUTH_SESSION_TTL` | Session persistence TTL | `86400` (24 hours) |
| `AUTH_INTERACTIVE` | Force interactive mode | `auto` (detect) |
| `AUTH_MAX_ATTEMPTS` | Max authentication attempts | `3` |

### Service-Specific Configuration

```bash
# GitHub
export GITHUB_TOKEN="..."  # Personal access token (fallback)

# GitLab
export GITLAB_TOKEN="..."  # Personal access token

# AWS
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."  # For temporary credentials

# Google Cloud
export GOOGLE_CREDENTIALS="path/to/credentials.json"
export GOOGLE_APPLICATION_CREDENTIALS="path/to/credentials.json"
```

## Core Functions

### `ensure_auth <service>`

Ensure authentication for a service, prompting if necessary.

**Usage:**
```bash
ensure_auth github || exit 1
ensure_auth gitlab || exit 1
ensure_auth aws || exit 1
```

**Supported Services:**
- `github` - GitHub CLI (gh)
- `gitlab` - GitLab CLI (glab)
- `aws` - AWS CLI
- `gcloud` - Google Cloud CLI
- `azure` - Azure CLI

**Returns:**
- `0` - Authentication successful
- `1` - Authentication failed

**Example:**
```bash
if ! ensure_auth github; then
  echo "GitHub authentication required but failed"
  exit 1
fi

# Continue with authenticated operations
gh pr list
```

### `check_auth_status <service>`

Check if service is authenticated (non-interactive).

**Usage:**
```bash
if check_auth_status github; then
  echo "GitHub is authenticated"
else
  echo "GitHub authentication needed"
fi
```

**Returns:**
- `0` - Authenticated
- `1` - Not authenticated

### `invalidate_auth_cache <service>`

Invalidate cached authentication status.

**Usage:**
```bash
# Force re-authentication next time
invalidate_auth_cache github
ensure_auth github  # Will prompt again
```

### `clear_all_auth_cache`

Clear all cached authentication data.

**Usage:**
```bash
# Clear all auth caches
clear_all_auth_cache
```

## Token Caching

### Cache Storage

Tokens and authentication status are cached in:

```
~/.cache/claude-auth/
├── github/
│   ├── auth_status.json      # Current auth status
│   ├── last_verified.txt     # Timestamp of last check
│   └── token_cache.json      # Cached token info (optional)
├── gitlab/
│   └── ...
└── config.json               # Global configuration
```

### Cache Validation

Cached credentials are validated based on:

1. **Time-based expiration** (default: 5 minutes)
2. **Session persistence** (default: 24 hours)
3. **Manual invalidation** (via `invalidate_auth_cache`)

**Example:**
```bash
# First call: Checks auth, caches result
ensure_auth github

# Within 5 minutes: Uses cached result (fast)
ensure_auth github

# After 5 minutes: Re-validates with service (still cached if valid)
ensure_auth github

# Force re-check: Invalidate cache first
invalidate_auth_cache github
ensure_auth github  # Re-checks immediately
```

## Session Management

### Session Tracking

Sessions track authentication state across multiple workflow runs:

```bash
# First workflow run
ensure_auth github  # Stores session in ~/.cache/claude-auth/github/session.json

# Second workflow run (within 24 hours)
ensure_auth github  # Uses session, skips auth check

# Session expired
ensure_auth github  # Re-authenticates
```

### Session Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│  Workflow 1: ensure_auth github                             │
│  └─> Authenticate (OAuth)                                    │
│  └─> Store session: ~/.cache/claude-auth/github/session.json│
│  └─> Cache expires: 5 minutes                                │
│  └─> Session expires: 24 hours                               │
├─────────────────────────────────────────────────────────────┤
│  Workflow 2 (5 min later): ensure_auth github               │
│  └─> Load session (valid)                                    │
│  └─> Validate token (lightweight check)                      │
│  └─> Skip prompt                                             │
├─────────────────────────────────────────────────────────────┤
│  Workflow 3 (26 hours later): ensure_auth github            │
│  └─> Session expired                                         │
│  └─> Re-authenticate                                          │
│  └─> Store new session                                        │
└─────────────────────────────────────────────────────────────┘
```

## Interactive Authentication Flow

### GitHub Authentication

```bash
ensure_auth github
```

**Flow:**
```bash
# 1. Check if already authenticated
if gh auth status &>/dev/null; then
  echo "✓ GitHub authenticated"
  return 0
fi

# 2. Check cache
if check_cache github; then
  echo "✓ Using cached GitHub credentials"
  return 0
fi

# 3. Prompt for authentication
cat << 'PROMPT'
🔐 GitHub Authentication Required

This workflow needs GitHub API access to continue.

How would you like to authenticate?
  1. Browser (OAuth) - Recommended
  2. Personal Access Token
  3. Cancel workflow

Choose [1-3]:
PROMPT

read -r choice

case "$choice" in
  1)
    # Browser OAuth flow
    gh auth login
    ;;
  2)
    # Token-based auth
    echo "Enter your GitHub personal access token:"
    read -rs token
    echo "$token" | gh auth login --with-token
    ;;
  3)
    return 1
    ;;
esac

# 4. Verify authentication
if gh auth status &>/dev/null; then
  store_session github
  echo "✓ GitHub authentication successful"
  return 0
else
  echo "❌ GitHub authentication failed"
  return 1
fi
```

### GitLab Authentication

```bash
ensure_auth gitlab
```

**Similar flow to GitHub, using `glab auth login`**

### AWS Authentication

```bash
ensure_auth aws
```

**Flow:**
```bash
# Check AWS credentials
if aws sts get-caller-identity &>/dev/null; then
  echo "✓ AWS authenticated"
  return 0
fi

# Prompt for authentication
cat << 'PROMPT'
🔐 AWS Authentication Required

How would you like to authenticate?
  1. AWS Access Keys (long-lived credentials)
  2. SSO Session (organization SSO)
  3. Web Identity (OIDC)
  4. Cancel workflow

Choose [1-4]:
PROMPT

read -r choice

case "$choice" in
  1)
    echo "Enter AWS Access Key ID:"
    read -rs AWS_ACCESS_KEY_ID
    echo "Enter AWS Secret Access Key:"
    read -rs AWS_SECRET_ACCESS_KEY
    export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
    ;;
  2)
    aws sso login
    ;;
  3)
    aws webidentity-token-file role-arn
    ;;
  4)
    return 1
    ;;
esac
```

## CI/CD Compatibility

### Automatic Detection

The module automatically detects non-interactive environments:

```bash
# In CI/CD: Check environment variables
if [[ -n "$CI" ]] || [[ -n "$GITHUB_ACTIONS" ]] || [[ ! -t 0 ]]; then
  # Non-interactive mode: Use environment variables
  if [[ -n "$GITHUB_TOKEN" ]]; then
    echo "$GITHUB_TOKEN" | gh auth login --with-token
  else
    echo "ERROR: GITHUB_TOKEN required in CI/CD"
    exit 1
  fi
else
  # Interactive mode: Prompt user
  prompt_auth_login github
fi
```

### CI/CD Example

```bash
# .github/workflows/pr-review.yml
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
      - name: Configure Git
        run: git config --global user.name "CI Bot"
      - name: Run PR review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AUTH_INTERACTIVE: false  # Force non-interactive
        run: |
          source plugins/leyline/skills/authentication-patterns/modules/interactive_auth.sh
          ensure_auth github || exit 1
          /pr-review ${{ github.event.pull_request.number }}
```

## Multi-Service Support

### Authenticated Multiple Services

```bash
# Authenticate multiple services in sequence
ensure_auth github || exit 1
ensure_auth gitlab || exit 1
ensure_auth aws || exit 1

# Use all services
gh pr list
glab issue list
aws s3 ls
```

### Service Configuration

Each service has its own configuration:

```bash
# GitHub
ensure_auth github
# Uses: gh auth status
# Cache: ~/.cache/claude-auth/github/

# GitLab
ensure_auth gitlab
# Uses: glab auth status
# Cache: ~/.cache/claude-auth/gitlab/

# AWS
ensure_auth aws
# Uses: aws sts get-caller-identity
# Cache: ~/.cache/claude-auth/aws/
```

## Error Handling

### Retry Logic

Failed authentications are retried with exponential backoff:

```bash
MAX_ATTEMPTS=3
ATTEMPT=1

while [[ $ATTEMPT -le $MAX_ATTEMPTS ]]; do
  if ensure_auth github; then
    break
  fi

  ATTEMPT=$((ATTEMPT + 1))

  if [[ $ATTEMPT -le $MAX_ATTEMPTS ]]; then
    WAIT=$((2 ** ATTEMPT))  # 2, 4, 8 seconds
    echo "Retrying in ${WAIT}s... (attempt $ATTEMPT/$MAX_ATTEMPTS)"
    sleep $WAIT
  fi
done
```

### Error Diagnostics

Common authentication failures and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| `gh: command not found` | GitHub CLI not installed | Install via `brew install gh` or equivalent |
| `gh auth status: failed` | Not authenticated | Run `gh auth login` or set `GITHUB_TOKEN` |
| `Token expired` | Cached token expired | Re-authenticate with `ensure_auth github` |
| `Invalid credentials` | Wrong token/keys | Verify credentials in service dashboard |

## Advanced Usage

### Custom Cache Configuration

```bash
# Extend cache lifetime to 1 hour
export AUTH_CACHE_TTL=3600
ensure_auth github

# Disable caching entirely
export AUTH_CACHE_TTL=0
ensure_auth github
```

### Custom Cache Directory

```bash
# Use custom cache location
export AUTH_CACHE_DIR="$HOME/.my-auth-cache"
ensure_auth github
```

### Session Persistence

```bash
# Extend session to 7 days
export AUTH_SESSION_TTL=604800
ensure_auth github
```

### Force Interactive Mode

```bash
# Force interactive prompts (even in CI)
export AUTH_INTERACTIVE=true
ensure_auth github
```

### Force Non-Interactive Mode

```bash
# Disable prompts (fail if not authenticated)
export AUTH_INTERACTIVE=false
ensure_auth github || exit 1
```

## Integration Examples

### Example 1: PR Review Workflow

```bash
#!/usr/bin/env bash
# /pr-review command

source plugins/leyline/skills/authentication-patterns/modules/interactive_auth.sh

# Ensure GitHub authentication
if ! ensure_auth github; then
  echo "❌ GitHub authentication required for PR review"
  exit 1
fi

# Continue with workflow
PR_NUMBER="$1"
gh pr view "$PR_NUMBER"
gh api repos/owner/repo/pulls/$PR_NUMBER/comments
```

### Example 2: Multi-Repository Operations

```bash
#!/usr/bin/env bash
# Sync issue labels across repos

source plugins/leyline/skills/authentication-patterns/modules/interactive_auth.sh

ensure_auth github || exit 1

for repo in repo1 repo2 repo3; do
  gh label sync --repo owner/$repo
done
```

### Example 3: CI/CD Pipeline

```yaml
# .github/workflows/issue-sync.yml
name: Sync Issues

on:
  schedule:
    - cron: '0 * * * *'

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Sync issues
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AUTH_INTERACTIVE: false
        run: |
          source plugins/leyline/skills/authentication-patterns/modules/interactive_auth.sh
          ensure_auth github || exit 1
          ./scripts/sync-issues.sh
```

## Exit Criteria

- Service is authenticated (via CLI or token)
- Session is cached for future use
- Workflow can proceed with API access
- CI/CD environments use environment variables

## Troubleshooting

### Cache Issues

**Problem:** Auth not working after changing credentials

**Solution:**
```bash
clear_all_auth_cache
ensure_auth github
```

### Session Issues

**Problem:** Keeps asking for authentication

**Solution:**
```bash
# Check session file
cat ~/.cache/claude-auth/github/session.json

# Extend session TTL
export AUTH_SESSION_TTL=604800  # 7 days
ensure_auth github
```

### CI/CD Issues

**Problem:** Fails in CI with "not a terminal"

**Solution:**
```bash
# Force non-interactive mode
export AUTH_INTERACTIVE=false
export GITHUB_TOKEN="..."  # Set token
ensure_auth github
```

## Security Considerations

1. **Token Storage**: Tokens are stored by service CLIs (not by this module)
   - GitHub: `~/.config/gh/hosts.yml`
   - GitLab: `~/.config/glab/config.yml`
   - AWS: `~/.aws/credentials`

2. **Cache Permissions**: Cache directory has restricted permissions (`0700`)

3. **No Token Logging**: Tokens are never logged or echoed

4. **Session Expiration**: Sessions expire to limit credential lifetime

5. **CI/CD Best Practice**: Use short-lived tokens in CI/CD environments
