# ClawHub design audit

- Carapace: `v0.6.1`
- ClawHub commit: `56e7ee8aaef8a0e180f906fd7bf194dd1b03bc45`
- Comparison base: `52358852d3510f1150756d48e8a72cb8c8e698e0`
- Generated: 2026-11-02T15:43:01.032Z
- Validation: passed

## Summary

- Errors: 3
- Warnings: 9
- Informational: 2
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

### ERROR: `a11y/focus`

- Evidence: [src/components/BrowseControls.tsx](../../src/components/BrowseControls.tsx#L120)
- Kind: mechanical
- Finding: Selecting a sort option removes the focused button without restoring focus. DOM simulation confirmed focus falls to BODY.
- Remediation: Restore focus to the sort trigger after selection or keyboard dismissal; consider the established local Select primitive.
- Contract: `openclaw-design-audit/references/rubric.md`

### ERROR: `a11y/focus`

- Evidence: [src/components/BrowseControls.tsx](../../src/components/BrowseControls.tsx#L423)
- Kind: mechanical
- Finding: Closing the category picker removes its focused search field without restoring focus. DOM simulation confirmed Escape leaves focus on BODY.
- Remediation: Restore trigger focus after keyboard dismissal and selection while preserving outside-click focus behavior.
- Contract: `openclaw-design-audit/references/rubric.md`

### ERROR: `a11y/semantics`

- Evidence: [src/components/BrowseControls.tsx](../../src/components/BrowseControls.tsx#L466)
- Kind: mechanical
- Finding: The category combobox announces a listbox popup, but its controlled element uses role="radiogroup" at line 508.
- Remediation: Use a consistent accessible popup pattern with matching roles and keyboard behavior.
- Contract: `openclaw-design-audit/references/rubric.md`

### WARNING: `component/state`

- Evidence: [src/styles.css](../../src/styles.css#L24774)
- Kind: judgment
- Finding: Mobile footer links animate indefinitely inside a clipped strip without a pause control or pause on keyboard focus. Only reduced-motion preferences stop the animation.
- Remediation: Review a static scrollable presentation or provide a pause mechanism and stable keyboard targets.
- Contract: `openclaw-marketing-pages/SKILL.md`

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L2226)
- Kind: mechanical
- Finding: New code depends on migration-only alias --ink-soft.
- Remediation: Use the equivalent canonical --oc-* semantic token.
- Contract: `openclaw-design-system/references/consumer-adapters.md`

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L2241)
- Kind: mechanical
- Finding: New code depends on migration-only alias --ink.
- Remediation: Use the equivalent canonical --oc-* semantic token.
- Contract: `openclaw-design-system/references/consumer-adapters.md`

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L2247)
- Kind: mechanical
- Finding: New code depends on migration-only alias --ink-soft.
- Remediation: Use the equivalent canonical --oc-* semantic token.
- Contract: `openclaw-design-system/references/consumer-adapters.md`

### WARNING: `token/legacy-alias`

- Evidence: [src/styles.css](../../src/styles.css#L2286)
- Kind: mechanical
- Finding: New code depends on migration-only alias --line.
- Remediation: Use the equivalent canonical --oc-* semantic token.
- Contract: `openclaw-design-system/references/consumer-adapters.md`

6 additional non-error findings are retained in JSON.
