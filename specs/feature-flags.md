# Feature flags

ClawHub evaluates release flags through Krill Switch. Flags are a client-side
progressive enhancement, not an authorization or security boundary: protected
operations must continue to enforce their rules in Convex and HTTP handlers.

## Runtime contract

- The browser calls `POST https://flags.openclaw.ai/v1/eval` using the public
  environment evaluation key from `VITE_KRILLSWITCH_EVAL_KEY`.
- `VITE_KRILLSWITCH_BASE_URL` can override the evaluation origin for local
  testing. It defaults to the production evaluation host.
- Missing configuration, network errors, invalid payloads, and incompatible
  remote value types preserve code-owned defaults and must not block rendering.
- Evaluations use a persisted anonymous context key. Do not add personal or
  sensitive attributes without documenting why the targeting requires them.
- Values refresh when the page becomes visible and every 60 seconds. ETags
  avoid retransmitting unchanged evaluations.

The Krill Switch SDK packages are private today, so ClawHub owns a small typed
adapter around the stable public evaluation API. Replace the adapter with the
official React SDK once it is published rather than growing a second general
feature-flag SDK here.

## Initial proof flag

The `souls` boolean flag defaults to `false`. When enabled, the home hero
subtitle changes from “Discover skills and plugins from top creators” to
“Discover skills and plugins built with soul.” This is intentionally a safe,
copy-only proof that can be toggled without changing application behavior.
