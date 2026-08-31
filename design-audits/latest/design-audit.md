# ClawHub design audit

- Carapace: `v0.6.1`
- ClawHub commit: `20c3b2f0ff4cba6437eb1d0f91c1e00765b6470b`
- Comparison base: `fb0ef1d21eab78ad2b9da69f48045d7747cc73c1`
- Generated: 2026-08-31T15:44:06.443Z
- Validation: passed

## Summary

- Errors: 1
- Warnings: 1
- Informational: 0
- Safe source fixes: 2

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

### ERROR: `theme/parity`

- Evidence: [src/design-system.css](../../src/design-system.css#L4)
- Kind: mechanical
- Finding: Focused Carapace imports were not in the documented consumer-adapter order: `themes/product.css` loaded before `components.css`, which could let component defaults override product theme values. Fixed by loading `components.css` before `themes/product.css`.
- Remediation: Keep the import order as tokens, themes, typography, components, product theme, then ClawHub compat.
- Contract: `artifacts/design-audit/design-system/openclaw-design-system/references/consumer-adapters.md:23`

### WARNING: `component/state`

- Evidence: [src/styles.css](../../src/styles.css#L29962)
- Kind: mechanical
- Finding: On mobile `/plugins` and `/skills`, the shared `.clawhub-segmented` rule restored `display: inline-flex` after the earlier mobile `.browse-view-toggle` hide rule, so the List/Grid control appeared even though mobile results force `effectiveView` to `list` in `src/routes/plugins/index.tsx:400` and `src/routes/skills/-SkillsResults.tsx:228`. Fixed with a later scoped mobile override.
- Remediation: Added `.browse-page .browse-view-toggle { display: none; }` at `src/styles.css:30059` so mobile does not show a selected layout control that cannot affect the rendered layout.
- Contract: `artifacts/design-audit/design-system/openclaw-design-audit/references/rubric.md:11`
