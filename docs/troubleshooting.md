---
summary: 'Common setup/runtime issues (CLI + backend) and fixes.'
read_when:
  - Something is broken and you need a fix-fast checklist
---

# Troubleshooting

## `clawhub login` opens browser but never completes

- Ensure your browser can reach `http://127.0.0.1:<port>/callback` (local firewalls/VPNs can interfere).
- Use headless mode:
  - create a token in the web UI (Settings → API tokens)
  - `clawhub login --token clh_...`

## `whoami` / `publish` returns `Unauthorized` (401)

- Token missing or revoked: check your config file (`CLAWHUB_CONFIG_PATH` override?).
- Ensure requests include `Authorization: Bearer ...` (CLI does this automatically).

## CLI/API returns `Rate limit exceeded` (429)

- Read headers in the response:
  - `Retry-After` = wait seconds before retry
  - `RateLimit-Remaining` + `RateLimit-Limit` = current budget
  - `RateLimit-Reset` (or `X-RateLimit-Reset`) = reset timing
- The CLI now includes retry hints in 429 errors (retry delay + remaining budget).
- If many users share one egress IP (NAT/proxy), IP limit can be hit even with valid tokens.
- For non-Cloudflare deploys behind trusted proxies, set `TRUST_FORWARDED_IPS=true` so forwarded client IPs can be used.

## `publish` fails with `OPENAI_API_KEY is not configured`

- Set `OPENAI_API_KEY` in the Convex environment (not only locally).
- Re-run `bunx convex dev` / `bunx convex deploy` after setting env.

## `publish` fails with `GitHub API rate limit exceeded`

- This is the GitHub account-age gate lookup hitting unauthenticated limits.
- Set `GITHUB_TOKEN` in Convex environment to use authenticated GitHub API limits.
- Retry publish after a short wait if the limit was already exhausted.

## `sync` says “No skills found”

- `sync` looks for folders containing `SKILL.md` (or `skill.md`).
- It scans:
  - workdir first
  - then fallback roots (legacy `~/clawdis/skills`, `~/clawdbot/skills`, etc.)
- Provide explicit roots:

```bash
clawhub sync --root /path/to/skills
```

## `update` refuses due to “local changes (no match)”

- Your local files don’t match any published fingerprint.
- Options:
  - keep local edits; skip updating
  - overwrite: `clawhub update <slug> --force`
  - publish as fork: copy to new folder/slug then `clawhub publish ... --fork-of upstream@version`

## `GET /api/*` works locally but not on Vercel

- Check `vercel.json` rewrite destination points at your Convex site URL.
- Ensure `VITE_CONVEX_SITE_URL` and `CONVEX_SITE_URL` match your deployment.
