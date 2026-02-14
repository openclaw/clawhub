---
summary: 'Mintlify setup notes for publishing docs/.'
read_when:
  - Setting up docs site
---

# Mintlify

Goal: publish `docs/` as a browsable docs site (nice UX for OSS users).

This repo does **not** include Mintlify config yet (`mint.json` missing).

## Minimal setup

1) Install Mintlify CLI (per Mintlify docs).

2) Add a `mint.json` at repo root that points to `docs/` pages.

Example (starter):

```json
{
  "name": "ClawHub",
  "logo": "public/logo.svg",
  "navigation": [
    { "group": "Start", "pages": ["docs/README", "docs/quickstart"] },
    { "group": "Concepts", "pages": ["docs/architecture", "docs/skill-format", "docs/telemetry"] },
    { "group": "Reference", "pages": ["docs/cli", "docs/http-api", "docs/auth", "docs/deploy"] }
  ]
}
```

Notes:

- Mintlify usually wants page paths without extension; keep files as `.md`.
- If you prefer Mintlify conventions, rename to `.mdx` later (optional).

## Recommended “docs UX” additions

- Add an “Overview” page (use `docs/README.md`).
- Keep “Quickstart” copy/paste friendly.
- Provide CLI + HTTP API reference pages (done here).
- Add a Troubleshooting page for common setup failures.
