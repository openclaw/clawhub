---
name: convex-migrate
description: "Migrate schema + backfill data on a deployed Convex app using @convex-dev/migrations."
---

<!-- GENERATED from convex-agents content/capabilities/migrate.json — do not edit by hand. -->

# Migrate the schema / data on a live app

Change a deployed schema without breaking existing data: stage the schema change, install @convex-dev/migrations, write a backfill that makes old rows valid, run it, and verify before tightening the validator.

## Workflow

1. Make the new field optional first (so deploy doesn't reject existing rows).
2. Install @convex-dev/migrations; write a migration that backfills/transforms existing rows.
3. Run the migration; verify all rows are valid.
4. Tighten the validator (make the field required) once the backfill is complete.

## Rules

- Never tighten a validator before the backfill completes — it rejects existing rows and breaks the live app.
- Add new fields as optional first, migrate, then require.
- Verify row counts before and after.
