# ClawHub design audit

- Carapace: `v0.6.1`
- ClawHub commit: `b0e34a98cd56581f770989ef3713455a0e00fd87`
- Comparison base: `ff6c118c132ae89b5351739cc45fe9227ff1574e`
- Generated: 2026-09-28T15:44:06.480Z
- Validation: passed

## Summary

- Errors: 0
- Warnings: 14
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

- Evidence: [src/styles.css](../../src/styles.css#L2287)
- Kind: mechanical
- Finding: New code depends on migration-only alias --ink-soft.
- Remediation: Use the equivalent canonical --oc-* semantic token.
- Contract: `openclaw-design-system/references/consumer-adapters.md`

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L2287)
- Kind: mechanical
- Finding: Confirmed fixed: `.skill-spector-evidence-meta` no longer depends on migration-only alias `--ink-soft`.
- Remediation: Replaced with canonical `var(--oc-text-secondary)`.
- Contract: `openclaw-design-system/references/tokens.md; openclaw-design-system/references/consumer-adapters.md`

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L2306)
- Kind: mechanical
- Finding: New code depends on migration-only alias --ink-soft.
- Remediation: Use the equivalent canonical --oc-* semantic token.
- Contract: `openclaw-design-system/references/consumer-adapters.md`

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L2306)
- Kind: mechanical
- Finding: Confirmed fixed: `.aig-finding-location` no longer depends on migration-only alias `--ink-soft`.
- Remediation: Replaced with canonical `var(--oc-text-secondary)`.
- Contract: `openclaw-design-system/references/tokens.md; openclaw-design-system/references/consumer-adapters.md`

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L2317)
- Kind: mechanical
- Finding: New code depends on migration-only alias --ink.
- Remediation: Use the equivalent canonical --oc-* semantic token.
- Contract: `openclaw-design-system/references/consumer-adapters.md`

9 additional non-error findings are retained in JSON.
