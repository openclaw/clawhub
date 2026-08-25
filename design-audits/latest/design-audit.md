# ClawHub design audit

- Carapace: `v0.6.1`
- ClawHub commit: `85865573e9e6e26bc0dc59fdeab20587024d3015`
- Comparison base: `4117154ecac49bd054026f1cf6ae4278b6eff72a`
- Generated: 2026-08-25T19:25:20.268Z
- Validation: passed

## Summary

- Errors: 0
- Warnings: 22
- Informational: 1
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

- Evidence: [src/styles.css](../../src/styles.css#L11000)
- Kind: mechanical
- Finding: New code depends on migration-only alias --ink.
- Remediation: Use the equivalent canonical --oc-* semantic token.
- Contract: `openclaw-design-system/references/consumer-adapters.md`

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L11000)
- Kind: mechanical
- Finding: Confirmed pre-fix: new code used migration-only alias --ink for skill evaluation heading text. Fixed to var(--oc-text-primary).
- Remediation: Use canonical semantic text tokens for new code.
- Contract: `openclaw-design-system/references/tokens.md`

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L11007)
- Kind: mechanical
- Finding: New code depends on migration-only alias --ink-soft.
- Remediation: Use the equivalent canonical --oc-* semantic token.
- Contract: `openclaw-design-system/references/consumer-adapters.md`

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L11007)
- Kind: mechanical
- Finding: Confirmed pre-fix: new code used migration-only alias --ink-soft for skill evaluation body text. Fixed to var(--oc-text-secondary).
- Remediation: Use canonical semantic text tokens for new code.
- Contract: `openclaw-design-system/references/tokens.md`

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L11022)
- Kind: mechanical
- Finding: New code depends on migration-only alias --ink.
- Remediation: Use the equivalent canonical --oc-* semantic token.
- Contract: `openclaw-design-system/references/consumer-adapters.md`

18 additional non-error findings are retained in JSON.
