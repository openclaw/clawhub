---
summary: "Local development fixture seeding ownership rules."
read_when:
  - Working on local seed data
  - Editing dashboard empty states
  - Changing devSeed fixtures
---

# Dev Seeding

Local fixture seeding is command-driven by default:

- CLI seeding (`bun run seed:dev`) populates shared catalog fixtures under `@local`, including
  skill, plugin, scanner, and moderation fixtures. It also imports the committed public corpus and
  refreshes cached global stats. This is the documented local setup path.
- `bun run seed:public-corpus` is the lower-level corpus-only import command. Use it for corpus
  fixture work, not as the default local setup command.
- `bun run validate:public-corpus` validates the committed public corpus fixture without seeding.
- `internal.devSeed.seedCurrentUserFixtures` remains a dev-only internal action for explicit local
  development tools/tests that need fixtures cloned to a local user.

Current-user fixture seeding must not be exposed as a public Convex `api` function or browser UI
action. Internal tooling may pass an `ownerUserId`, but that id must stay inside trusted local seed
tooling rather than crossing a frontend boundary. Fixture slugs and package names must include a
stable per-user seed key so multiple developers can use the same dev deployment without colliding.

Current-user fixture seeding is dev-only. It must reject production Convex deployments, and it
should not be exposed as a first-run dashboard button unless the UX and ownership rules are
intentionally revisited.

Without `OPENAI_API_KEY`, public corpus import may use zero vectors. That is
acceptable for local setup and layout QA, but semantic search quality will be weaker than an
embedding-backed local database.
