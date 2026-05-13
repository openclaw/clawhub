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
  skill, plugin, scanner, and moderation fixtures. This is the documented local setup path.
- `devSeed:seedCurrentUserFixtures` remains a dev-only authenticated action for explicit local
  development tools/tests that need fixtures cloned to the signed-in user.

The authenticated current-user path must derive the user from Convex auth server-side. Do not accept
a user id, handle, or publisher id from the client for ownership. Fixture slugs and package names
must include a stable per-user seed key so multiple developers can use the same dev deployment
without colliding.

Current-user fixture seeding is dev-only. It must reject production Convex deployments, and it
should not be exposed as a first-run dashboard button unless the UX and ownership rules are
intentionally revisited.
