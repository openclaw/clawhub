---
summary: "Documentation index + reading order."
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
5. `docs/plugin-publishing.md`: publish plugin packages and preview ClawPack output.
6. `docs/clawpack.md`: ClawPack artifact contract, download, and verification.
7. `docs/clawpack-operations.md`: ClawPack moderation, backfill, retry, and revocation.
8. `docs/official-plugin-migration-readiness.md`: readiness tracking for future OpenClaw externalization.
9. `docs/cli.md`: CLI reference (flags, config, lockfiles, sync rules).
10. `docs/http-api.md`: HTTP endpoints used by the CLI + public API.
11. `docs/auth.md`: GitHub OAuth + API tokens + CLI loopback login.
12. `docs/deploy.md`: Convex + Vercel deployment + rewrites.
13. `docs/troubleshooting.md`: common failure modes.

Feature/ops docs (already present):

- `docs/spec.md`: product + implementation spec (data model + flows).
- `docs/security.md`: moderation, reporting, bans, upload gating.
- `docs/telemetry.md`: what `clawhub sync` reports; opt-out.
- `docs/webhook.md`: Discord webhook events/payload.
- `docs/diffing.md`: version-to-version diff UI spec.
- `docs/manual-testing.md`: CLI smoke scripts.
- `docs/clawpack.md`: ClawPack artifact model and integrity checks.
- `docs/clawpack-operations.md`: staff operation runbook for ClawPack artifacts.
- `docs/plugin-publishing.md`: publisher workflow for code and bundle plugins.
- `docs/official-plugin-migration-readiness.md`: ClawHub-only readiness tracker for bundled OpenClaw plugin migration planning.

Docs tooling:

- `docs/mintlify.md`: publish these docs with Mintlify.
