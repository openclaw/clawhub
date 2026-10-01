---
name: convex-verify
description: "Prove a Convex feature works — seed, drive as multiple mocked users via convex-test, assert behavior including the negative authz cases (wrong user refused, data-scope enforced)."
---

<!-- GENERATED from convex-agents content/capabilities/convex-verify.json — do not edit by hand. -->

# Prove a feature works — seed, drive, assert

A green typecheck proves the code parses; it does not prove a non-owner is actually denied, that a query returns the right rows, or that a mutation has the effect it claims. This capability closes that gap with the loop the whole field is missing: seed → drive → assert, run in-process with `convex-test` so it needs no deployment. Its highest-value assertions are the NEGATIVE ones — the caller who should be refused — because those are exactly the authz defects the 30-app corpus shows are the #1 real bug and the ones a happy-path demo never catches.

## Workflow

1. IDENTIFY the feature to prove: the specific exported query/mutation/action (or a small set) the user just built/changed, and its intended behavior — who should be allowed, what data should come back, what a mutation should change. If the intent is unstated, ask one focused question rather than guessing the contract.
2. SET UP `convex-test`: ensure `convex-test` + `vitest` are dev deps AND a `vitest.config.ts` sets `test.environment: "edge-runtime"` with `server.deps.inline: ["convex-test"]` — WITHOUT that config, `convexTest(schema)` fails at runtime with `import.meta.glob is not a function` (verified). Also install `@edge-runtime/vm`. Then `convexTest(schema)` gives a `t` handle. Reuse the project's existing test setup if present (compose with the `test` capability, don't fork it).
3. SEED realistic data through the app's OWN functions where possible (so the seed exercises the same validators/mutations a real user would), falling back to `t.run(async (ctx) => ctx.db.insert(...))` for fixtures the public API can't create. Seed at least: the caller's own rows AND a second user's rows, so cross-user access is testable.
4. DRIVE the feature as DIFFERENT identities with `t.withIdentity({ subject, tokenIdentifier, ... })`: call the function as (a) the legitimate owner, (b) a different authenticated user, and (c) unauthenticated (`t` with no identity). Use the real identity shape the app's auth uses (subject/tokenIdentifier), matching how ownership is resolved.
5. ASSERT behavior — POSITIVE and NEGATIVE:
   - positive: the owner gets the expected rows / the mutation made the expected change (`expect(await t.withIdentity(owner).query(api.x.y, args)).toEqual(...)`).
   - NEGATIVE (the load-bearing half): a different user calling the same function is REFUSED — `await expect(t.withIdentity(other).mutation(api.x.cancel, {id})).rejects.toThrow(/forbidden|not authorized|403/)` — and an unauthenticated caller is refused where auth is required. A feature is not proven until the wrong caller is shown to be blocked.
   - data-scope: a list/query returns ONLY the caller's rows, never the second user's (assert the second user's row is absent).
6. RUN the tests (`npx vitest run`) and report: what was proven (each positive + negative assertion that passed), and — critically — any assertion that FAILED, because a failed negative assertion is a real authz hole found before ship. Emit findings on the bus (specs/finding.schema.json, class authz/correctness, evidence kind probe-result with the exact failing call) for anything that didn't behave.
7. Do NOT weaken a test to make it pass: if the owner-only query returns another user's row, the FIX is in the function (hand to convex-authz), not in the assertion. A test changed until it's green proves nothing.

## Rules

- Prove behavior, not compilation: every verification includes at least one NEGATIVE assertion (a caller who should be refused is refused) — the happy path alone is not proof.
- Drive the feature as multiple identities with t.withIdentity (owner, other user, unauthenticated) using the app's real subject/tokenIdentifier shape.
- Seed both the caller's rows AND a second user's rows so cross-user access and data-scope are actually testable.
- A vitest.config.ts with environment 'edge-runtime' + convex-test inlined is REQUIRED for convex-test to run (import.meta.glob needs it); author it, don't just author the test file.
- Run in-process with convex-test — no deployment needed; compose with the `test` capability's setup rather than forking it.
- Never weaken an assertion to make it pass: a failing negative test is a real defect → hand the fix to convex-authz/convex-expert, don't edit the test until it's green.
- Emit a bus finding for any assertion that failed (authz/correctness, evidence: the failing probe call) so a composite pass or self-heal can pick it up.
- This drives a SPECIFIC built feature; a request to set up a test framework generally is the `test` capability.
