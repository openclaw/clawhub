# UI Proof Runtime

`proof:ui` always verifies a full-stack ClawHub instance. Crabbox lanes start
local Convex from that lane's checkout, on deterministic lane-specific ports,
then build and preview the frontend against those local Convex URLs. Local
Playwright lanes attach to maintainer-started ClawHub instances on localhost or
a loopback address.

The proof runner must not provide a shared or production-backend mode. UI proof
is meant to prove the control plane and data plane together: the Git checkout
controls both frontend and Convex source, and the lane-local Convex URL controls
the runtime backend/data used by the browser.

Use `--mode before-after` for baseline-vs-candidate proof and `--mode feature`
for candidate-only proof. Use `--seed-command` when a scenario needs fixtures.

Dev auth must be explicit. The proof runner must not set
`VITE_ENABLE_DEV_AUTH=1` by default; scenarios that need it should pass
`--dev-auth` or explicit `--env` values.

Crabbox is an optional execution environment, not a prerequisite for visual
verification. Agents should use `proof:ui` when a Crabbox skill or working
Crabbox capability is available. Otherwise they should ignore Crabbox and run
the same temporary scenario with `proof:ui --runner local` against real local
ClawHub instances. Local before/after evidence requires separate baseline and
candidate URLs and keeps the results in separate `baseline/` and `candidate/`
directories so `proof:publish` can publish either execution path.
