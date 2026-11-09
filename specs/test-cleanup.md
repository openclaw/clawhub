# Test cleanup ledger

Remove dead, duplicated, disconnected, and source-spelling assertions. Preserve
unique regressions and prove replacements against real behavior. No production
release is part of this cleanup.

## Audit scope

Baseline `16135e6b`: 735 test files — 313 Convex, 169 app, 126 scripts,
64 packages, 38 e2e, 21 server, and four elsewhere. Whole-tree inventory,
normalized callback comparison, assertion-oracle checks, fixture consumers, and
CI discovery informed the focused behavioral work below. This is not a claim
that every test received manual behavioral review.

The normalized callback scan covered 738 files and 7,878 callbacks. Five duplicate
groups were classified: two backend duplicates removed, one worker helper copy
consolidated, and two cross-file schema matches retained for separate copied
implementations. The subsequent oracle scan covered 7,880 callbacks: no empty
cases; four without direct assertions invoke the publication fixture helper,
which checks HTTP status, exact response content, and keys.

## Completed slices

Each code slice passed focused checks, `ci:static`, full `ci:unit` coverage,
native package typechecks, and scoped independent review. Runtime/build changes
also passed the matching type/build gate. Counts below record frozen task runs;
unrelated merges change suite totals.

| Slice                   | Change and useful proof                                                                                                                                                                                                                        | PR                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| UI source contracts     | Remove three spelling checks and six unused readers; retain 19 distinct contracts. 90 focused checks.                                                                                                                                          | https://github.com/openclaw/clawhub/pull/4250 |
| Old CLI compatibility   | Delete the fabricated HTTP-200 fetch shim; retain real local-auth upload/scanner privacy coverage. Secretless HTTP gate passed.                                                                                                                | https://github.com/openclaw/clawhub/pull/4256 |
| Route assertions        | Await all five accepted owner guards; remove a vacuous sort suite and duplicate topic case. Deleting the guard passed old positives and failed all five replacements.                                                                          | https://github.com/openclaw/clawhub/pull/4261 |
| Script contracts        | Delete an undiscovered obsolete worker source test. Assert actual sandbox/network arguments; a whitespace-obscured network opt-in escaped the old check and failed the replacements.                                                           | https://github.com/openclaw/clawhub/pull/4269 |
| CLI/schema overlap      | Execute trusted-publisher set/delete through the built CLI and a real HTTP stub. Remove duplicate template parity; retain source-copy conformance. Package gate passed.                                                                        | https://github.com/openclaw/clawhub/pull/4276 |
| Backend contracts       | Remove duplicate VT/promotion cases. Replace audit-log regexes with four actual helper payload checks. Wrong audit actions passed old checks and failed all replacements; 227 focused checks passed after restoration.                         | https://github.com/openclaw/clawhub/pull/4287 |
| Local-auth CI mapping   | Map five omitted specs and three omitted lifecycle cases. Real Playwright discovery guards file/test selection, including parameterized titles; 28 focused checks and real browser groups passed.                                              | https://github.com/openclaw/clawhub/pull/4286 |
| Responsive header       | Replace two CSS-string checks with actual desktop/mobile visibility, bounds, menu, and profile navigation. Both browser viewports and 26 retained unit cases passed.                                                                           | https://github.com/openclaw/clawhub/pull/4290 |
| Worker admission        | Consolidate helper coverage; run both real denied entrypoints with isolated environments and a loopback backend. Removing admission left five helper cases green and failed both subprocess cases. 77 focused and 8,858 coverage cases passed. | https://github.com/openclaw/clawhub/pull/4298 |
| Search cancellation     | Browser proof exposed expected aborts logged as failures. Propagate cancellation and retain genuine-error fallback; the old implementation fails the new cancellation regression. 8,859 coverage cases passed.                                 | https://github.com/openclaw/clawhub/pull/4300 |
| Optional heading counts | Preserve catalog rows when cosmetic counts fail. Two real Convex-hook regressions catch the render loop and verify reactive recovery; 168 focused cases and exact-head full CI passed.                                                         | https://github.com/openclaw/clawhub/pull/4312 |

## Catalog/mobile browser slice

Replace retired Grid, search-toggle, suspicious-checkbox, and mobile-sidebar
assumptions with current list/category/search controls. Remove the duplicate
obsolete grid-width case; retain document overflow. Click archive tabs and check
selected state plus visible panels. Select actual skill anchors and accessible
plugin links, rather than skeletons or incorrect element tags.

Replace the arbitrary public-plugin versions case, which skipped API failures and
accepted unavailable history, with the named local scanned release. Require API
identity, its version row, and the actual changelog. Seed catalog fixtures once
before browser readers, then preflight the actual Skills browse query through
the existing bounded readiness check. Repeated nonreset seeding can replace a
shared blob and leave another fixture referencing deleted storage.

Map the retained catalog flows to desktop and mobile Chrome CI, with a named
archive fixture and the existing eight-job concurrency limit. Validate every
mapped path while retaining complete local-auth discovery.

Validation: 28 focused configuration/selection cases, `ci:static`, root types,
full `ci:types-build`, and `ci:unit` passed (655 files, 8,857 tests; coverage met).
Independent P0–P3 review passed. Real local browser checks at
`http://127.0.0.1:4173` passed eight mobile cases and six desktop cases with
retries disabled. The remaining desktop Skills case exposed a cold local UDF
timeout; it passed without retries after the setup preflight. Its assertions
remain strict. The named `local-agentic-risk-demo` skill and
`local-scanned-runtime-plugin` release supply repeatable state. The actual
release-history screenshot is attached to the Playwright report.

## Deliberate keeps and boundaries

- V1/V2 listing-stub suites preserve different legacy response shapes and zero DB
  reads. V3 remains an explicit subscriber bridge to V4.
- Mocked moderation payload tests prove helper behavior, not global append-only
  storage or Convex transaction semantics. Retain real runtime coverage.
- `fixtures/public-corpus/validation_report.json` is historical redaction-review
  evidence from https://github.com/openclaw/clawhub/pull/2226, not a live fixture
  or fresh validation claim.
- Keep explicit local-auth, production credentials, external-service, dedicated
  skills.sh deployment, and scheduled live-sync gates. Missing optional access
  does not justify deleting their coverage or widening this task.
- The pre-existing Skill Card fixture clock race was independently fixed in
  https://github.com/openclaw/clawhub/pull/4292; the redundant alternative
  https://github.com/openclaw/clawhub/pull/4294 was closed without replacing it.
- Vercel preview failures were recorded separately; code/test/security checks
  passed for landed slices. No production deploy or CLI release was run.
