---
name: convex-test
description: "Generate convex-test tests for the app's Convex functions."
---

<!-- GENERATED from convex-agents content/capabilities/test.json — do not edit by hand. -->

# Generate Convex tests

Use convex-test + vitest to test functions against an in-memory backend: args/returns, auth paths, indexes, and scheduled functions.

## Workflow

1. Install convex-test + vitest.
2. Write tests using convexTest(schema): seed via t.run, call t.query/t.mutation, assert.
3. Cover auth (withIdentity), error paths, and scheduled functions (t.finishInProgressScheduledFunctions).
4. Run vitest; keep tests deterministic.

## Rules

- Use convex-test (in-memory), not a live deployment.
- Cover auth + error paths, not just the happy path.
- Keep tests deterministic (no real time/network).
