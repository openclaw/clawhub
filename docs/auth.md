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
standing. If your account was banned or disabled, use the
[ClawHub appeal form](https://appeals.openclaw.ai/) if you believe this is a
mistake.

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

Print the stored token for CI setup with:

```bash
clawhub token
```

## Revocation

You can revoke API tokens in the ClawHub web UI.

Revoked, invalid, or missing tokens return `401 Unauthorized`. Sign in again
with `clawhub login` or provide a fresh token with `clawhub login --token`.

Deleted, banned, or disabled accounts cannot continue using existing API tokens.
If your account was banned or disabled, use the
[ClawHub appeal form](https://appeals.openclaw.ai/) if you believe this is a
mistake.
