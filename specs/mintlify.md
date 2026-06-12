---
summary: "Mintlify setup notes for publishing docs/."
read_when:
  - Setting up docs site
---

# Mintlify

Goal: publish `docs/` as the browsable ClawHub docs site at
`https://clawhub.ai/docs`.

`docs/docs.json` is the Mintlify configuration. The repo keeps public docs,
navigation, branding, and docs assets inside `docs/` so the Mintlify project can
publish that directory directly.

## Local workflow

- Preview locally with `bun run docs:dev`.
- Validate the Mintlify project with `bun run docs:check`.
- Do not generate or commit `public/docs`; ClawHub docs are served by Mintlify,
  not by the TanStack/Vite app build.

## Production setup

- Connect the Mintlify project to this repository's `docs/` directory.
- Configure production hosting so canonical docs resolve under
  `https://clawhub.ai/docs`.
- Keep `specs/` unpublished; only the public user/operator docs in `docs/`
  belong in the docs site.

Notes:

- Keep page paths in `docs/docs.json` extensionless.
- Keep source files as `.md` unless a page needs MDX-only behavior.

## Recommended “docs UX” additions

- Use `docs/index.md` as the Overview page.
- Keep “Quickstart” copy/paste friendly.
- Provide CLI + HTTP API reference pages (done here).
- Add a Troubleshooting page for common setup failures.
