# Catalog Taxonomy Contract

## Categories

- Skills and plugins use separate controlled slug registries from `clawhub-schema`.
- Category slugs name one concept. Plugin categories combine seven core configuration surfaces
  (Channels, Models, Agent runtimes, Memory, Context, Voice, Web) with product uses and capabilities.
- The remaining active plugin categories are Media, Security, Integrations, Developer tools,
  Infrastructure, Documents & files, Inbox & collaboration, Productivity, Scheduling,
  Finance & payments, Sales & marketing, Data & analytics, Agent orchestration, Research, and Other.
- Tools, Runtime, and Gateway remain accepted for published metadata and old links, but are absent
  from the active browse registry. Compatibility never maps all Tools plugins to Integrations.
- Skills store up to three category slugs. Unknown slugs are rejected, and `other` is removed when
  a specific skill category is present.
- New plugin releases may declare `categories` in `openclaw.plugin.json`. When present, the array
  contains exactly one controlled slug describing the primary reason to install the plugin.
  Generated assignments and bundled manifests also contain exactly one category. Readers and the
  refresh preserve actual one-to-three-category declarations in previously published artifacts.
- The active registry has 22 categories. `agent-runtimes` uses the `bot` icon after Models. It covers
  execution engines and backends that run the agent loop and manage native sessions. Context
  covers active-context assembly and compaction; Agent orchestration covers coordination and
  delegation. Session mirroring or locks alone do not make a plugin an execution engine.
  Legacy `runtime` remains readable and is not automatically mapped to Agent runtimes.
- Plugin category precedence is package declaration, then ClawHub model classification,
  then `other`. Omission is accepted. Invalid declarations reject publication instead of falling
  through to inference.
- Each plugin release stores the effective categories for that exact package version. A promoted
  latest release also updates the package-level categories used by browse, search, and filters.
- Plugin categories are package-owned and are not editable in ClawHub publish or settings UI.
  Publishers change them by publishing a new package version.
- Backports and non-latest plugin releases do not replace current categories.
- Capability tags are not taxonomy inputs.
- A reviewed one-time refresh covers only each plugin's latest published release and package
  projection. Older releases are unchanged; exact-version lookup remains null for historical
  releases without stored category metadata.
- Package-level `categories` is the canonical latest-version source for detail, profile, API, and
  discovery reads. Release-level manifest summaries are the canonical exact-version source.

## Topics

- Authors may supply up to five topics through CLI or UI publish and edit surfaces.
- UI topic inputs commit new values as normalized lowercase hyphenated slugs so saved metadata
  matches browse URLs. Existing stored labels remain unchanged until an author replaces them.
  Lookup always uses normalized topic slugs.
- Reserved platform trust labels such as `official`, `officials`, `featured`, `verified`,
  `trusted`, `curated`, and brand or channel slugs such as `openclaw`, `clawhub`, and `community`
  are rejected. The canonical list lives in `RESERVED_CATALOG_TOPIC_SLUGS` inside
  `clawhub-schema`.
- Topics are separate from release tags and remain available to search.
- Browse sidebars do not enumerate the global topic space because it is open-ended and
  author-facing labels may use different casing. Selecting a category reveals at most five
  normalized top-topic chips from a bounded sample of that category's highest-ranked public items.
  Exact normalized topic browse links remain supported.
- Authors can edit skill categories and topics from skill settings. Plugin settings expose topics
  only; plugin categories come from `openclaw.plugin.json`.
- Skill settings expose Generate as an explicit category action. Clearing skill categories saves
  `other`.
- Backports and non-latest plugin releases do not replace current topics.
- `topics` is the single canonical source for detail, settings, profile, API, and discovery reads.
- The one-time classifier backfill may seed `topics` only when a publisher has never supplied the
  field. Once seeded, publishers own the values and may edit or explicitly clear them.
- Saving catalog metadata clears the corresponding editable inference compatibility state so an old
  backfill cannot reappear after a publisher edit or explicit clear.
- Future generated topic suggestions must remain non-canonical until a publisher or operator
  explicitly accepts them.

## Browse

- Skill and plugin browse paths remain separate.
- Public v1 plugin read endpoints accept the retired documented filter slugs as aliases to their
  closest controlled categories. These compatibility aliases never become stored or author-facing
  taxonomy values.
- Category browse places official or curated entries before community entries.
- Skill category browse paginates an indexed curated projection before community results; it does
  not cap the curated corpus or hydrate curated entries outside the requested page.
- Category and topic filters use per-value digest rows that preserve the selected browse sort.
- Publisher profiles group authored items by their first topic when multiple groups exist.
- Existing plugin category digest rows are repaired through a dry-run-first, cursor-batched admin
  action. This intentionally uses the existing maintenance runner pattern instead of
  `@convex-dev/migrations` because it only rebuilds derived search rows from unchanged package
  sources; apply mode still requires explicit confirmation and reports resumable progress.

## Exact-version plugin category lookup

- `POST /api/v1/packages/categories:batch` accepts up to 200 `{ name, version }` identities.
- Results preserve request order and duplicates. Each result repeats the identity and returns the
  stored exact-version category array, or `null` when the package/version is unknown, private,
  unpublished, or predates release-level category storage.
- The endpoint does not derive or backfill metadata at request time.

## Follow-Up

The product-category refresh uses the same bounded static-evidence classifier as publication.
It never executes plugin code, imports another marketplace, or filters by license. Explicit
manifest declarations win; canonical database categories alone do not establish authorship.
Failed model requests produce an observable Other fallback and do not reject valid publication.

`pluginCategoryRefreshes` retains separate review runs with before/after category state. The
preview action handles one bounded page and returns a resume cursor. Repeating a run never
replaces its rows. Accept only inspected row IDs; failed classifications must be refreshed before
acceptance. The migrations component applies accepted rows, checking release identity, artifact
evidence, and both package/release category state again. Category indexes change in the same
transaction. Guarded rollback refuses to overwrite state changed after apply.

Bundled assignments are pinned to a reviewed OpenClaw inventory. Registry matching requires the
exact package name, manifest plugin ID, OpenClaw source repository, and the OpenClaw organization
publisher. Matching latest registry entries receive reviewed category metadata without modifying
archived source bytes. Missing package identity is not guessed. This is independent of the
registry's `bundle-plugin` package format.

Production sequence: deploy compatible readers, update bundled declarations and publication,
generate and inspect a new preview, then explicitly accept and apply the selected rows. Keep run
IDs and verification evidence; remove one-off apply tooling only after verified production
completion. The retained journal is the audit/rollback record.

Operator entry points (run only against the deliberately selected deployment):

- `pluginCategoryRefresh:preview {"runId":"plugin-single-category-v3-prod","batchSize":10}` returns
  a cursor and bounded skip/failure diagnostics. Pass each returned cursor to the next call;
  pause between calls. `pluginCategoryRefresh:list` lists that run with normal pagination.
- `pluginCategoryRefresh:accept` accepts at most 100 inspected row IDs with
  `confirm: "apply-plugin-category-refresh"`. Accept a small pilot first, then small waves;
  verify browse results and pause between waves to limit reactive traffic.
- `migrations:applyAcceptedPluginCategoryRefreshes {"dryRun":true}` rehearses one batch
  without persisting changes. `migrations:run` with
  `fn: "migrations:applyAcceptedPluginCategoryRefreshes"` applies accepted rows in batches
  of ten. Use the component's reset option when starting a new wave after completion;
  do not reset an in-progress cursor when resuming that wave.
- `pluginCategoryRefresh:rollback` accepts one applied journal ID with
  `confirm: "rollback-plugin-category-refresh"`. Preserve the journal and verification output.

Classification uses `OPENAI_API_KEY` and defaults to `gpt-5.6-luna`, with a dedicated
`OPENAI_PLUGIN_CATEGORY_MODEL` override independent of skill-summary configuration. The current
classifier revision is `plugin-single-category-v3`; superseded generated previews cannot be
accepted or applied. The model receives all 22 purpose definitions and must return exactly one
category. Missing credentials, timeouts, and
invalid output are recorded as failed fallback classifications. They cannot be accepted by the
backfill. Retry those packages under a new run ID after resolving the failure.

Corpus classification was a one-time operator-run phase:

- `taxonomy-prototype-v9` classifies categories and `topic-prototype-v1` classifies zero to five
  topics from bounded static artifact evidence. The plugin lane covers code and bundle plugins only;
  runtime plugin code is never imported or executed.
- Classification writes bounded preview rows to `catalogClassificationResults`. Preview generation
  never changes skill/package taxonomy or search digests.
- During this completed rollout, explicit author categories/topics won over generated preview data.
  Current plugin category ownership is defined in the Categories section above.
- Applied inferred categories and topics were bootstrap data only. The catalog metadata
  canonicalization migration copies current valid `inferredCategories` and `inferredTopics` into
  canonical fields only when the corresponding publisher field is absent, clears all inference
  metadata, and refreshes affected search digests.
- The migration skips promotion when a skill or package has a catalog-metadata audit record. That
  preserves publisher metadata edits and explicit topic clears that were historically stored as an
  absent `topics` field.
- The preview runner is cursor-batched and resumable. It uses an action instead of
  `@convex-dev/migrations` because it must read immutable storage blobs; the source-changing apply
  phase uses the migrations component.
- High- and medium-confidence rollout apply was a one-time production migration. The temporary
  apply migrations and operator wrappers were removed after the verified rollout completed.
- Remove the temporary catalog metadata canonicalization migration and the remaining inferred
  category/topic read/schema compatibility only after its production apply and migration-component
  status are verified.
