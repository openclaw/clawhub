# ClawHub design audit

- Design system: `v0.0.3`
- ClawHub commit: `274c5b71ef2abef87dcf7442a086629a6ea71992`
- Comparison base: `735e1c4d`
- Generated: 2026-07-08T23:59:54.797Z
- Validation: passed

## Summary

- Errors: 0
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

### WARNING: `layout/overflow`

- Evidence: [src/styles.css](../../src/styles.css#L29470)
- Kind: mechanical
- Finding: Mobile /skills used the shared equal-width browse-tab rule with min-width: 0; in the supplied light/dark mobile screenshots, “Most starred” visually runs into “Featured”.
- Remediation: Fixed by adding a skills-browse-page route class and route-scoped mobile CSS so skills tabs size to their content within the existing horizontal-scroll tab strip.
- Contract: `openclaw-design-audit/references/rubric.md layout/overflow; openclaw-marketing-pages/references/page-patterns.md Responsive Checks`
