---
summary: "ClawHub sign-in, API tokens, CLI login, token storage, and revocation."
read_when:
  - Signing in to ClawHub
  - Using the ClawHub CLI
  - Debugging 401s
---

# Auth

ClawHub uses GitHub for web sign-in. The CLI uses ClawHub API tokens created
through that signed-in account.

## Web sign-in

Use GitHub to sign in at [clawhub.ai](https://clawhub.ai).

Deleted, banned, or disabled accounts cannot complete normal ClawHub sign-in.
If sign-in returns you to a logged-out state, your account may not be in good
standing.

## CLI login

The default CLI login flow opens your browser:

```bash
clawhub login
clawhub whoami
```

What happens:

1. The CLI starts a temporary callback server on `127.0.0.1`.
2. Your browser opens the ClawHub sign-in page.
3. After GitHub sign-in, ClawHub creates an API token.
4. The browser redirects back to the local callback.
5. The CLI stores the token in your ClawHub config file.

If your browser cannot reach the local callback because of firewall, VPN, or
proxy rules, use the headless token flow.

## Headless login

Create a token in the ClawHub web UI, then pass it to the CLI:

```bash
clawhub login --token clh_...
```

Use this flow for servers, CI jobs, or terminal-only environments.

For remote shells where you can open a browser elsewhere, run:

```bash
clawhub login --device
```

The CLI prints a one-time code and waits while you authorize it at
`https://clawhub.ai/cli/device`.

## Token storage

Default config paths:

- macOS: `~/Library/Application Support/clawhub/config.json`
- Linux/XDG: `$XDG_CONFIG_HOME/clawhub/config.json` or `~/.config/clawhub/config.json`
- Windows: `%APPDATA%\\clawhub\\config.json`

Override the path with:

```bash
export CLAWHUB_CONFIG_PATH=/path/to/config.json
```

## Revocation

You can revoke API tokens in the ClawHub web UI.

Revoked, invalid, or missing tokens return `401 Unauthorized`. Sign in again
with `clawhub login` or provide a fresh token with `clawhub login --token`.

Deleted, banned, or disabled accounts cannot continue using existing API tokens.

## Local development impersonation

For local development, you can browse authenticated pages without a real GitHub
OAuth flow or production tokens.

Requirements:

1. Run the dev seed so the `local` user exists:
   ```bash
   bunx convex dev --once
   bunx convex run devSeed:seedNixSkills
   ```
2. Set the impersonation env var on your Convex deployment:
   ```bash
   bunx convex env set CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE local
   ```
3. Start the app normally:
   ```bash
   bun run dev
   ```

What happens:

- The backend resolves `api.users.me` to the seeded `local` admin user.
- The frontend treats this as an authenticated session for navigation and UI.
- A small **dev** badge appears in the header so you know it is not real GitHub auth.
- Sign-out is hidden because there is no real session to end.

Guardrails:

- This only works on dev/local Convex deployments (`anonymous:`, `dev:`, `local:`)
  or when `CLAW_HUB_ENABLE_DEV_IMPERSONATION=1` is explicitly set.
- It is blocked on deployment names starting with `prod:` or containing `production`.
- No JWT is minted, no production token is copied, and the real OAuth flow is
  untouched.
