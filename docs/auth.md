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

The default CLI login uses device-code approval:

```bash
clawhub login
clawhub whoami
```

What happens:

1. The CLI prints a one-time code and verification URL.
2. Open the printed URL on this or another device and sign in with GitHub if needed.
3. Confirm the code matches your terminal, then select **Authorize**.
4. The CLI polls for approval, receives an API token, verifies it via `whoami`,
   and stores it in your ClawHub config file.

The CLI does not open a browser or start a local callback server. Codes expire
after 15 minutes; run `clawhub login` again if yours expires.

## Headless login

Create a token in ClawHub Settings → API tokens, then pass it to the CLI:

```bash
clawhub login --token clh_...
```

Use this flow for unattended login on servers or in CI jobs. `--no-input` alone
still waits for device approval.

The default device flow also works from remote shells. `--device` explicitly
selects the same flow:

```bash
clawhub login --device
```

Open the printed verification URL in a browser on another device and authorize
the code while the CLI waits.

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
