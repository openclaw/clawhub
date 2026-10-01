---
name: convex-optimize
description: "Audit and optimize an existing Convex app: security, scale, upgrades, observability."
---

<!-- GENERATED from convex-agents content/capabilities/optimize.json — do not edit by hand. -->

# Audit and optimize an existing Convex app

The remediation WORKFLOW for an existing app: open with a scored assessment, then act on it — upgrade stale components and set up observability — plan-then-confirm-then-apply. The assessment itself is delegated to launch-readiness (the findings-bus scorer); optimize's distinct value is the actions it takes on the result.

## Workflow

1. Detect the app: a `convex/` directory, the schema, and whether it's an anonymous or cloud deployment.
2. ASSESS via `launch-readiness` — one scored, deduped report across authz/reviewer/advisor/insights with an ordered fix plan. Do not re-run those passes by hand; optimize consumes launch-readiness's report rather than re-implementing the audit.
3. UPGRADE: run `check-updates` against the pinned `@convex-dev/*` components and fold stale-component (staleness-class) findings into the same plan.
4. OBSERVABILITY: if the readiness report flagged an observability gap (no prod error capture), offer to install `sentinel`.
5. Present the combined prioritized plan — the launch-readiness score + the fix plan + upgrades + observability, security/data-loss first — and apply only on explicit confirmation, dispatching each fix to its fixCapability.
6. After applying, re-run the launch-readiness assessment and show the score delta.

## Rules

- Read-only first. Present a plan and CONFIRM before changing any file.
- Delegate the audit to launch-readiness (the findings-bus scorer); don't re-implement reviewer/advisor/insights inline — optimize's job is acting on the report (upgrades + observability), not re-scoring.
- Prioritize security and data-loss risks above style, following launch-readiness's ordering.
- Never auto-land changes on someone's existing prod app; re-assess after applying and show the score moved.
