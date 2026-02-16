---
summary: 'Auth overview: GitHub OAuth (web) + API tokens (CLI).'
read_when:
  - Working on login/token flows
  - Debugging 401s
---

# Auth

## Web auth (GitHub OAuth)

- Convex Auth + GitHub OAuth App.
- GitHub is the only supported login provider.
- Env vars:
  - `AUTH_GITHUB_ID`
  - `AUTH_GITHUB_SECRET`
  - `CONVEX_SITE_URL` (used by auth config)

Local setup steps are in the repo root `README.md`.

## API tokens (CLI)

The CLI uses a long-lived API token (Bearer token) for publish/sync/delete.

### Browser flow (default)

`clawhub login` does:

1. Starts a loopback HTTP server on `127.0.0.1` (random port).
2. Opens `<site>/cli/auth?redirect_uri=http://127.0.0.1:<port>/callback&state=...`.
3. Web UI requires GitHub login, then creates a token and redirects back to the loopback server.
4. CLI stores the token in the global config file.

### Headless flow

Create a token in the web UI (Settings → API tokens) and paste it:

```bash
clawhub login --token clh_...
```

### Token storage

Default global config path:

- macOS: `~/Library/Application Support/clawhub/config.json`

Override:

- `CLAWHUB_CONFIG_PATH=/path/to/config.json` (legacy `CLAWDHUB_CONFIG_PATH`)

### Revocation

- Tokens can be revoked in the web UI.
- Revoked tokens return `401 Unauthorized` on CLI endpoints.
