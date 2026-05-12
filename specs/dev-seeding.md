---
summary: "Local development fixture seeding ownership rules."
read_when:
  - Working on local seed data
  - Editing dashboard empty states
  - Changing devSeed fixtures
---

# Dev Seeding

Local fixture seeding has two distinct modes:

- CLI seeding (`bun run seed:dev`) populates shared catalog fixtures under `@local`.
- Browser-triggered dashboard seeding must clone fixtures for the authenticated local user.

The browser path must derive the user from Convex auth server-side. Do not accept a user id, handle,
or publisher id from the client for ownership. Fixture slugs and package names must include a stable
per-user seed key so multiple developers can use the same dev deployment without colliding.

Browser-triggered fixture seeding is dev-only. It must reject production Convex deployments.
