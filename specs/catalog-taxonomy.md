# Catalog Taxonomy Contract

## Categories

- Skills and plugins use separate controlled slug registries from `clawhub-schema`.
- Category slugs name one concept. Plugin categories mirror contribution slots; skill categories
  describe user intent.
- Each item stores up to three category slugs. Unknown slugs are rejected.
- `other` is a fallback and is removed whenever a specific category is present.
- Category selection precedence:
  1. Current publish input from CLI or UI.
  2. Existing stored categories.
  3. `other`.
- Omitted or empty categories mean `other`; categories are never inferred implicitly.
- Generate is an explicit author action that fills editable category selections. Generated skill
  suggestions use title, summary, and slug. Generated plugin suggestions use manifest contribution
  fields.
- Generated suggestions only emit controlled slugs and are not persisted until Save or Publish.
- Metadata files are not author-facing taxonomy declaration sources. Plugin manifests are only used
  when an author explicitly generates plugin category suggestions.
- Backports and non-latest plugin releases do not replace current categories.
- Capability tags are not taxonomy inputs.
- Existing items without valid stored categories remain in `other` until an author or operator
  explicitly accepts generated or manually selected categories.
- `categories` is the single canonical source for detail, settings, profile, API, and discovery
  reads.
- The one-time classifier backfill may seed `categories` only when a publisher has never supplied
  the field. Once seeded, publishers own the values and may replace them through UI settings or a
  latest CLI publish. Explicit catalog flags publish an automatic patch version even when artifact
  files are unchanged. Explicitly clearing categories saves canonical `other`.

## Topics

- Authors may supply up to five topics through CLI or UI publish and edit surfaces.
- Stored topics preserve author-facing labels. Lookup uses normalized topic slugs.
- Reserved platform trust labels such as `official`, `officials`, `featured`, `verified`,
  `trusted`, `curated`, and brand or channel slugs such as `openclaw`, `clawhub`, and `community`
  are rejected. The canonical list lives in `RESERVED_CATALOG_TOPIC_SLUGS` inside
  `clawhub-schema`.
- Topics are separate from release tags and remain available to search.
- Browse sidebars do not enumerate the global topic space because it is open-ended and
  author-facing labels may use different casing. Selecting a category reveals at most five
  normalized top-topic chips from a bounded sample of that category's highest-ranked public items.
  Exact normalized topic browse links remain supported.
- Authors can edit categories and topics from skill and plugin settings.
- Settings expose Generate as an explicit category action. Clearing categories saves `other`.
- Backports and non-latest plugin releases do not replace current topics.
- `topics` is the single canonical source for detail, settings, profile, API, and discovery reads.
- The one-time classifier backfill may seed `topics` only when a publisher has never supplied the
  field. Once seeded, publishers own the values and may edit or explicitly clear them.
- Saving catalog metadata or promoting a latest UI/CLI publish clears category and topic inference
  compatibility state so an old backfill cannot reappear after a publisher edit or explicit clear.
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

## Follow-Up

Corpus classification was a one-time operator-run phase:

- `taxonomy-prototype-v9` classifies categories and `topic-prototype-v1` classifies zero to five
  topics from bounded static artifact evidence. The plugin lane covers code and bundle plugins only;
  runtime plugin code is never imported or executed.
- Classification writes bounded preview rows to `catalogClassificationResults`. Preview generation
  never changes skill/package taxonomy or search digests.
- Explicit author categories/topics always win. Explicit empty arrays remain authoritative.
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
