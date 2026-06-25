---
summary: "Troubleshooting ClawHub sign-in, install, publish, update, and API issues."
read_when:
  - ClawHub CLI or OpenClaw registry commands fail
  - A package cannot be installed, published, or updated
---

# Troubleshooting

## `clawhub login` opens a browser but never completes

The CLI starts a short-lived local callback server during browser login.

- Make sure your browser can reach `http://127.0.0.1:<port>/callback`.
- Check local firewall, VPN, and proxy rules if the callback never arrives.
- In headless environments, create an API token in the ClawHub web UI and run:

```bash
clawhub login --token clh_...
```

## `whoami` or `publish` returns `Unauthorized` (401)

- Sign in again with `clawhub login`.
- If you use a custom config path, confirm `CLAWHUB_CONFIG_PATH` points at the
  file that contains your current token.
- If you use an API token, confirm it was not revoked in the web UI.

## Search or install returns `Rate limit exceeded` (429)

Read the retry information in the response:

- `Retry-After`: seconds to wait before retrying.
- `RateLimit-Limit`: the limit applied to this request.
- `RateLimit-Remaining`: your exact remaining budget when the header is present. On `429`, it is `0`.
- `RateLimit-Reset` or `X-RateLimit-Reset`: reset timing.

If many users share one egress IP, anonymous IP limits can be hit even when each
person only sends a few requests. Sign in where possible and retry after the
reported delay.

## Search or install fails behind a proxy

The CLI respects standard proxy variables:

```bash
export HTTPS_PROXY=http://proxy.example.com:3128
clawhub search "my query"
```

Supported names include `HTTPS_PROXY`, `HTTP_PROXY`, `https_proxy`, and
`http_proxy`.

## A skill does not appear in search

- Check the exact slug or owner page if you know it.
- Confirm the release is public and not held by scan or moderation.
- If you own the skill, sign in and inspect it:

```bash
clawhub inspect @openclaw/demo
```

Owner-visible diagnostics may explain scan, upload-gate, or moderation state.

## Publish fails because required metadata is missing

For skills, check `SKILL.md` frontmatter. Required environment variables and
tools should be declared so users and scanners can understand the package.

For plugins, check `package.json` compatibility metadata. Code-plugin publishes
need OpenClaw compatibility fields such as `openclaw.compat.pluginApi` and
`openclaw.build.openclawVersion`.

Preview the publish payload first:

```bash
clawhub package publish <source> --family code-plugin --dry-run
```

## Publish fails with a GitHub owner or source error

ClawHub uses GitHub identity and source attribution to connect packages to their
publishers.

- Make sure you are signed in with the GitHub account that owns or can publish
  the package.
- Check that the source URL is public or accessible to ClawHub.
- For GitHub sources, use `owner/repo`, `owner/repo@ref`, or a full GitHub URL.

## Publish fails because a namespace is claimed or reserved

If a publish fails because the owner handle, org namespace, package scope, skill
slug, or package name is already claimed or reserved, first confirm that you are
publishing with the owner that matches the namespace. For plugin packages,
scoped names such as `@example-org/example-plugin` must be published as the
matching `example-org` owner.

If you believe your org, project, or brand is the rightful namespace owner but
you cannot manage the current ClawHub owner, open an
[Org / Namespace Claim issue](https://github.com/openclaw/clawhub/issues/new?template=org-namespace-claim.yml)
with public, non-sensitive proof. See
[Org and Namespace Claims](./namespace-claims.md) for evidence guidance and what
to keep out of public issues.

## `sync` says no skills were found

`sync` looks for folders containing `SKILL.md` or `skill.md`.

Point it at the roots you want to scan:

```bash
clawhub sync --root /path/to/skills
```

Preview first if you are unsure what will publish:

```bash
clawhub sync --all --dry-run --no-input
```

## `update` refuses because of local changes

The local files do not match any version ClawHub knows about. Choose one:

- Keep local edits and skip the update.
- Overwrite with the published version:

```bash
clawhub update @openclaw/demo --force
```

- Publish your edited copy as a new slug or fork.

## A plugin install fails in OpenClaw

- Use an explicit ClawHub source:

```bash
openclaw plugins install clawhub:<package>
```

- Check the package detail page for scan status and compatibility metadata.
- Confirm your OpenClaw version satisfies the package's advertised
  compatibility range.
- If the package is hidden, held, or blocked, it may not be installable until
  the owner resolves the issue.

## Public API requests fail

- Respect `429` retry headers and cache public list/search responses.
- Link users back to the canonical ClawHub listing.
- Do not mirror hidden, private, held, or moderation-blocked content outside the
  public API surface.

See [HTTP API](./http-api.md) for endpoint details.
