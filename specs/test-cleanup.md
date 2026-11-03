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

Retain `fixtures/public-corpus/validation_report.json` as historical redaction-review
evidence from https://github.com/openclaw/clawhub/pull/2226. It records validation
and review samples for the original public seed; it is not a runtime fixture or
fresh validation proof.

## Changes

### CLI package coverage

Replace the trusted-publisher case that read its own test file and split on a
retired admin-package import. The built CLI artifact test now executes public
`package trusted-publisher set` and `delete` against a local registry stub and
checks authenticated requests, encoded package paths, option payloads, and JSON
output. This proves command registration and dispatch, not backend authorization.
Keep the existing command-function tests for set/delete behavior.

Remove the duplicate standalone-template-validator parity case from
`templateContracts.test.ts`. Retain the two source-copy checks in
`templateConformance.test.ts`, which resolve files from the repository root.

Validation: Crabbox passed both schema suites, `ci:packages` (including the built
CLI artifact suite), `ci:static`, and `ci:types:packages`. Independent P0-P3 diff
review: scoped-clean. `ci:unit` passed 8,806 tests in 653 files, with coverage
thresholds met. Base: `d677ce37`. Landing: pending PR.

Queued CI audit: publish lifecycle greps omit three security cases. Check matrix
coverage for `exact-template-artifact`, `template-official-boundary`,
`publisher-create-owner`, `skill-presentation-metadata`, and `featured-lineup`.
Also review the retired mobile grid assertion and public-plugin API-failure skips.

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
diff review: scoped-clean. Landed: https://github.com/openclaw/clawhub/pull/4250.

### Old CLI compatibility e2e

Removed `e2e/cli-publish-compat.e2e.test.ts` and its generated fetch shim. It ran
the released CLI against a fabricated HTTP 200, so it could not verify server
compatibility. The retained local-auth old-CLI test publishes through real local
Convex, checks that uploads stay private, and requires both security checks before
public visibility. It runs in the dedicated `old-cli-publish` CI shard, which
passed on PR #4250 before this deletion. No runner references or shared helpers
become unused.

Validation: Crabbox passed `ci:static`, `ci:e2e-http`, `ci:types:packages`, and
`ci:unit` (652 files, 8,787 tests) on base `24341db1` plus this patch. Discovery
confirms the deleted suite is absent. Independent P0-P3 diff review: scoped-clean.
Landed: https://github.com/openclaw/clawhub/pull/4256.

### Route assertion coverage

Await the canonical skill route's guard for all five accepted owner formats and
require the handler to exist. The old synchronous `not.toThrow()` assertions only
observed promise creation. Keep both invalid-scope rejection cases.

Remove the obsolete default-sort suite: its helper discarded the hook result and
accepted a missing hook, while inputs bypassed search validation. Retain current
browse/search ordering tests and category-browse cases covering retired filter URLs.
Remove the second identical package-topic hero test; keep the first with the same
fixture reset and assertions.

Validation: all 141 focused tests passed in Crabbox. Removing the guard made all
four old positive cases pass and all five corrected cases fail; the route was
restored before validation. `ci:static` and `ci:types:packages` passed. Independent
P0-P3 diff review: scoped-clean. `ci:unit` passed 8,796 tests in 651 files
(plus one skipped file and five skipped cases), with coverage thresholds met.
Base: `0c83d0e7`. Landed: https://github.com/openclaw/clawhub/pull/4261.

### Script behavior contracts

Removed the undiscovered `run-codex-scan-worker.source-test.mjs`, whose shared
per-root deadline assertions contradict current behavior. Keep the real
multi-root subprocess timeout and total preparation ceiling tests.

Move design-audit sandbox/network assertions from source spelling into the actual
CLI argument builder tests, for default and explicit model settings. This checks
emitted arguments and accepts harmless source formatting changes.

Validation: all 18 focused/subprocess tests passed in Crabbox. A temporary network
opt-in with whitespace passed the old source check and failed both new builder
cases; the source was restored and both design-audit suites passed again.
`ci:static` and `ci:types:packages` passed. Independent P0-P3 diff review:
scoped-clean. After the byte-identical patch was restacked onto `ef634eac`, Crabbox
passed all 18 focused tests, `ci:static`, `ci:types:packages`, and `ci:unit`
(652 files, 8,800 tests; coverage thresholds met). Landing: pending PR.

## Next slices

- Deduplicate template validator parity checks and inspect CLI test self-inspection.
  Admin CLI duplicate runner execution was already fixed in
  https://github.com/openclaw/clawhub/pull/4244.
- Remove exact duplicate bodies in `moderationEngine.test.ts` (VT suspicious
  authority) and `promotions.test.ts` (ended before launch). Keep the first case
  and the distinct promotion-after-scheduled-start case.
- Inspect retired `listPublicPage`/V2 endpoint contracts before removing their
  stub-only suites; preserve V3 compatibility without runtime usage evidence.
