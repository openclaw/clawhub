---
name: convex-seed
description: "Seed or import data into the Convex database."
---

<!-- GENERATED from convex-agents content/capabilities/seed.json — do not edit by hand. -->

# Seed / import data

Populate tables via an internalMutation seed function (re-runnable) or `npx convex import`, matching the schema.

## Workflow

1. For fixtures: write an internalMutation that inserts sample rows; run it with `npx convex run`.
2. For bulk import: shape the data to the schema and use `npx convex import`.
3. Make seeding idempotent (clear-then-insert or upsert) so re-running is safe.
4. Verify row counts.

## Rules

- Seed via internalMutation or convex import, matching validators.
- Make seeding idempotent.
- Never seed secrets/PII into a shared deployment.
