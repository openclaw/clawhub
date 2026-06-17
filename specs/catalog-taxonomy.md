# Catalog Taxonomy Contract

## Categories

- Skills and plugins use separate controlled slug registries from `clawhub-schema`.
- Category slugs name one concept. Plugin categories mirror contribution slots; skill categories
  describe user intent.
- Each item stores up to three category slugs. Unknown slugs are rejected.
- Declaration precedence:
  1. Current publish input from CLI or UI.
  2. `metadata.openclaw.json` for skills or `openclaw.plugin.json` for plugins.
  3. Existing stored categories.
  4. Controlled-slug inference.
  5. `other`.
- An explicit empty category array means `other`; only an omitted declaration enables inference.
- Skill inference uses title, summary, and slug. Plugin inference uses manifest contribution fields.
- Inference only emits controlled slugs and only runs when categories were omitted.
- Backports and non-latest plugin releases do not replace current categories.
- Capability tags are not taxonomy inputs.
- Existing skills without stored categories use deterministic inference into controlled slugs.
- Existing plugins without stored categories remain in `other` until the follow-up corpus backfill.

## Topics

- Authors may supply up to five topics through publish input or the metadata files above.
- Stored topics preserve author-facing labels. Lookup uses normalized topic slugs.
- Reserved platform trust labels such as `official`, `featured`, and `verified` are rejected.
- Topics are separate from release tags and are available to browse and exact-topic global search.
- Authors can edit categories and topics from skill and plugin settings.
- Settings show no category override as Automatic; clearing categories removes the stored override.
- Plugin automatic categories are re-derived from the latest stored manifest on every digest sync.
  Legacy bundle releases keep their current category until republish stores that manifest.
- Backports and non-latest plugin releases do not replace current topics.

## Browse

- Skill and plugin browse paths remain separate.
- Category browse places official or curated entries before community entries.
- Category and topic filters use per-value digest rows that preserve the selected browse sort.
- Publisher profiles group authored items by their first topic when multiple groups exist.

## Follow-Up

The corpus classification and resumable LLM backfill are a separate migration PR. It will populate
missing categories and topics without changing the declaration precedence above.
