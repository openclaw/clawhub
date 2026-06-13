---
summary: "Public ClawHub docs index and reading order."
read_when:
  - Looking for the right public ClawHub doc
  - Deciding whether content belongs in public docs or specs
---

# Docs

`docs/` is the publishable source for user-facing ClawHub documentation served
under `https://clawhub.ai/docs`.

Keep product, CLI, publisher, API, policy, security, and troubleshooting docs
here. These pages should explain how people use ClawHub: discover, install,
publish, inspect, report, moderate, and integrate with the registry.

Use `specs/` for repository setup, production deploy runbooks, implementation
plans, design rationale, regression notes, maintainer validation records, and
internal subsystem intent. If a page tells someone how to run or deploy the
ClawHub project itself, it belongs in `specs/`, not in the public ClawHub docs
site.

Reading order:

1. `docs/clawhub.md`: public overview for discovery, install, publish, and trust.
2. `docs/quickstart.md`: product quickstart for users and publishers.
3. `docs/how-it-works.md`: listings, versions, installs, publishing, scans, and API access.
4. `docs/publishing.md`: owner-scoped skill/plugin publishing flow.
5. `docs/cli.md`: ClawHub CLI reference.
6. `docs/skill-format.md`: skill bundle metadata and package shape.
7. `docs/auth.md`: GitHub OAuth, API tokens, and CLI login.
8. `docs/telemetry.md`: install telemetry and how to opt out.
9. `docs/troubleshooting.md`: user-facing CLI, install, publish, sync, update, and API fixes.

Policy, API, and trust docs:

- `docs/acceptable-usage.md`: marketplace policy and enforcement boundaries.
- `docs/api.md`: public REST API overview.
- `docs/http-api.md`: detailed HTTP API reference.
- `docs/security.md`: reporting ClawHub security issues and vulnerability disclosure policy.
- `docs/security-audits.md`: user-facing security audit status, risk levels, findings, and interpretation.
- `docs/moderation.md`: reports, moderation holds, hidden listings, bans, and account standing.

Maintainer records:

- `specs/README.md`: index for specs, plans, deployment runbooks, webhook notes, regression notes, and design records.

Publish flow:

- Build with `bun run docs:build`; this stages `docs/` into the shared
  `openclaw/docs` renderer and writes the generated site to `public/docs`.
- Preview the generated static site with `bun run docs:run`.
- Validate the generated route with `bun run docs:smoke`.
- `specs/` is intentionally not published.
