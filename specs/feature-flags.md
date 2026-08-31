# Feature flags

ClawHub evaluates release flags through Krill Switch during server rendering,
then keeps them fresh in the browser. Flags are not an authorization or security
boundary: protected operations must continue to enforce their rules in Convex
and HTTP handlers.

## Runtime contract

- The home route loader calls `POST https://flags.openclaw.ai/v1/eval` using the
  public environment evaluation key from `VITE_KRILLSWITCH_EVAL_KEY`, then
  serializes those values for hydration. Unrelated routes do not evaluate or
  poll Krill Switch. Visible flagged content must not render a different code
  default before hydration.
- `VITE_KRILLSWITCH_BASE_URL` can override the evaluation origin for local
  testing. It defaults to the production evaluation host.
- When `VITE_KRILLSWITCH_EVAL_KEY` is absent, the homepage uses code defaults
  without contacting Krill Switch.
- Missing configuration, network errors, invalid payloads, and incompatible
  remote value types preserve code-owned defaults. Server evaluation has a
  200 ms budget and must not block rendering beyond it.
- Evaluations use the service-wide `clawhub-homepage` context on both the server
  and browser. The initial proof flag is a global toggle: ClawHub does not create
  or transmit a per-visitor rollout identifier. Introducing visitor targeting or
  percentage rollouts requires a separate privacy and product decision.
- While the home route is mounted, values refresh when the page becomes visible
  and every 60 seconds. ETags avoid retransmitting unchanged evaluations.

The official `@openclaw/krillswitch-react` SDK owns response validation, typed
manifest merging, SSR evaluation, hydration bootstrap, caching, and polling.
Keep ClawHub's adapter limited to runtime configuration and app-specific flags.

## Homepage pilot decision

ClawHub adopts Krill Switch for a bounded, global homepage-copy pilot. The
production contract is:

- OpenClaw owns the Krill Switch service and published SDK packages.
- The integration is opt-in through `VITE_KRILLSWITCH_EVAL_KEY`; removing that
  setting disables evaluation without a code rollback.
- The homepage may wait up to 200 ms for server evaluation, then renders code
  defaults. Krill availability must not make the homepage unavailable.
- The pilot uses one non-identifying `clawhub-homepage` context. Per-visitor
  targeting, attributes, or percentage rollouts are outside the approved scope.
- Flags control presentation only. Authorization and security decisions remain
  enforced by application and backend code.
- SDK upgrades require normal dependency, integrity, and changed-behavior
  review before production adoption.

## Initial proof flag

The `homepageTestMessage` boolean flag defaults to `false`. When enabled, the
home hero subtitle changes from “Discover skills and plugins from top creators”
to “Feature flag test is enabled.” This is intentionally an obvious, temporary,
copy-only proof that can be toggled without changing application behavior.
