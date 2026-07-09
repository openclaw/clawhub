---
summary: "Local development fixture seeding ownership rules."
read_when:
  - Working on local seed data
  - Editing dashboard empty states
  - Changing devSeed fixtures
---

# Dev Seeding

Local fixture seeding is command-driven by default:

- Worktree dev startup (`bun run dev:worktree`) seeds shared catalog fixtures under `@local`,
  including skill, plugin, scanner, and moderation fixtures, before starting the local app when
  `VITE_CONVEX_URL` points at local Convex and `CONVEX_DEPLOYMENT` is an anonymous/local deployment
  marker. It also imports the committed public corpus, refreshes cached global stats, and writes
  `.codex/runtime/dev-worktree.seeded` so routine restarts skip the expensive corpus pass. This is
  the documented first-run local setup path.
- CLI seeding (`bun run seed:dev`) runs the same seed path manually without starting the preview and
  bypasses the first-run sentinel.
- `bun run seed:public-corpus` is the lower-level corpus-only import command. Use it for corpus
  fixture work, not as the default local setup command.
- `bun run validate:public-corpus` validates the committed public corpus fixture without seeding.
- `internal.devSeed.seedCurrentUserFixtures` remains a dev-only internal action for explicit local
  development tools/tests that need fixtures cloned to a local user.
- `internal.previewSeed.seed` is the disposable PR-preview seed. The Vercel preview build invokes it
  only after recreating the paired Convex preview deployment. It requires `CLAWHUB_PREVIEW=1`,
  rejects production, and resets a small deterministic public catalog plus moderation/scanner
  presentation fixtures on every run.

Current-user fixture seeding must not be exposed as a public Convex `api` function or browser UI
action. Internal tooling may pass an `ownerUserId`, but that id must stay inside trusted local seed
tooling rather than crossing a frontend boundary. Fixture slugs and package names must include a
stable per-user seed key so multiple developers can use the same dev deployment without colliding.

Current-user fixture seeding is dev-only. It must reject production Convex deployments, and it
should not be exposed as a first-run dashboard button unless the UX and ownership rules are
intentionally revisited.

Without `OPENAI_API_KEY`, public corpus import may use zero vectors. That is
acceptable for local setup, disposable PR previews, and layout QA, but semantic search quality will
be weaker than an embedding-backed database.
