# Production sample category rehearsal

The real ClawHub UI, exact-version API, and bundled-category migration pass against a bounded production sample. **The real model lane is still pending credential access:** 59 model-dependent previews were marked failed and rejected for acceptance. One older package (`gog-extended`) has no readable bounded manifest and was explicitly skipped. This is partial end-to-end proof, not approval to run the production backfill.

## Data and isolation

Captured **100 public production plugins, 190 releases (latest plus one older where available), and 365 SHA-256-verified manifest/documentation files**, 8.69 MB, between **2026-09-09 02:48:41 and 02:51:29 UTC**. The sample includes 40 matched bundled packages, 20 legacy Tools, 20 legacy Other, and 20 additional capability examples. Native local Convex import succeeded with original package/release/publisher/storage identities and captured release metadata preserved. User profiles are synthetic; package/publisher creation timestamps were reconstructed from public metadata. Unselected tag references and unrelated upload-attempt references were omitted.

This is a per-record public logical snapshot, not a globally atomic raw database export. It contains no production authentication, scheduled jobs, or private user state. Unneeded package code/archive bytes were not downloaded. It proves the category path for this sample, not arbitrary plugin execution or every production record. All mutations ran only on disposable local Convex (`127.0.0.1:3320`, HTTP `3321`). Production was read-only.

## Verified behavior

- Restored 100 plugin category projections and all 190 captured releases; rebuilt all 100 search digests.
- Previewed 99 eligible packages. Reviewed and applied **40 bundled assignments**, including **34 changed category values**, through the real migrations component in batches of 10.
- The real migration dry run preserved all 190 exact-version responses. Attempting to accept a failed model classification was rejected.
- After application: all **100 package projections, 100 search digests, and 169 category-index rows** agree with expected categories. All **190 public exact-version API responses** match backend reads, and all **19 populated category filters**, including retired slugs, return exactly the expected sample names.
- All **90 historical releases** and **60 nonaccepted latest releases** remain unchanged. Bundled source artifacts, integrity hashes, scan state, and unrelated package/release metadata remain unchanged.
- Guarded rollback restored **all 100 package documents and all 190 release documents exactly**, including the exact-version API baseline.
- The full source/build audit checks **152 source manifests**, **149 named inventory matches**, and **150 packaged manifests**. Two private QA manifests are intentionally not packaged; three manifests lack source package names and are excluded from the registry-match inventory.

## Real UI comparison

Both ClawHub lanes use code `c95ea77450`, the same fixed sample, Chromium, dark theme, anonymous auth, and the same interaction sequence. The before lane retains production categories; the after lane applies the 40 accepted bundled assignments. Desktop viewport is 1440×1080; mobile is 390×844. Every published image was inspected after capture.

| Filter | Before | After |
| --- | ---: | ---: |
| Developer tools | 0 | 6 |
| Documents & files | 0 | 2 |
| Inbox & collaboration, mobile | 0 | 11 |

Routes: `http://127.0.0.1:4320/plugins?category=developer-tools`, `?category=documents-files`, and `?category=inbox-collaboration`. The screenshots demonstrate the new category icons, selectable categories, populated results, and preserved empty state. Loading/error/disabled UI are unchanged by this metadata rehearsal and are not claimed by these comparisons; earlier taxonomy PR proof remains separate.

## Fix found during rehearsal

Explicit categories in a published bundled manifest could be overwritten by the newer pinned source inventory. Commit `4a1f8bd8d0` preserves the published declaration first. Two regression cases failed before the fix; the resulting 7-case runtime suite and full 6,508-test unit suite pass. Autoreview reports no findings; TypeScript, formatting, lint, peer checks, dead-code checks, and workflow-pin checks pass. The complete `ci:static` command still stops on seven unchanged dependency audit advisories, reproduced on the baseline.

## Reproduce the category operations

On a disposable local deployment seeded with the same public metadata and bounded files:

1. Rebuild projections with `maintenance:resyncPluginCatalogMetadataDigestsInternal` (local apply confirmation `resync-plugin-catalog-metadata-digests`).
2. Run `pluginCategoryRefresh:preview` with a new run ID and batch size 10, continuing each returned cursor. Inspect `pluginCategoryRefresh:list`; fallback rows cannot be accepted.
3. Accept reviewed IDs with `pluginCategoryRefresh:accept` and confirmation `apply-plugin-category-refresh`.
4. Dry run `migrations:applyAcceptedPluginCategoryRefreshes`, then run it through `migrations:run`; reset the completed migration cursor when beginning a fresh accepted wave.
5. Compare package metadata, `POST /api/v1/packages/categories:batch`, and `GET /api/v1/plugins?category=...`; verify historical releases remain unchanged.
6. Exercise `pluginCategoryRefresh:rollback` with confirmation `rollback-plugin-category-refresh`, then preview and apply a fresh run.

The original sample digest, full 40-row category diff, API filter counts, and verification flags are included in `summary.json`. Raw production records and credential/device diagnostics are intentionally not published.

Fresh-preview rerun also passed: 40 assignments reapplied; repeating the completed migration was a no-op and the 190 exact-version responses matched the first successful application.
