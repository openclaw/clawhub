---
summary: 'Documentation index + reading order.'
read_when:
  - New contributor onboarding
  - Looking for the right doc
---

# Docs

Reading order (new contributor):

1. `README.md` (repo root): run locally.
2. `docs/quickstart.md`: end-to-end: search → install → publish → sync.
3. `docs/architecture.md`: how the pieces fit (TanStack Start + Convex + CLI).
4. `docs/skill-format.md`: what a “skill” is on disk + on the registry.
5. `docs/cli.md`: CLI reference (flags, config, lockfiles, sync rules).
6. `docs/http-api.md`: HTTP endpoints used by the CLI + public API.
7. `docs/auth.md`: GitHub OAuth + API tokens + CLI loopback login.
8. `docs/deploy.md`: Convex + Vercel deployment + rewrites.
9. `docs/troubleshooting.md`: common failure modes.

Feature/ops docs (already present):

- `docs/spec.md`: product + implementation spec (data model + flows).
- `docs/security.md`: moderation, reporting, bans, upload gating.
- `docs/telemetry.md`: what `clawhub sync` reports; opt-out.
- `docs/webhook.md`: Discord webhook events/payload.
- `docs/diffing.md`: version-to-version diff UI spec.
- `docs/manual-testing.md`: CLI smoke scripts.

Docs tooling:

- `docs/mintlify.md`: publish these docs with Mintlify.
