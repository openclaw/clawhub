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
- The one-time package and skill catalog digest migrations completed during the production rollout.
  No catalog taxonomy migration remains in the backend deploy checklist.

## Topics

- Authors may supply up to five topics through CLI or UI publish and edit surfaces.
- Stored topics preserve author-facing labels. Lookup uses normalized topic slugs.
- Reserved platform trust labels such as `official`, `featured`, and `verified` are rejected.
- Topics are separate from release tags and are available to browse and exact-topic global search.
- Authors can edit categories and topics from skill and plugin settings.
- Settings expose Generate as an explicit category action. Clearing categories saves `other`.
- Backports and non-latest plugin releases do not replace current topics.

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

Corpus classification is a separate operator-run phase from digest projection:

- `taxonomy-prototype-v9` classifies categories and `topic-prototype-v1` classifies zero to five
  topics from bounded static artifact evidence. The plugin lane covers code and bundle plugins only;
  runtime plugin code is never imported or executed.
- Classification writes bounded preview rows to `catalogClassificationResults`. Preview generation
  never changes skill/package taxonomy or search digests.
- Explicit author categories/topics always win. Explicit empty arrays remain authoritative.
- Applied inferred values remain separate in `inferredCategories` and `inferredTopics`. They are
  eligible for discovery only while their recorded source version/release is still latest.
- The preview runner is cursor-batched and resumable. It uses an action instead of
  `@convex-dev/migrations` because it must read immutable storage blobs; the source-changing apply
  phase uses the migrations component.
- High- and medium-confidence rollout apply was a one-time production migration. The temporary
  apply migrations and operator wrappers were removed after the verified rollout completed.
