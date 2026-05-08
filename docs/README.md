---
summary: "Public ClawHub docs index and reading order."
read_when:
  - New contributor onboarding
  - Looking for the right doc
---

# Docs

`docs/` is the publishable source for ClawHub pages that can be mirrored into
`docs.openclaw.ai`. Keep user, publisher, API, CLI, security, and operator docs
here.

Use `specs/` for product specs, implementation plans, regression notes, design
history, and maintainer-only validation records. If a page explains what users
can do or how operators run ClawHub, it belongs in `docs/`; if it explains why a
future or internal design exists, it belongs in `specs/`.

Reading order:

1. `README.md` (repo root): run locally.
2. `docs/clawhub.md`: public overview for ClawHub discovery, install, publish, and security.
3. `docs/quickstart.md`: end-to-end: search, install, publish, sync.
4. `docs/architecture.md`: how the pieces fit (TanStack Start + Convex + CLI).
5. `docs/skill-format.md`: what a skill is on disk and on the registry.
6. `docs/cli.md`: CLI reference (flags, config, lockfiles, sync rules).
7. `docs/http-api.md`: HTTP endpoints used by the CLI and public API.
8. `docs/auth.md`: GitHub OAuth + API tokens + CLI loopback login.
9. `docs/deploy.md`: Convex + Vercel deployment + rewrites.
10. `docs/troubleshooting.md`: common failure modes.

Public/operator docs:

- `docs/acceptable-usage.md`: marketplace policy and enforcement boundaries.
- `docs/api.md`: public REST API overview.
- `docs/security.md`: moderation, reporting, bans, upload gating.
- `docs/telemetry.md`: what `clawhub sync` reports and how to opt out.
- `docs/webhook.md`: Discord webhook events and payloads.
- `docs/soul-format.md`: SOUL.md bundle format.

Maintainer records:

- `specs/README.md`: index for specs, plans, regression notes, and design records.

Publish flow:

- Changes under `docs/` dispatch the OpenClaw docs sync workflow, which mirrors this directory into the `ClawHub` tab on `docs.openclaw.ai`.
- `specs/` is intentionally not mirrored.
