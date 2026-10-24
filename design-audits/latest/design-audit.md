# ClawHub design audit

- Carapace: `v0.6.1`
- ClawHub commit: `8139080a3ee586b48ed14eceec4e93f85f37dc72`
- Comparison base: `21dc829bf2943c78dfb101f043eef1edb731d35f`
- Generated: 2026-10-05T15:48:09.963Z
- Validation: passed

## Summary

- Errors: 0
- Warnings: 2
- Informational: 0
- Safe source fixes: 1

## Validation

- `bun run test:ui-contract`
- `bun run ci:static`
- `bun run ci:unit`
- `bun run ci:types-build`
- `bun run ci:playwright-smoke`

## Rendered routes

- `/`
- `/skills`
- `/plugins`

## Findings

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L3395)
- Kind: mechanical
- Finding: New code depends on migration-only alias --accent.
- Remediation: Use the equivalent canonical --oc-* semantic token.
- Contract: `openclaw-design-system/references/consumer-adapters.md`

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L3395)
- Kind: mechanical
- Finding: Confirmed deterministic drift: new link styling depended on migration-only alias --accent. Fixed in place by using the canonical semantic token.
- Remediation: Use var(--oc-accent-primary) for accent-colored links instead of var(--accent).
- Contract: `openclaw-design-system/references/tokens.md; openclaw-design-system/references/consumer-adapters.md`
