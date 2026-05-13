---
name: crabbox
description: Use when ClawHub needs remote Linux validation, CI-parity checks, broad Bun gates, hosted-service checks, desktop/VNC inspection, or Crabbox lease cleanup.
---

# Crabbox

Crabbox is ClawHub's agent-facing isolation layer. Use direct `blacksmith`
commands only as a backend emergency fallback; normal agents should go through
the repo scripts below.

## Fast Checks

Run from the repo root:

```sh
bun run crabbox:run -- --help
bun run crabbox:warmup -- --provider blacksmith-testbox --blacksmith-org openclaw --blacksmith-workflow .github/workflows/ci-check-testbox.yml --blacksmith-job check
```

The wrapper prefers `../crabbox/bin/crabbox` when present and rejects stale
binaries that do not support the Blacksmith Testbox provider. For desktop UI
proof, use a Crabbox-owned provider such as `hetzner` or `aws`; the
`blacksmith-testbox` provider cannot expose VNC, screenshots, or desktop
artifacts.

## Common Remote Validation

Broad ClawHub gates:

```sh
bun run crabbox:run -- --provider blacksmith-testbox --shell -- "bun run ci:static"
bun run crabbox:run -- --provider blacksmith-testbox --shell -- "VITE_CONVEX_URL=https://example.invalid bun run coverage"
```

Reusable desktop lease:

```sh
bun run crabbox:warmup -- --provider hetzner --desktop --browser --class standard --idle-timeout 60m --ttl 120m
bun run crabbox:run -- --provider hetzner --id <cbx_id-or-slug> --keep --shell -- "bun run test"
bun run crabbox:stop -- --provider hetzner <cbx_id-or-slug>
```

## Cleanup

Stop leases created for the task before handoff unless the user asked to keep
one open for WebVNC inspection:

```sh
bun run crabbox:stop -- --provider <provider> <id-or-slug>
```
