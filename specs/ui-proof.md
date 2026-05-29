# UI Proof Runtime

`proof:ui` is always full-stack. Each lane starts local Convex from that lane's
checkout, on deterministic lane-specific ports, then builds and previews the
frontend against those local Convex URLs.

The proof runner must not provide a shared-backend mode. UI proof is meant to
prove the control plane and data plane together: the Git checkout controls both
frontend and Convex source, and the lane-local Convex URL controls the runtime
backend/data used by the browser.

Use `--mode before-after` for baseline-vs-candidate proof and `--mode feature`
for candidate-only proof. Use `--seed-command` when a scenario needs fixtures.

Dev auth must be explicit. The proof runner must not set
`VITE_ENABLE_DEV_AUTH=1` by default; scenarios that need it should pass
`--dev-auth` or explicit `--env` values.
