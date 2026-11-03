# Test cleanup ledger

Remove tests when their assertions are redundant, disconnected, or tied to source
spelling without proving behavior. Keep unique regression coverage. Validate each
slice before landing; production releases are outside this cleanup.

## Audit coverage

At baseline `16135e6b`, the repository contains 735 `*.test.*` files: 313 in
`convex`, 169 in `src`, 126 in `scripts`, 64 in `packages`, 38 in `e2e`, 21 in
`server`, and four elsewhere. This is an inventory, not a completed behavioral
audit. Remaining work includes backend mock/runtime coverage, CLI/schema overlap,
script contracts, fixture consumers, browser skip conditions, and HTTP e2e mappings.

## Changes

### Header/footer/theme source contracts

Removed three cases and six unused source readers from
`src/__tests__/ui-design-contract.test.ts`. They pinned JSX strings, helper
names, deleted filenames, and CSS formatting.

Retained coverage:

- `header.test.tsx`: navigation, theme controls, and responsive header CSS.
- `Footer.test.tsx`: rendered links and mobile section toggles.
- `theme.test.tsx`: legacy preference and cookie cleanup.
- `-settings.test.tsx`: supported appearance settings.
- Remaining design-contract cases: design, contrast, privacy, responsive rules.

Validation: Crabbox passed all 90 focused tests, `ci:static`, `ci:unit` coverage,
and `ci:types:packages` at baseline `16135e6b` plus this patch. Independent P0-P3
diff review: scoped-clean. Landing: pending PR.

## Next slices

- Remove the undiscovered `scripts/security/run-codex-scan-worker.source-
  test.mjs`: direct Node execution fails both obsolete shared-deadline
  assertions. Retain real subprocess budget tests in `run-codex-scan-worker-
  skillspector.test.ts`.
- Verify the real local-auth old-CLI publish flow, then remove `e2e/cli-publish-
  compat.e2e.test.ts`, which fabricates endpoint success through a fetch shim.
- Deduplicate template validator parity checks, inspect CLI test self-
  inspection, and separate admin package tests from duplicate root/package
  runner execution.
- Remove exact duplicate bodies in `moderationEngine.test.ts` (VT suspicious
  authority) and `promotions.test.ts` (ended before launch). Keep the first case
  and the distinct promotion-after-scheduled-start case.
- Inspect retired `listPublicPage`/V2 endpoint contracts before removing their
  stub-only suites; preserve V3 compatibility without runtime usage evidence.
- Review `fixtures/public-corpus/validation_report.json`: no literal consumer
  found; verify provenance before deleting an audit artifact.
