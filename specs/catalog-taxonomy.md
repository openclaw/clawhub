# Catalog Taxonomy Contract

ClawHub stores one correctable primary category on each skill and plugin package. Stored valid
categories are authoritative. Inference is a fallback for new or legacy records without a valid
stored category, never a reason to overwrite an author's or moderator's explicit choice.

## Categories

- Skills use the shared public skill taxonomy in `@clawhub/schema`.
- Plugins use the shared plugin taxonomy, including the dedicated `model-providers` category.
- Provider plugins must not be inferred as MCP tooling solely because they expose a provider.
- Records that cannot be classified use the internal `uncategorized` value. This value is not a
  public browse category.
- Author-supplied categories are validated at publish/import boundaries.
- Moderator category corrections update the source record and search digest together and create an
  audit log entry.
- Backports and non-latest package releases must not replace the current stored category.

## Author Topics

Topics are author-controlled, lightweight facets that remain separate from version/release tags.
They are normalized to lowercase hyphenated values, deduplicated in author order, and bounded by the
shared schema limits. Publish and import paths normalize topics before persistence.

- Topics appear on catalog cards and list rows.
- Topic filters require exact normalized matches.
- Package topic filters use a per-topic search digest so pagination operates on matching rows rather
  than post-filtering an unrelated page.
- Backports and non-latest package releases must not replace current topics.
- Release tags retain their existing version-selection meaning and are never derived from topics.

## Browse Ordering

Category browse pages place official or curated entries before community entries while preserving
the selected catalog sort within those groups. The grouping happens before pagination, including
when plugin families are merged into one browse feed. Community results remain visible as the
fallback; official status affects browse ordering, not search eligibility.

## Migration

Legacy skills and packages are widened with a cursor-batched `@convex-dev/migrations` backfill.
The backfill preserves valid stored values, derives only missing/invalid categories, normalizes
existing topics, refreshes search digests, and supports dry-run and resumable execution.
