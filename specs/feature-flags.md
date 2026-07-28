# Feature flags

ClawHub evaluates release flags through Krill Switch during server rendering,
then keeps them fresh in the browser. Flags are not an authorization or security
boundary: protected operations must continue to enforce their rules in Convex
and HTTP handlers.

## Runtime contract

- The root server loader calls `POST https://flags.openclaw.ai/v1/eval` using the
  public environment evaluation key from `VITE_KRILLSWITCH_EVAL_KEY`, then
  serializes those values for hydration. Visible flagged content must not render
  a different code default before hydration.
- `VITE_KRILLSWITCH_BASE_URL` can override the evaluation origin for local
  testing. It defaults to the production evaluation host.
- Missing configuration, network errors, invalid payloads, and incompatible
  remote value types preserve code-owned defaults. Server evaluation has a
  200 ms budget and must not block rendering beyond it.
- Evaluations use an anonymous context key persisted in a first-party HTTP-only
  cookie and passed to the hydrated provider. The server and browser must use
  the same key so targeting and percentage rollouts remain stable. Do not add
  personal or sensitive attributes without documenting why targeting needs them.
- Values refresh when the page becomes visible and every 60 seconds. ETags
  avoid retransmitting unchanged evaluations.

The official `@openclaw/krillswitch-react` SDK owns response validation, typed
manifest merging, SSR evaluation, hydration bootstrap, caching, and polling.
Keep ClawHub's adapter limited to runtime configuration and app-specific flags.

## Initial proof flag

The `souls` boolean flag defaults to `false`. When enabled, the home hero
subtitle changes from “Discover skills and plugins from top creators” to
“Discover skills and plugins built with soul.” This is intentionally a safe,
copy-only proof that can be toggled without changing application behavior.
